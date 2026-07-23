import type { AppConfig } from "../config";
import { isStatusOAuthEnabled } from "../config";
import type { AbsenceRecord } from "../domain/absence";
import { filterToday } from "../domain/absence";
import { getJstDateParts } from "../domain/jst-date";
import {
  selectStatusNotesByUser,
  statusExpirationUnixForJstDay
} from "../domain/status-expiration";
import { resolveStatusText, resolveStatusEmoji } from "../domain/status-profile";
import { listAbsencesByUserActiveOnDate } from "../db/absence-repository";
import { listMemberMasterStatusPrefsForUserIds } from "../db/member-master-repository";
import { checkSlackUserOAuthSchema } from "../db/schema-check";
import {
  decryptSlackUserAccessToken,
  deleteSlackUserOAuthByUserId,
  listSlackUserOAuthForUserIds
} from "../db/slack-user-oauth-repository";
import { SlackApiError } from "../slack/client";
import { clearUserProfileStatus, setUserProfileStatus } from "../slack/user-api";

export type StatusSyncResult = {
  active: boolean;
  statusSet: number;
  statusSkipped: number;
  statusErrors: number;
};

export type StatusEventResult =
  | "set"
  | "cleared"
  | "skipped_not_today"
  | "skipped_no_oauth"
  | "skipped_inactive"
  | "error";

type ScheduledRunContext = {
  runId: string;
  trigger: "manual" | "scheduled";
};

type StatusEventContext = {
  runId: string;
  userId: string;
  todayJst: string;
};

const GRID_SKIP_ERRORS = new Set([
  "profile_set_not_allowed",
  "cannot_update_self",
  "cannot_update_user",
  "restricted_action"
]);

const TOKEN_REVOKE_ERRORS = new Set(["token_revoked", "invalid_auth", "account_inactive"]);

const isStatusEventEnabled = async (config: AppConfig): Promise<boolean> => {
  if (!isStatusOAuthEnabled(config)) return false;
  return (await checkSlackUserOAuthSchema(config)) === "ok";
};

const applyStatusForUser = async (
  config: AppConfig,
  params: StatusEventContext & { note?: string }
): Promise<StatusEventResult> => {
  const oauthMap = await listSlackUserOAuthForUserIds(config, [params.userId]);
  const oauth = oauthMap.get(params.userId);
  if (!oauth) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "status_event_skipped_no_oauth",
        run_id: params.runId,
        user_id: params.userId
      })
    );
    return "skipped_no_oauth";
  }
  const prefsMap = await listMemberMasterStatusPrefsForUserIds(config, [params.userId]);
  const prefs = prefsMap.get(params.userId);
  const statusText = resolveStatusText({
    note: params.note,
    userDefaultText: prefs?.statusDefaultText,
    orgDefaultText: config.statusDefaultText
  });
  const emoji = resolveStatusEmoji({
    userEmoji: prefs?.statusEmoji,
    orgEmoji: config.statusEmoji
  });
  const expiration = statusExpirationUnixForJstDay(params.todayJst);
  try {
    const userToken = await decryptSlackUserAccessToken(config, oauth);
    await setUserProfileStatus(userToken, {
      status_text: statusText,
      status_emoji: emoji,
      status_expiration: expiration
    });
    console.log(
      JSON.stringify({
        level: "info",
        event: "status_event_set",
        run_id: params.runId,
        user_id: params.userId
      })
    );
    return "set";
  } catch (error) {
    if (error instanceof SlackApiError) {
      if (TOKEN_REVOKE_ERRORS.has(error.slackError)) {
        await deleteSlackUserOAuthByUserId(config, params.userId);
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "status_oauth_revoked",
            run_id: params.runId,
            user_id: params.userId,
            slack_error: error.slackError
          })
        );
        return "error";
      }
      if (GRID_SKIP_ERRORS.has(error.slackError)) {
        console.log(
          JSON.stringify({
            level: "info",
            event: "status_sync_skipped_grid",
            run_id: params.runId,
            user_id: params.userId,
            slack_error: error.slackError
          })
        );
        return "skipped_inactive";
      }
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "status_sync_failed",
        run_id: params.runId,
        user_id: params.userId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return "error";
  }
};

const clearStatusForUser = async (
  config: AppConfig,
  params: StatusEventContext
): Promise<StatusEventResult> => {
  const oauthMap = await listSlackUserOAuthForUserIds(config, [params.userId]);
  const oauth = oauthMap.get(params.userId);
  if (!oauth) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "status_event_skipped_no_oauth",
        run_id: params.runId,
        user_id: params.userId
      })
    );
    return "skipped_no_oauth";
  }
  try {
    const userToken = await decryptSlackUserAccessToken(config, oauth);
    await clearUserProfileStatus(userToken);
    console.log(
      JSON.stringify({
        level: "info",
        event: "status_event_cleared",
        run_id: params.runId,
        user_id: params.userId
      })
    );
    return "cleared";
  } catch (error) {
    if (error instanceof SlackApiError && TOKEN_REVOKE_ERRORS.has(error.slackError)) {
      await deleteSlackUserOAuthByUserId(config, params.userId);
    }
    console.error(
      JSON.stringify({
        level: "error",
        event: "status_sync_failed",
        run_id: params.runId,
        user_id: params.userId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return "error";
  }
};

export const syncStatusForUserToday = async (
  config: AppConfig,
  params: StatusEventContext & { records: AbsenceRecord[] }
): Promise<StatusEventResult> => {
  if (!(await isStatusEventEnabled(config))) return "skipped_inactive";
  const todays = filterToday(params.records, params.todayJst);
  if (todays.length === 0) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "status_event_skipped_not_today",
        run_id: params.runId,
        user_id: params.userId
      })
    );
    return "skipped_not_today";
  }
  const selections = selectStatusNotesByUser(todays);
  const selection = selections.find((entry) => entry.targetUser === params.userId);
  if (!selection) return "skipped_not_today";
  return applyStatusForUser(config, {
    runId: params.runId,
    userId: params.userId,
    todayJst: params.todayJst,
    note: selection.note
  });
};

export const reconcileStatusAfterAbsenceChange = async (
  config: AppConfig,
  params: StatusEventContext
): Promise<StatusEventResult> => {
  if (!(await isStatusEventEnabled(config))) return "skipped_inactive";
  const records = await listAbsencesByUserActiveOnDate(config, params.userId, params.todayJst);
  const todays = filterToday(records, params.todayJst);
  if (todays.length === 0) {
    return clearStatusForUser(config, params);
  }
  const selections = selectStatusNotesByUser(todays);
  const selection = selections.find((entry) => entry.targetUser === params.userId);
  if (!selection) {
    return clearStatusForUser(config, params);
  }
  return applyStatusForUser(config, {
    runId: params.runId,
    userId: params.userId,
    todayJst: params.todayJst,
    note: selection.note
  });
};

export const reconcileStatusAfterAbsenceChangeIsolated = async (
  config: AppConfig,
  params: { userId: string; runId?: string }
): Promise<void> => {
  const { day: todayJst } = getJstDateParts();
  try {
    await reconcileStatusAfterAbsenceChange(config, {
      userId: params.userId,
      todayJst,
      runId: params.runId ?? crypto.randomUUID()
    });
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "status_event_reconcile_failed",
        user_id: params.userId,
        run_id: params.runId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
};

export const reconcileStatusIfRecordsAffectToday = async (
  config: AppConfig,
  params: { userId: string; records: AbsenceRecord[]; runId?: string }
): Promise<void> => {
  const { day: todayJst } = getJstDateParts();
  if (filterToday(params.records, todayJst).length === 0) return;
  await reconcileStatusAfterAbsenceChangeIsolated(config, {
    userId: params.userId,
    runId: params.runId
  });
};

export const syncTodayAbsenceStatus = async (
  config: AppConfig,
  context: ScheduledRunContext,
  dmCandidateRecords: AbsenceRecord[],
  dayJst: string
): Promise<StatusSyncResult> => {
  const empty: StatusSyncResult = {
    active: false,
    statusSet: 0,
    statusSkipped: 0,
    statusErrors: 0
  };
  if (context.trigger !== "scheduled") return empty;
  if (!(await isStatusEventEnabled(config))) return empty;

  const todaysForDm = filterToday(dmCandidateRecords, dayJst);
  const selections = selectStatusNotesByUser(todaysForDm);
  if (selections.length === 0) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "status_sync_done",
        run_id: context.runId,
        status_sync_count: 0,
        status_set: 0,
        status_skipped: 0,
        status_errors: 0
      })
    );
    return { active: true, statusSet: 0, statusSkipped: 0, statusErrors: 0 };
  }

  let statusSet = 0;
  let statusSkipped = 0;
  let statusErrors = 0;

  for (const selection of selections) {
    const result = await applyStatusForUser(config, {
      runId: context.runId,
      userId: selection.targetUser,
      todayJst: dayJst,
      note: selection.note
    });
    switch (result) {
      case "set":
        statusSet += 1;
        break;
      case "skipped_no_oauth":
      case "skipped_inactive":
        statusSkipped += 1;
        break;
      case "error":
        statusErrors += 1;
        break;
      default:
        break;
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "status_sync_done",
      run_id: context.runId,
      status_sync_count: selections.length,
      status_set: statusSet,
      status_skipped: statusSkipped,
      status_errors: statusErrors
    })
  );

  return { active: true, statusSet, statusSkipped, statusErrors };
};
