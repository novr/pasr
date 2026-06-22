import type { AppConfig } from "../config";
import { filterToday, groupByChannel, parseAbsence, type AbsenceRecord, type SkipReason } from "../domain/absence";
import { ensureMemberMasterList, runSetup } from "./setup";
import { slackApi, type SlackListItem } from "../slack/api";
import {
  writeLastRunSummary,
  readPersistedListId,
  readPostedMessageTs,
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
  defaultNotifyChannels: string[];
};

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    return undefined;
  }
  const obj = asRecord(value);
  if (!obj) return undefined;
  for (const key of ["value", "checked", "is_checked", "selected"]) {
    if (obj[key] !== undefined) {
      const nested = toBooleanValue(obj[key]);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
};

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = toStringValue(entry);
      if (nested) return nested;
    }
    return "";
  }
  const obj = asRecord(value);
  if (!obj) return "";
  const direct = ["id", "user_id", "channel_id", "entity_id", "value", "name"].find(
    (key) => typeof obj[key] === "string" && String(obj[key]).length > 0
  );
  if (direct) return String(obj[direct]);
  for (const nestedKey of ["value", "user", "channel", "select"]) {
    if (obj[nestedKey] != null) {
      const nested = toStringValue(obj[nestedKey]);
      if (nested) return nested;
    }
  }
  return "";
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter((entry) => entry.length > 0);
  }
  const obj = asRecord(value);
  if (!obj) return [];
  for (const key of ["channel", "user", "select"]) {
    if (Array.isArray(obj[key])) {
      return obj[key].map((entry) => toStringValue(entry)).filter((entry) => entry.length > 0);
    }
  }
  const single = toStringValue(value);
  return single ? [single] : [];
};

const pick = (item: SlackListItem, key: string): unknown => {
  if (Array.isArray(item.fields)) {
    const fromFields = item.fields.find((entry) => {
      const record = asRecord(entry);
      return record?.key === key;
    });
    if (fromFields) return fromFields;
  }
  return item.fields?.[key] ?? item.values?.[key];
};

const parseMemberMaster = (item: SlackListItem): MemberMasterRecord | undefined => {
  const targetUser = toStringValue(pick(item, "target_user")) || toStringValue(pick(item, "member_key"));
  if (!targetUser) return undefined;
  const active = toBooleanValue(pick(item, "active")) ?? true;
  const defaultNotifyChannels = toStringArray(pick(item, "default_notify_channels"));
  return {
    itemId: item.id,
    targetUser,
    active,
    defaultNotifyChannels: [...new Set(defaultNotifyChannels)]
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
    await slackApi.createMemberMasterItem(config, memberMasterListId, record.targetUser, record.notifyChannels);
    const created: MemberMasterRecord = {
      itemId: "auto-created",
      targetUser: record.targetUser,
      active: true,
      defaultNotifyChannels: [...new Set(record.notifyChannels)]
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

const normalizeRecordChannels = (record: AbsenceRecord, master?: MemberMasterRecord): string[] =>
  record.notifyChannels.length > 0
    ? record.notifyChannels
    : (master?.defaultNotifyChannels ?? []).filter((entry) => entry.length > 0);

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
    const effectiveChannels = normalizeRecordChannels(record, master);
    if (effectiveChannels.length === 0) {
      markSkipped(result, context, resolvedListId, record.itemId, "missing_notify_channels");
      continue;
    }
    validRecords.push({
      ...record,
      notifyChannels: [...new Set(effectiveChannels)]
    });
  }

  const todays = filterToday(validRecords, day);
  const grouped =
    todays.length > 0
      ? groupByChannel(todays)
      : new Map(
          [...new Set(validRecords.flatMap((record) => record.notifyChannels))].map((channel) => [
            channel,
            [] as AbsenceRecord[]
          ])
        );
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
              listId: resolvedListId,
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
          listId: resolvedListId,
          channel,
          message
        })
      );
    }
  }

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
