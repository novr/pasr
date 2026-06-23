export const MEMBER_MASTER_LIST_NAME = "member_master";
export const MEMBER_MASTER_SCHEMA_VERSION = 2;

export const memberMasterSchema = [
  {
    key: "member_key",
    name: "Member Key",
    type: "text",
    is_primary_column: true
  },
  {
    key: "target_user",
    name: "Target User",
    type: "user",
    options: { format: "single_entity", notify_users: false }
  },
  {
    key: "default_notify_channels",
    name: "Default Notify Channels",
    type: "channel",
    options: { format: "multi_entity" }
  },
  {
    key: "default_notify_users",
    name: "Default Notify Users",
    type: "user",
    options: { format: "multi_entity", notify_users: false }
  },
  {
    key: "active",
    name: "Active",
    type: "checkbox"
  }
] as const;

export type MemberMasterColumnIds = {
  primaryText: string;
  targetUser: string;
  defaultNotifyChannels?: string;
  defaultNotifyUsers?: string;
  active: string;
};

export type MemberMasterRow = {
  itemId: string;
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
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
};
