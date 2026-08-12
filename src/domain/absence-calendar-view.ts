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

export type AbsenceCalendarPaginationResult = {
  pageGroups: AbsenceCalendarDayGroup[];
  currentPage: number;
  totalPages: number;
  totalDays: number;
  totalEntryCount: number;
  remainingEntryCount: number;
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

const explodeOversizedDayGroups = (
  groups: AbsenceCalendarDayGroup[],
  pageSize: number
): AbsenceCalendarDayGroup[] => {
  const exploded: AbsenceCalendarDayGroup[] = [];
  for (const group of groups) {
    if (group.entries.length <= pageSize) {
      exploded.push(group);
      continue;
    }
    for (let offset = 0; offset < group.entries.length; offset += pageSize) {
      exploded.push({
        date: group.date,
        entries: group.entries.slice(offset, offset + pageSize)
      });
    }
  }
  return exploded;
};

const buildAbsenceCalendarPages = (
  groups: AbsenceCalendarDayGroup[],
  pageSize: number
): AbsenceCalendarDayGroup[][] => {
  const pages: AbsenceCalendarDayGroup[][] = [];
  let currentPage: AbsenceCalendarDayGroup[] = [];
  let currentEntryCount = 0;

  const flushCurrentPage = (): void => {
    if (currentPage.length === 0) return;
    pages.push(currentPage);
    currentPage = [];
    currentEntryCount = 0;
  };

  for (const group of groups) {
    const groupSize = group.entries.length;
    if (currentPage.length === 0) {
      currentPage.push(group);
      currentEntryCount = groupSize;
      if (groupSize >= pageSize) flushCurrentPage();
      continue;
    }
    if (currentEntryCount + groupSize <= pageSize) {
      currentPage.push(group);
      currentEntryCount += groupSize;
      continue;
    }
    flushCurrentPage();
    currentPage.push(group);
    currentEntryCount = groupSize;
    if (groupSize >= pageSize) flushCurrentPage();
  }

  flushCurrentPage();
  return pages;
};

export const paginateAllAbsenceCalendarLinePages = (
  groups: AbsenceCalendarDayGroup[],
  pageSize: number
): string[][] => {
  const pages = buildAbsenceCalendarPages(explodeOversizedDayGroups(groups, pageSize), pageSize);
  return pages.map((pageGroups) => flattenAbsenceCalendarDayGroups(pageGroups));
};

export const paginateAbsenceCalendarDayGroups = (
  groups: AbsenceCalendarDayGroup[],
  page: number,
  pageSize: number
): AbsenceCalendarPaginationResult => {
  const totalDays = groups.length;
  const totalEntryCount = groups.reduce((sum, group) => sum + group.entries.length, 0);
  const pages = buildAbsenceCalendarPages(explodeOversizedDayGroups(groups, pageSize), pageSize);
  const totalPages = Math.max(1, pages.length);
  const currentPage = Math.min(Math.max(1, page), totalPages);
  const pageGroups = pages[currentPage - 1] ?? [];

  const entriesBeforeCurrentPage = pages
    .slice(0, currentPage - 1)
    .reduce(
      (sum, pageGroup) => sum + pageGroup.reduce((groupSum, group) => groupSum + group.entries.length, 0),
      0
    );
  const entriesOnCurrentPage = pageGroups.reduce((sum, group) => sum + group.entries.length, 0);
  const remainingEntryCount = Math.max(0, totalEntryCount - entriesBeforeCurrentPage - entriesOnCurrentPage);

  return {
    pageGroups,
    currentPage,
    totalPages,
    totalDays,
    totalEntryCount,
    remainingEntryCount
  };
};
