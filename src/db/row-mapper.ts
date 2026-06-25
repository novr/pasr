import { DEFAULT_ABSENCE_TYPE, type AbsenceRecord } from "../domain/absence";
import type { RegistrationNotifyMode } from "../domain/absence-registration";
import { deserializeJsonArray } from "./json-columns";

export type AbsenceRow = {
  id: string;
  target_user: string;
  start_date: string;
  end_date: string;
  absence_type: string;
  notify_channels: string;
  notify_users: string;
  note: string | null;
  created_at: string;
  updated_at: string;
};

export type MemberMasterRow = {
  target_user: string;
  active: number;
  default_notify_channels: string;
  default_notify_users: string;
  default_registration_notify: string;
  updated_at: string;
};

export const rowToAbsenceRecord = (row: AbsenceRow): AbsenceRecord => ({
  itemId: row.id,
  targetUser: row.target_user,
  absenceType: row.absence_type || DEFAULT_ABSENCE_TYPE,
  startDate: row.start_date,
  endDate: row.end_date,
  notifyChannels: deserializeJsonArray(row.notify_channels),
  notifyUsers: deserializeJsonArray(row.notify_users),
  note: row.note ?? undefined
});

export const rowToMemberMaster = (
  row: MemberMasterRow
): {
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
  updatedTimestamp: number;
} => ({
  targetUser: row.target_user,
  active: row.active !== 0,
  defaultNotifyChannels: deserializeJsonArray(row.default_notify_channels),
  defaultNotifyUsers: deserializeJsonArray(row.default_notify_users),
  defaultRegistrationNotify: row.default_registration_notify as RegistrationNotifyMode,
  updatedTimestamp: Date.parse(row.updated_at) || 0
});

export type MemberMasterActiveRecord = {
  targetUser: string;
  active: boolean;
};
