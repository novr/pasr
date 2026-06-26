import type { SlackListItem } from "../import/slack-list-read";
import { toNoteText } from "./rich-text-plain";
import { pickListField, toStringArray, toStringValue } from "./slack-list-value";

export const ABSENCE_LIST_NAME = "absence_list";
export const ABSENCE_SCHEMA_VERSION = 1;
export const DEFAULT_ABSENCE_TYPE = "absence";

export const absenceSchema = [
  { key: "absence_title", name: "Absence", type: "text", is_primary_column: true },
  {
    key: "target_user",
    name: "Target User",
    type: "user",
    options: { format: "single_entity", notify_users: false }
  },
  { key: "start_date", name: "Start Date", type: "date" },
  { key: "end_date", name: "End Date", type: "date" },
  {
    key: "type",
    name: "Type",
    type: "select",
    options: {
      format: "single_select",
      choices: [{ value: DEFAULT_ABSENCE_TYPE, label: "不在", color: "blue" }]
    }
  },
  { key: "notify_channels", name: "Notify Channels", type: "channel", options: { format: "multi_entity" } },
  {
    key: "notify_users",
    name: "Notify Users",
    type: "user",
    options: { format: "multi_entity", notify_users: false }
  },
  { key: "note", name: "Note", type: "text" }
] as const;

export type AbsenceRecord = {
  itemId: string;
  targetUser: string;
  absenceType?: string;
  startDate: string;
  endDate: string;
  notifyChannels: string[];
  notifyUsers: string[];
  note?: string;
};

export type SkipReason =
  | "missing_target_user"
  | "missing_start_date"
  | "missing_notify_channels"
  | "invalid_date_range"
  | "inactive_user_master";

type ParseResult =
  | { ok: true; record: AbsenceRecord }
  | { ok: false; itemId: string; reason: SkipReason };

export const parseAbsence = (item: SlackListItem): ParseResult => {
  const targetUser = toStringValue(pickListField(item, "target_user"));
  const absenceType = toStringValue(pickListField(item, "type"));
  const startDate = toStringValue(pickListField(item, "start_date"));
  const endDateRaw = toStringValue(pickListField(item, "end_date"));
  const notifyChannels = toStringArray(pickListField(item, "notify_channels"));
  const notifyUsers = toStringArray(pickListField(item, "notify_users"));
  const note = toNoteText(pickListField(item, "note"));
  const endDate = endDateRaw || startDate;

  if (!targetUser) return { ok: false, itemId: item.id, reason: "missing_target_user" };
  if (!startDate) return { ok: false, itemId: item.id, reason: "missing_start_date" };
  if (startDate > endDate) return { ok: false, itemId: item.id, reason: "invalid_date_range" };

  return {
    ok: true,
    record: {
      itemId: item.id,
      targetUser,
      absenceType: absenceType || undefined,
      startDate,
      endDate,
      notifyChannels: [...new Set(notifyChannels)],
      notifyUsers: [...new Set(notifyUsers)],
      note: note || undefined
    }
  };
};

export const filterToday = (records: AbsenceRecord[], todayJst: string): AbsenceRecord[] =>
  records.filter((record) => record.startDate <= todayJst && todayJst <= record.endDate);

export const filterEndedBefore = (records: AbsenceRecord[], todayJst: string): AbsenceRecord[] =>
  records.filter((record) => record.endDate < todayJst);

export const filterOwnFutureAbsences = (
  records: AbsenceRecord[],
  userId: string,
  todayJst: string
): AbsenceRecord[] =>
  records
    .filter((record) => record.targetUser === userId && record.endDate >= todayJst)
    .sort((a, b) => a.startDate.localeCompare(b.startDate) || a.itemId.localeCompare(b.itemId));

export const findOwnAbsenceByStartDate = (
  records: AbsenceRecord[],
  userId: string,
  startDate: string,
  todayJst: string
): AbsenceRecord[] =>
  records.filter(
    (record) =>
      record.targetUser === userId && record.startDate === startDate && record.endDate >= todayJst
  );

export const groupByChannel = (records: AbsenceRecord[]): Map<string, AbsenceRecord[]> => {
  const grouped = new Map<string, AbsenceRecord[]>();
  for (const record of records) {
    for (const channel of record.notifyChannels) {
      const current = grouped.get(channel) ?? [];
      current.push(record);
      grouped.set(channel, current);
    }
  }
  return grouped;
};
