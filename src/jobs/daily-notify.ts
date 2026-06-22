import type { AppConfig } from "../config";
import { filterToday, groupByChannel, parseAbsence, type AbsenceRecord, type SkipReason } from "../domain/absence";
import { pickListField, toBooleanValue, toStringValue } from "../domain/slack-list-value";
import { ensureMemberMasterList, runSetup } from "./setup";
import { slackApi, type SlackListItem } from "../slack/api";
import {
  writeLastRunSummary,
  readPostedDirectMessageTs,
  readPersistedListId,
  readPostedMessageTs,
  writePostedDirectMessageTs,
  writePersistedListId,
  writePostedMessageTs
} from "../state/kv";

type DailyResult = {
  runId: string;
  trigger: "manual" | "scheduled";
  listId: string;
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
  skipReasons: Record<SkipReason, number>;
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

type MemberMasterRecord = {
  itemId: string;
  targetUser: string;
  active: boolean;
};

const parseMemberMaster = (item: SlackListItem): MemberMasterRecord | undefined => {
  const targetUser = toStringValue(pickListField(item, "target_user")) || toStringValue(pickListField(item, "member_key"));
  if (!targetUser) return undefined;
  const active = toBooleanValue(pickListField(item, "active")) ?? true;
  return {
    itemId: item.id,
    targetUser,
    active
  };
};

const loadMemberMasterMap = async (
  config: AppConfig,
  memberMasterListId: string
): Promise<Map<string, MemberMasterRecord>> => {
  const masterItems = await slackApi.listMemberMasterItems(config, memberMasterListId);
  const memberMasterMap = new Map<string, MemberMasterRecord>();
  for (const item of masterItems.items ?? []) {
    const parsed = parseMemberMaster(item);
    if (!parsed) continue;
    if (memberMasterMap.has(parsed.targetUser)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "duplicate_member_master_user",
          targetUser: parsed.targetUser,
          itemId: parsed.itemId
        })
      );
      continue;
    }
    memberMasterMap.set(parsed.targetUser, parsed);
  }
  return memberMasterMap;
};

const markSkipped = (
  result: DailyResult,
  context: RunContext,
  listId: string,
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
      listId,
      itemId,
      reason
    })
  );
};

const resolveMasterForRecord = async (
  config: AppConfig,
  memberMasterListId: string,
  memberMasterMap: Map<string, MemberMasterRecord>,
  record: AbsenceRecord
): Promise<MemberMasterRecord | undefined> => {
  const existing = memberMasterMap.get(record.targetUser);
  if (existing) return existing;
  try {
    await slackApi.createMemberMasterItem(config, memberMasterListId, record.targetUser, []);
    const created: MemberMasterRecord = {
      itemId: "auto-created",
      targetUser: record.targetUser,
      active: true
    };
    memberMasterMap.set(record.targetUser, created);
    return created;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "member_master_auto_insert_failed",
        targetUser: record.targetUser,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return undefined;
  }
};

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

const buildMessageLine = (record: AbsenceRecord): string => {
  const details: string[] = [];
  if (record.absenceType) details.push(record.absenceType);
  const noteText = parseNoteText(record.note);
  if (noteText) details.push(noteText);
  const suffix = details.length > 0 ? ` ${details.join(" ")}` : "";
  return `• <@${record.targetUser}>${suffix}`;
};

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

const sendChannelNotifications = async (
  config: AppConfig,
  context: RunContext,
  result: DailyResult,
  listId: string,
  day: string,
  grouped: Map<string, AbsenceRecord[]>
): Promise<void> => {
  for (const [channel, records] of grouped.entries()) {
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
      result.sent += 1;
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (existingTs && message.includes("message_not_found")) {
        try {
          const posted = await slackApi.postChannelMessage(config, channel, text);
          if (!posted.ts) throw new Error("chat.postMessage response missing ts");
          await writePostedMessageTs(config, day, channel, posted.ts);
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
              listId,
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
          listId,
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
  listId: string,
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
      console.log(
        JSON.stringify({
          level: "info",
          event: "notify_user_dm_sent",
          run_id: context.runId,
          trigger: context.trigger,
          listId,
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
          listId,
          notifyUser,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
};

const collectTextNodes = (value: unknown, bucket: string[]): void => {
  if (Array.isArray(value)) {
    for (const entry of value) collectTextNodes(entry, bucket);
    return;
  }
  if (!value || typeof value !== "object") return;

  const obj = value as Record<string, unknown>;
  if (obj.type === "text" && typeof obj.text === "string") {
    const trimmed = obj.text.trim();
    if (trimmed.length > 0) bucket.push(trimmed);
  }
  if (Array.isArray(obj.elements)) {
    collectTextNodes(obj.elements, bucket);
  }
};

const parseNoteText = (note?: string): string | undefined => {
  if (!note) return undefined;
  const trimmed = note.trim();
  if (!trimmed.startsWith("{") && !trimmed.startsWith("[")) return trimmed;

  try {
    const parsed = JSON.parse(trimmed) as unknown;
    const texts: string[] = [];
    collectTextNodes(parsed, texts);
    const joined = texts.join(" ").trim();
    return joined.length > 0 ? joined : trimmed;
  } catch {
    return trimmed;
  }
};

export const runDailyNotify = async (
  config: AppConfig,
  context: RunContext
): Promise<DailyResult> => {
  let resolvedListId = "";
  const result: DailyResult = {
    runId: context.runId,
    trigger: context.trigger,
    listId: resolvedListId,
    processed: 0,
    sent: 0,
    skipped: 0,
    errors: 0,
    skipReasons: zeroedReasons()
  };
  const { day } = toJstDate();
  let listId = await readPersistedListId(config);
  if (!listId && config.absenceListId) {
    listId = config.absenceListId;
    await writePersistedListId(config, listId);
  }
  if (!listId) {
    const setupResult = await runSetup(config);
    listId = setupResult.listId;
  }
  resolvedListId = listId;
  result.listId = resolvedListId;
  const memberMasterListId = await ensureMemberMasterList(config);
  const memberMasterMap = await loadMemberMasterMap(config, memberMasterListId);

  const listResponse = await slackApi.listAbsences(config, listId);
  const parsed = (listResponse.items ?? []).map(parseAbsence);
  result.processed = parsed.length;

  const validRecords: AbsenceRecord[] = [];
  const dmCandidateRecords: AbsenceRecord[] = [];
  for (const item of parsed) {
    if (!item.ok) {
      markSkipped(result, context, resolvedListId, item.itemId, item.reason);
      continue;
    }
    const record = item.record;
    const master = await resolveMasterForRecord(config, memberMasterListId, memberMasterMap, record);
    if (master && !master.active) {
      markSkipped(result, context, resolvedListId, record.itemId, "inactive_user_master");
      continue;
    }
    dmCandidateRecords.push(record);
    if (record.notifyChannels.length === 0) {
      markSkipped(result, context, resolvedListId, record.itemId, "missing_notify_channels");
      continue;
    }
    validRecords.push(record);
  }

  const todays = filterToday(validRecords, day);
  const todaysForDm = filterToday(dmCandidateRecords, day);
  const grouped =
    todays.length > 0
      ? groupByChannel(todays)
      : new Map(
          [...new Set(validRecords.flatMap((record) => record.notifyChannels))].map((channel) => [
            channel,
            [] as AbsenceRecord[]
          ])
        );
  await sendChannelNotifications(config, context, result, resolvedListId, day, grouped);

  const groupedNotifyUsers = groupByNotifyUser(todaysForDm);
  await sendDirectMessageNotifications(config, context, result, resolvedListId, day, groupedNotifyUsers);

  console.log(
    JSON.stringify({
      level: "info",
      event: "daily_notify_done",
      run_id: context.runId,
      trigger: context.trigger,
      listId: resolvedListId,
      processed: result.processed,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors,
      skipReasons: result.skipReasons
    })
  );
  try {
    await writeLastRunSummary(config, {
      runId: result.runId,
      trigger: result.trigger,
      listId: result.listId,
      processed: result.processed,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors,
      executedAt: new Date().toISOString()
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "write_last_run_summary_failed",
        run_id: result.runId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
  return result;
};
