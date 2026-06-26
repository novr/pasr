import type { RegistrationNotifyMode } from "./absence-registration";

export type MemberMasterRow = {
  itemId: string;
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
  updatedTimestamp: number;
};

export type ResolveMemberMasterRecordResult = {
  kept: string;
  deleted: string[];
  created: boolean;
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
};
