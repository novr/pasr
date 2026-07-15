import type { AppConfig } from "../config";
import { isStatusOAuthEnabled } from "../config";
import type { AbsenceRecord } from "../domain/absence";
import { filterToday } from "../domain/absence";
import {
  resolveStatusText,
  selectStatusNotesByUser,
  statusExpirationUnixForJstDay
} from "../domain/status-expiration";
import { checkSlackUserOAuthSchema } from "../db/schema-check";
import {
  decryptSlackUserAccessToken,
  deleteSlackUserOAuthByUserId,
  listSlackUserOAuthForUserIds
} from "../db/slack-user-oauth-repository";
import { SlackApiError } from "../slack/client";
import { setUserProfileStatus } from "../slack/user-api";

export type StatusSyncResult = {
  statusSet: number;
  statusSkipped: number;
  statusErrors: number;
};

type RunContext = {
  runId: string;
  trigger: "manual" | "scheduled";
};

const GRID_SKIP_ERRORS = new Set([
  "profile_set_not_allowed",
  "cannot_update_self",
  "cannot_update_user",
  "restricted_action"
]);

const TOKEN_REVOKE_ERRORS = new Set(["token_revoked", "invalid_auth", "account_inactive"]);

export const syncTodayAbsenceStatus = async (
  config: AppConfig,
  context: RunContext,
  dmCandidateRecords: AbsenceRecord[],
  dayJst: string
): Promise<StatusSyncResult> => {
  const empty: StatusSyncResult = { statusSet: 0, statusSkipped: 0, statusErrors: 0 };
  if (context.trigger !== "scheduled") return empty;
  if (!isStatusOAuthEnabled(config)) return empty;
  const schema = await checkSlackUserOAuthSchema(config);
  if (schema !== "ok") return empty;

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
    return empty;
  }

  const userIds = selections.map((entry) => entry.targetUser);
  const oauthMap = await listSlackUserOAuthForUserIds(config, userIds);
  const expiration = statusExpirationUnixForJstDay(dayJst);
  const emoji = config.statusEmoji;

  let statusSet = 0;
  let statusSkipped = 0;
  let statusErrors = 0;

  for (const selection of selections) {
    const oauth = oauthMap.get(selection.targetUser);
    if (!oauth) {
      statusSkipped += 1;
      console.log(
        JSON.stringify({
          level: "info",
          event: "status_sync_skipped_no_oauth",
          run_id: context.runId,
          user_id: selection.targetUser
        })
      );
      continue;
    }
    const statusText = resolveStatusText({
      note: selection.note,
      defaultText: config.statusDefaultText
    });
    try {
      const userToken = await decryptSlackUserAccessToken(config, oauth);
      await setUserProfileStatus(userToken, {
        status_text: statusText,
        status_emoji: emoji,
        status_expiration: expiration
      });
      statusSet += 1;
    } catch (error) {
      if (error instanceof SlackApiError) {
        if (TOKEN_REVOKE_ERRORS.has(error.slackError)) {
          await deleteSlackUserOAuthByUserId(config, selection.targetUser);
          statusErrors += 1;
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "status_oauth_revoked",
              run_id: context.runId,
              user_id: selection.targetUser,
              slack_error: error.slackError
            })
          );
          continue;
        }
        if (GRID_SKIP_ERRORS.has(error.slackError)) {
          statusSkipped += 1;
          console.log(
            JSON.stringify({
              level: "info",
              event: "status_sync_skipped_grid",
              run_id: context.runId,
              user_id: selection.targetUser,
              slack_error: error.slackError
            })
          );
          continue;
        }
      }
      statusErrors += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "status_sync_failed",
          run_id: context.runId,
          user_id: selection.targetUser,
          message: error instanceof Error ? error.message : String(error)
        })
      );
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

  return { statusSet, statusSkipped, statusErrors };
};
