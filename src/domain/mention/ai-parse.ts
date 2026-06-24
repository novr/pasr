import { resolveAbsenceEndDate } from "../absence-registration";
import { isValidJstDateString } from "../jst-date";
import { parseNoteField } from "./note";
import type { AbsenceMentionDraft } from "./types";

const extractJsonObject = (raw: string): string => {
  const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fenced?.[1]) return fenced[1].trim();
  const start = raw.indexOf("{");
  const end = raw.lastIndexOf("}");
  if (start >= 0 && end > start) return raw.slice(start, end + 1);
  return raw.trim();
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
