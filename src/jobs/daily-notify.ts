import type { AppConfig } from "../config";
import { filterToday, groupByChannel, type AbsenceRecord, type SkipReason } from "../domain/absence";
import { formatAttendanceNoticeLine } from "../domain/absence-registration";
import {
  deleteAbsenceById,
  listAbsenceIdsEndedBefore,
  listAllAbsences
} from "../db/absence-repository";
import { loadChannelNotifySettingsMap, resolveNotifyWhenEmpty } from "../db/channel-notify-repository";
import { ensureMemberMasterActive, loadMemberMasterActiveMap } from "../db/member-master-repository";
import { checkDbSchema } from "../db/schema-check";
import { postOpsReport } from "./ops-report";
import { syncTodayAbsenceStatus } from "./status-sync";
import { slackApi } from "../slack/api";
import {
  writeLastRunSummary,
  readPostedDirectMessageTs,
  readPostedMessageTs,
  writePostedDirectMessageTs,
  writePostedMessageTs
} from "../state/kv";

type DailyResult = {
  runId: string;
  trigger: "manual" | "scheduled";
  processed: number;
  sent: number;
  sentChannels: number;
  sentDms: number;
  skipped: number;
  errors: number;
  deleted: number;
  todayAbsenceCount: number;
  skipReasons: Record<SkipReason, number>;
  dbStatus: string;
};

type ChannelNotifyContext = {
  settingsMap: Map<string, boolean>;
  notifyEmptyDefault: boolean;
};

type RunContext = {
  runId: string;
  trigger: "manual" | "scheduled";
};

const zeroedReasons = (): Record<SkipReason, number> => ({
  missing_target_user: 0,
  missing_start_date: 0,
  missing_notify_channels: 0,
  invalid_date_range: 0,
  inactive_user_master: 0
});

const toJstDate = (): { day: string; weekday: number } => {
  const now = new Date();
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Tokyo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit"
  }).format(now);

  const weekDayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short"
  }).format(now);
  const weekdayMap: Record<string, number> = {
    Sun: 0,
    Mon: 1,
    Tue: 2,
    Wed: 3,
    Thu: 4,
    Fri: 5,
    Sat: 6
  };
  return { day, weekday: weekdayMap[weekDayName] ?? 0 };
};

const buildMessageLine = (record: AbsenceRecord): string =>
  formatAttendanceNoticeLine(record.targetUser, record.note);

const buildMessage = (today: string, records: AbsenceRecord[]): string => {
  if (records.length === 0) {
    return [`本日（${today}）の不在予定`, "• 予定なし"].join("\n");
  }
  const lines = records.map(buildMessageLine);
  return [`本日（${today}）の不在予定`, ...lines].join("\n");
};

const sortNotifyUserRecords = (records: AbsenceRecord[]): AbsenceRecord[] =>
  [...records].sort((a, b) => {
    const startDate = a.startDate.localeCompare(b.startDate);
    if (startDate !== 0) return startDate;
    return a.targetUser.localeCompare(b.targetUser);
  });

const buildDirectMessage = (today: string, records: AbsenceRecord[]): string => {
  const sorted = sortNotifyUserRecords(records);
  const lines = sorted.map(buildMessageLine);
  return [`本日の不在予定です（${today} JST）`, ...lines].join("\n");
};

const groupByNotifyUser = (records: AbsenceRecord[]): Map<string, AbsenceRecord[]> => {
  const grouped = new Map<string, AbsenceRecord[]>();
  for (const record of records) {
    for (const notifyUser of record.notifyUsers) {
      const current = grouped.get(notifyUser) ?? [];
      current.push(record);
      grouped.set(notifyUser, current);
    }
  }
  return grouped;
};

const markSkipped = (
  result: DailyResult,
  context: RunContext,
  itemId: string,
  reason: SkipReason
): void => {
  result.skipped += 1;
  result.skipReasons[reason] += 1;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "skip_record",
      run_id: context.runId,
      trigger: context.trigger,
      itemId,
      reason
    })
  );
};

const sendChannelNotifications = async (
  config: AppConfig,
  context: RunContext,
  result: DailyResult,
  day: string,
  grouped: Map<string, AbsenceRecord[]>,
  notifyContext: ChannelNotifyContext
): Promise<void> => {
  for (const [channel, records] of grouped.entries()) {
    if (
      records.length === 0 &&
      !resolveNotifyWhenEmpty(channel, notifyContext.settingsMap, notifyContext.notifyEmptyDefault)
    ) {
      continue;
    }
    const text = buildMessage(day, records);
    const existingTs = await readPostedMessageTs(config, day, channel);
    try {
      if (existingTs) {
        const updated = await slackApi.updateChannelMessage(config, channel, existingTs, text);
        await writePostedMessageTs(config, day, channel, updated.ts ?? existingTs);
      } else {
        const posted = await slackApi.postChannelMessage(config, channel, text);
        if (!posted.ts) throw new Error("chat.postMessage response missing ts");
        await writePostedMessageTs(config, day, channel, posted.ts);
      }
      result.sentChannels += 1;
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (existingTs && message.includes("message_not_found")) {
        try {
          const posted = await slackApi.postChannelMessage(config, channel, text);
          if (!posted.ts) throw new Error("chat.postMessage response missing ts");
          await writePostedMessageTs(config, day, channel, posted.ts);
          result.sentChannels += 1;
          result.sent += 1;
          continue;
        } catch (fallbackError) {
          result.errors += 1;
          console.error(
            JSON.stringify({
              level: "error",
              event: "notify_fallback_failed",
              run_id: context.runId,
              trigger: context.trigger,
              channel,
              message: fallbackError instanceof Error ? fallbackError.message : String(fallbackError)
            })
          );
          continue;
        }
      }
      result.errors += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "notify_failed",
          run_id: context.runId,
          trigger: context.trigger,
          channel,
          message
        })
      );
    }
  }
};

const sendDirectMessageNotifications = async (
  config: AppConfig,
  context: RunContext,
  result: DailyResult,
  day: string,
  groupedNotifyUsers: Map<string, AbsenceRecord[]>
): Promise<void> => {
  for (const [notifyUser, records] of groupedNotifyUsers.entries()) {
    if (records.length === 0) continue;
    const text = buildDirectMessage(day, records);
    try {
      const dmChannelId = await slackApi.openDirectMessage(config, notifyUser);
      const existingTs = await readPostedDirectMessageTs(config, day, notifyUser);
      if (existingTs) {
        try {
          const updated = await slackApi.updateChannelMessage(config, dmChannelId, existingTs, text);
          await writePostedDirectMessageTs(config, day, notifyUser, updated.ts ?? existingTs);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          if (!message.includes("message_not_found")) throw error;
          const posted = await slackApi.postChannelMessage(config, dmChannelId, text);
          if (!posted.ts) throw new Error("chat.postMessage response missing ts");
          await writePostedDirectMessageTs(config, day, notifyUser, posted.ts);
        }
      } else {
        const posted = await slackApi.postChannelMessage(config, dmChannelId, text);
        if (!posted.ts) throw new Error("chat.postMessage response missing ts");
        await writePostedDirectMessageTs(config, day, notifyUser, posted.ts);
      }
      result.sentDms += 1;
      result.sent += 1;
      console.log(
        JSON.stringify({
          level: "info",
          event: "notify_user_dm_sent",
          run_id: context.runId,
          trigger: context.trigger,
          notifyUser
        })
      );
    } catch (error) {
      result.errors += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "notify_user_dm_failed",
          run_id: context.runId,
          trigger: context.trigger,
          notifyUser,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
};

const deleteEndedAbsences = async (
  config: AppConfig,
  context: RunContext,
  result: DailyResult,
  day: string
): Promise<void> => {
  const ids = await listAbsenceIdsEndedBefore(config, day);
  for (const itemId of ids) {
    try {
      await deleteAbsenceById(config, itemId);
      result.deleted += 1;
      console.log(
        JSON.stringify({
          level: "info",
          event: "ended_absence_deleted",
          run_id: context.runId,
          trigger: context.trigger,
          itemId
        })
      );
    } catch (error) {
      result.errors += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "absence_delete_failed",
          run_id: context.runId,
          trigger: context.trigger,
          itemId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
};

export const runDailyNotify = async (
  config: AppConfig,
  context: RunContext
): Promise<DailyResult> => {
  const dbStatus = await checkDbSchema(config);
  const result: DailyResult = {
    runId: context.runId,
    trigger: context.trigger,
    processed: 0,
    sent: 0,
    sentChannels: 0,
    sentDms: 0,
    skipped: 0,
    errors: 0,
    deleted: 0,
    todayAbsenceCount: 0,
    skipReasons: zeroedReasons(),
    dbStatus
  };

  if (dbStatus !== "ok") {
    result.errors += 1;
    console.error(JSON.stringify({ level: "error", event: "daily_notify_db_schema_missing" }));
    return result;
  }

  const { day } = toJstDate();
  const channelSettingsMap = await loadChannelNotifySettingsMap(config, { runId: context.runId });
  const notifyContext: ChannelNotifyContext = {
    settingsMap: channelSettingsMap,
    notifyEmptyDefault: config.notifyEmptyDefault
  };
  const memberMasterMap = await loadMemberMasterActiveMap(config);
  const records = await listAllAbsences(config);
  result.processed = records.length;

  const validRecords: AbsenceRecord[] = [];
  const dmCandidateRecords: AbsenceRecord[] = [];
  for (const record of records) {
    if (!record.targetUser) {
      markSkipped(result, context, record.itemId, "missing_target_user");
      continue;
    }
    if (!record.startDate) {
      markSkipped(result, context, record.itemId, "missing_start_date");
      continue;
    }
    if (record.startDate > record.endDate) {
      markSkipped(result, context, record.itemId, "invalid_date_range");
      continue;
    }

    let master = memberMasterMap.get(record.targetUser);
    if (!master) {
      const created = await ensureMemberMasterActive(config, record.targetUser);
      master = { targetUser: created.targetUser, active: created.active };
      memberMasterMap.set(created.targetUser, master);
    }
    if (!master.active) {
      markSkipped(result, context, record.itemId, "inactive_user_master");
      continue;
    }
    dmCandidateRecords.push(record);
    if (record.notifyChannels.length === 0) {
      markSkipped(result, context, record.itemId, "missing_notify_channels");
      continue;
    }
    validRecords.push(record);
  }

  const todays = filterToday(validRecords, day);
  result.todayAbsenceCount = todays.length;
  const todaysForDm = filterToday(dmCandidateRecords, day);
  const grouped =
    todays.length > 0
      ? groupByChannel(todays)
      : new Map(
          [
            ...new Set([
              ...validRecords.flatMap((record) => record.notifyChannels),
              ...channelSettingsMap.keys()
            ])
          ].map((channel) => [channel, [] as AbsenceRecord[]])
        );
  await sendChannelNotifications(config, context, result, day, grouped, notifyContext);

  const groupedNotifyUsers = groupByNotifyUser(todaysForDm);
  await sendDirectMessageNotifications(config, context, result, day, groupedNotifyUsers);

  const statusSyncResult = await syncTodayAbsenceStatus(
    config,
    context,
    dmCandidateRecords,
    day
  );
  result.errors += statusSyncResult.statusErrors;

  await deleteEndedAbsences(config, context, result, day);

  const opsResult = await postOpsReport(config, {
    runId: result.runId,
    trigger: result.trigger,
    day,
    todayAbsenceCount: result.todayAbsenceCount,
    processed: result.processed,
    sent: result.sent,
    sentChannels: result.sentChannels,
    sentDms: result.sentDms,
    skipped: result.skipped,
    errors: result.errors,
    deleted: result.deleted,
    skipReasons: result.skipReasons,
    ...(statusSyncResult.active
      ? {
          statusSet: statusSyncResult.statusSet,
          statusSkipped: statusSyncResult.statusSkipped,
          statusErrors: statusSyncResult.statusErrors
        }
      : {})
  });
  result.errors += opsResult.errors;

  console.log(
    JSON.stringify({
      level: "info",
      event: "daily_notify_done",
      run_id: context.runId,
      trigger: context.trigger,
      processed: result.processed,
      sent: result.sent,
      sentChannels: result.sentChannels,
      sentDms: result.sentDms,
      skipped: result.skipped,
      errors: result.errors,
      deleted: result.deleted,
      skipReasons: result.skipReasons,
      dbStatus: result.dbStatus
    })
  );
  try {
    await writeLastRunSummary(config, {
      runId: result.runId,
      trigger: result.trigger,
      processed: result.processed,
      sent: result.sent,
      sentChannels: result.sentChannels,
      sentDms: result.sentDms,
      skipped: result.skipped,
      errors: result.errors,
      deleted: result.deleted,
      executedAt: new Date().toISOString(),
      dbStatus: result.dbStatus
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "write_last_run_summary_failed",
        run_id: context.runId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }

  return result;
};
