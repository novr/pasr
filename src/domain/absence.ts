export const DEFAULT_ABSENCE_TYPE = "absence";

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
