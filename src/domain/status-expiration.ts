import type { AbsenceRecord } from "../domain/absence";
import { truncateStatusText } from "../domain/status-text";
import { getJstDateParts } from "../domain/jst-date";

export const statusExpirationUnixForJstDay = (dayJst: string): number => {
  const instant = new Date(`${dayJst}T23:59:59+09:00`);
  return Math.floor(instant.getTime() / 1000);
};

export const statusExpirationUnixForTodayJst = (now = new Date()): number => {
  const { day } = getJstDateParts(now);
  return statusExpirationUnixForJstDay(day);
};

export type UserStatusNoteSelection = {
  targetUser: string;
  note?: string;
};

export const selectStatusNotesByUser = (records: AbsenceRecord[]): UserStatusNoteSelection[] => {
  const byUser = new Map<string, AbsenceRecord[]>();
  for (const record of records) {
    if (!record.targetUser) continue;
    const existing = byUser.get(record.targetUser) ?? [];
    existing.push(record);
    byUser.set(record.targetUser, existing);
  }
  const selections: UserStatusNoteSelection[] = [];
  for (const [targetUser, userRecords] of byUser) {
    const sorted = [...userRecords].sort((a, b) => a.itemId.localeCompare(b.itemId));
    const note = sorted[0]?.note?.trim();
    selections.push({ targetUser, note: note && note.length > 0 ? note : undefined });
  }
  return selections;
};

export const resolveStatusText = (params: {
  note?: string;
  defaultText: string;
}): string => {
  if (params.note && params.note.length > 0) {
    return truncateStatusText(params.note);
  }
  return truncateStatusText(params.defaultText);
};
