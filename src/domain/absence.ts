import type { SlackListItem } from "../slack/api";

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
  | "invalid_date_range";

type ParseResult =
  | { ok: true; record: AbsenceRecord }
  | { ok: false; itemId: string; reason: SkipReason };

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

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const tryKeys = (obj: Record<string, unknown>, keys: string[]): string => {
  for (const key of keys) {
    const raw = obj[key];
    if (typeof raw === "string" && raw.length > 0) return raw;
  }
  return "";
};

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  const obj = asRecord(value);
  if (obj) {
    const direct = tryKeys(obj, [
      "id",
      "user_id",
      "channel_id",
      "entity_id",
      "value",
      "name",
      "username",
      "email",
      "date"
    ]);
    if (direct) return direct;

    const nestedValue = obj.value;
    if (nestedValue) {
      const nested = toStringValue(nestedValue);
      if (nested) return nested;
    }
    const nestedUser = obj.user;
    if (nestedUser) {
      const nested = toStringValue(nestedUser);
      if (nested) return nested;
    }
    const nestedChannel = obj.channel;
    if (nestedChannel) {
      const nested = toStringValue(nestedChannel);
      if (nested) return nested;
    }
  }
  return "";
};

const toStringArray = (value: unknown): string[] => {
  const obj = asRecord(value);
  if (obj) {
    const entityArrays = [obj.user, obj.channel, obj.select, obj.date];
    for (const candidate of entityArrays) {
      if (Array.isArray(candidate)) {
        return candidate
          .map((entry) => toStringValue(entry))
          .filter((entry) => entry.length > 0);
      }
    }
    const single = toStringValue(value);
    return single ? [single] : [];
  }

  if (!Array.isArray(value)) return [];
  return value
    .map((entry) => toStringValue(entry))
    .filter((entry) => entry.length > 0);
};

export const parseAbsence = (item: SlackListItem): ParseResult => {
  const targetUser = toStringValue(pick(item, "target_user"));
  const absenceType = toStringValue(pick(item, "type"));
  const startDate = toStringValue(pick(item, "start_date"));
  const endDateRaw = toStringValue(pick(item, "end_date"));
  const notifyChannels = toStringArray(pick(item, "notify_channels"));
  const notifyUsers = toStringArray(pick(item, "notify_users"));
  const note = toStringValue(pick(item, "note"));
  const endDate = endDateRaw || startDate;

  if (!targetUser) return { ok: false, itemId: item.id, reason: "missing_target_user" };
  if (!startDate) return { ok: false, itemId: item.id, reason: "missing_start_date" };
  if (notifyChannels.length === 0) {
    return { ok: false, itemId: item.id, reason: "missing_notify_channels" };
  }
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
