import { resolveAbsenceEndDate } from "./absence-registration";
import { addJstDays, isValidJstDateString } from "./jst-date";

export const MENTION_NOTE_MAX_LEN = 500;

export const ABSENCE_MENTION_AI_RESPONSE_FORMAT = {
  type: "json_schema",
  json_schema: {
    type: "object",
    properties: {
      startDate: { type: "string" },
      endDate: { type: "string" },
      note: { type: "string" }
    },
    required: ["startDate", "endDate"]
  }
} as const;

export type AbsenceMentionDraft = {
  startDate: string;
  endDate: string;
  note?: string;
  noteTruncated?: boolean;
};

export type MentionConfirmPayload = {
  v: 1;
  userId: string;
  channelId: string;
  startDate: string;
  endDate: string;
  note?: string;
};

export type AbsenceMentionAiMessage = {
  role: "system" | "user" | "assistant";
  content: string;
};

const MENTION_PATTERN = /<@[A-Z0-9]+>/g;

export const stripAppMentionText = (text: string): string =>
  text.replace(MENTION_PATTERN, "").replace(/\s+/g, " ").trim();

const extractJsonObject = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
};

const truncateNote = (note: string): { note: string; truncated: boolean } => {
  if (note.length <= MENTION_NOTE_MAX_LEN) {
    return { note, truncated: false };
  }
  return { note: note.slice(0, MENTION_NOTE_MAX_LEN), truncated: true };
};

const parseNoteField = (value: unknown): { note?: string; truncated: boolean } => {
  if (typeof value !== "string") return { note: undefined, truncated: false };
  const trimmed = value.trim();
  if (trimmed.length === 0) return { note: undefined, truncated: false };
  const { note, truncated } = truncateNote(trimmed);
  return { note, truncated };
};

const readStringField = (record: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const value = record[key];
    if (typeof value === "string" && value.trim().length > 0) {
      return value.trim();
    }
  }
  return "";
};

const parseAbsenceMentionRecord = (record: Record<string, unknown>): AbsenceMentionDraft | undefined => {
  const startDate = readStringField(record, ["startDate", "start_date"]);
  const endDateRaw = readStringField(record, ["endDate", "end_date"]);
  if (!isValidJstDateString(startDate)) return undefined;
  const endDate = resolveAbsenceEndDate(startDate, endDateRaw);
  if (!isValidJstDateString(endDate)) return undefined;
  const { note, truncated } = parseNoteField(record.note);
  return {
    startDate,
    endDate,
    note,
    noteTruncated: truncated || undefined
  };
};

export const parseAbsenceMentionAiResponse = (raw: string): AbsenceMentionDraft | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(extractJsonObject(raw));
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  return parseAbsenceMentionRecord(parsed as Record<string, unknown>);
};

export const parseAbsenceMentionFromAiRun = (response: unknown): AbsenceMentionDraft | undefined => {
  if (!response || typeof response !== "object") return undefined;
  const record = response as Record<string, unknown>;
  const inner = record.response;
  if (inner && typeof inner === "object") {
    return parseAbsenceMentionRecord(inner as Record<string, unknown>);
  }
  if (typeof inner === "string") {
    return parseAbsenceMentionAiResponse(inner);
  }
  return parseAbsenceMentionRecord(record);
};

export const describeAiRunForLog = (response: unknown): { response_kind: string; response_length: number } => {
  if (!response || typeof response !== "object") {
    return { response_kind: typeof response, response_length: 0 };
  }
  const inner = (response as Record<string, unknown>).response;
  if (inner && typeof inner === "object") {
    return { response_kind: "object", response_length: JSON.stringify(inner).length };
  }
  if (typeof inner === "string") {
    return { response_kind: "string", response_length: inner.length };
  }
  return { response_kind: "unknown", response_length: JSON.stringify(response).length };
};

export const buildAbsenceMentionPrompt = (
  todayJst: string,
  userText: string
): AbsenceMentionAiMessage[] => {
  const tomorrow = addJstDays(todayJst, 1);
  return [
    {
      role: "system",
      content: [
        "日本語メッセージから不在登録用フィールドを抽出する。",
        `今日は ${todayJst}（JST, YYYY-MM-DD）。`,
        'JSON のみ返す: {"startDate":"YYYY-MM-DD","endDate":"YYYY-MM-DD","note":"..."}。',
        "1日のみなら endDate は startDate と同じ。時刻は note に入れる。",
        "終了日が不明なら endDate に startDate を入れる。",
        "note がなければ空文字。"
      ].join(" ")
    },
    {
      role: "user",
      content: "今日 午前通院"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: todayJst,
        endDate: todayJst,
        note: "午前通院"
      })
    },
    {
      role: "user",
      content: "明日 通院のため午後から"
    },
    {
      role: "assistant",
      content: JSON.stringify({
        startDate: tomorrow,
        endDate: tomorrow,
        note: "通院のため午後から"
      })
    },
    {
      role: "user",
      content: userText
    }
  ];
};

export const buildMentionConfirmPayload = (params: {
  userId: string;
  channelId: string;
  draft: AbsenceMentionDraft;
}): MentionConfirmPayload => ({
  v: 1,
  userId: params.userId,
  channelId: params.channelId,
  startDate: params.draft.startDate,
  endDate: params.draft.endDate,
  note: params.draft.note
});

export const parseMentionConfirmPayload = (raw: string): MentionConfirmPayload | undefined => {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return undefined;
  }
  if (!parsed || typeof parsed !== "object") return undefined;
  const record = parsed as Record<string, unknown>;
  if (record.v !== 1) return undefined;
  const userId = typeof record.userId === "string" ? record.userId.trim() : "";
  const channelId = typeof record.channelId === "string" ? record.channelId.trim() : "";
  const startDate = typeof record.startDate === "string" ? record.startDate.trim() : "";
  const endDateRaw = typeof record.endDate === "string" ? record.endDate.trim() : "";
  if (!userId || !channelId || !startDate) return undefined;
  if (!isValidJstDateString(startDate)) return undefined;
  const endDate = resolveAbsenceEndDate(startDate, endDateRaw);
  if (!isValidJstDateString(endDate)) return undefined;
  const { note } = parseNoteField(record.note);
  return {
    v: 1,
    userId,
    channelId,
    startDate,
    endDate,
    note
  };
};
