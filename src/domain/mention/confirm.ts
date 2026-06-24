import { resolveAbsenceEndDate } from "../absence-registration";
import { isValidJstDateString } from "../jst-date";
import { parseNoteField } from "./note";
import type { AbsenceMentionDraft, MentionConfirmPayload } from "./types";

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
