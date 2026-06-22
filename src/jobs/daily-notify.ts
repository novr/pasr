import type { AppConfig } from "../config";
import { filterToday, groupByChannel, parseAbsence, type AbsenceRecord, type SkipReason } from "../domain/absence";
import { runSetup } from "./setup";
import { slackApi } from "../slack/api";
import {
  readPersistedListId,
  readPostedMessageTs,
  writePersistedListId,
  writePostedMessageTs
} from "../state/kv";

type DailyResult = {
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
  skipReasons: Record<SkipReason, number>;
};

const zeroedReasons = (): Record<SkipReason, number> => ({
  missing_target_user: 0,
  missing_start_date: 0,
  missing_notify_channels: 0,
  invalid_date_range: 0
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
  config: AppConfig
): Promise<DailyResult> => {
  const result: DailyResult = {
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

  const listResponse = await slackApi.listAbsences(config, listId);
  const parsed = (listResponse.items ?? []).map(parseAbsence);
  result.processed = parsed.length;

  const validRecords = [];
  for (const item of parsed) {
    if (!item.ok) {
      result.skipped += 1;
      result.skipReasons[item.reason] += 1;
      console.warn(JSON.stringify({ level: "warn", event: "skip_record", itemId: item.itemId, reason: item.reason }));
      continue;
    }
    validRecords.push(item.record);
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
          channel,
          message
        })
      );
    }
  }

  console.log(JSON.stringify({ level: "info", event: "daily_notify_done", ...result }));
  return result;
};
