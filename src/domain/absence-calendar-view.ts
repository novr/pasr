import type { AbsenceRecord } from "./absence";
import { formatAttendanceNoticeLine } from "./absence-registration";
import { addJstDays, formatJstWeekdayShort } from "./jst-date";

export type AbsenceCalendarDayEntry = {
  targetUser: string;
  note?: string;
  itemId: string;
};

export type AbsenceCalendarDayGroup = {
  date: string;
  entries: AbsenceCalendarDayEntry[];
};

export const formatAbsenceCalendarDayHeader = (date: string): string =>
  `*${date} (${formatJstWeekdayShort(date)})*`;

export const groupAbsencesByJstDay = (
  records: AbsenceRecord[],
  from: string,
  to: string
): AbsenceCalendarDayGroup[] => {
  const dayMap = new Map<string, Map<string, AbsenceCalendarDayEntry>>();

  for (const record of records) {
    const overlapStart = record.startDate > from ? record.startDate : from;
    const overlapEnd = record.endDate < to ? record.endDate : to;
    if (overlapStart > overlapEnd) continue;

    let cursor = overlapStart;
    while (cursor <= overlapEnd) {
      let dayEntries = dayMap.get(cursor);
      if (!dayEntries) {
        dayEntries = new Map();
        dayMap.set(cursor, dayEntries);
      }
      dayEntries.set(record.itemId, {
        targetUser: record.targetUser,
        note: record.note,
        itemId: record.itemId
      });
      if (cursor === overlapEnd) break;
      cursor = addJstDays(cursor, 1);
    }
  }

  return [...dayMap.keys()]
    .sort()
    .map((date) => ({
      date,
      entries: [...(dayMap.get(date)?.values() ?? [])].sort(
        (left, right) =>
          left.targetUser.localeCompare(right.targetUser) || left.itemId.localeCompare(right.itemId)
      )
    }));
};

export const flattenAbsenceCalendarDayGroups = (groups: AbsenceCalendarDayGroup[]): string[] => {
  const lines: string[] = [];
  for (const group of groups) {
    lines.push(formatAbsenceCalendarDayHeader(group.date));
    for (const entry of group.entries) {
      lines.push(formatAttendanceNoticeLine(entry.targetUser, entry.note));
    }
  }
  return lines;
};
