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

const readLooseDateField = (raw: string, field: "startDate" | "endDate"): string => {
  const match = raw.match(new RegExp(`"${field}"\\s*:\\s*"(\\d{4}-\\d{2}-\\d{2})"`));
  return match?.[1] ?? "";
};

const readLooseNoteField = (raw: string): string => {
  const match = raw.match(/"note"\s*:\s*"((?:[^"\\]|\\.)*)"/);
  if (!match?.[1]) return "";
  try {
    return JSON.parse(`"${match[1]}"`);
  } catch {
    return match[1];
  }
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

const parseLooseAbsenceMentionJson = (raw: string): AbsenceMentionDraft | undefined => {
  const startDate = readLooseDateField(raw, "startDate");
  const endDateRaw = readLooseDateField(raw, "endDate");
  if (!isValidJstDateString(startDate)) return undefined;
  const endDate = resolveAbsenceEndDate(startDate, endDateRaw);
  if (!isValidJstDateString(endDate)) return undefined;
  const noteRaw = readLooseNoteField(raw);
  const { note, truncated } = parseNoteField(noteRaw);
  return {
    startDate,
    endDate,
    note,
    noteTruncated: truncated || undefined
  };
};

export const parseAbsenceMentionAiResponse = (raw: string): AbsenceMentionDraft | undefined => {
  const jsonText = extractJsonObject(raw);
  let parsed: unknown;
  try {
    parsed = JSON.parse(jsonText);
  } catch {
    return parseLooseAbsenceMentionJson(jsonText);
  }
  if (!parsed || typeof parsed !== "object") return parseLooseAbsenceMentionJson(jsonText);
  return parseAbsenceMentionRecord(parsed as Record<string, unknown>);
};

const readChoiceContent = (response: Record<string, unknown>): string | undefined => {
  const choices = response.choices;
  if (!Array.isArray(choices) || choices.length === 0) return undefined;
  const first = choices[0];
  if (!first || typeof first !== "object") return undefined;
  const message = (first as Record<string, unknown>).message;
  if (!message || typeof message !== "object") return undefined;
  const content = (message as Record<string, unknown>).content;
  return typeof content === "string" ? content : undefined;
};

export const parseAbsenceMentionFromAiRun = (response: unknown): AbsenceMentionDraft | undefined => {
  if (!response || typeof response !== "object") return undefined;
  const record = response as Record<string, unknown>;
  const inner = record.response;
  if (inner && typeof inner === "object") {
    return parseAbsenceMentionRecord(inner as Record<string, unknown>);
  }
  if (typeof inner === "string") {
    const parsed = parseAbsenceMentionAiResponse(inner);
    if (parsed) return parsed;
  }

  const choiceContent = readChoiceContent(record);
  if (choiceContent) {
    const parsed = parseAbsenceMentionAiResponse(choiceContent);
    if (parsed) return parsed;
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
