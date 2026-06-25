import type { AppConfig } from "../config";
import type { RegistrationNotifyMode } from "../domain/absence-registration";
import { getDb } from "./client";
import { serializeJsonArray } from "./json-columns";
import { rowToMemberMaster, type MemberMasterRow } from "./row-mapper";

const nowIso = (): string => new Date().toISOString();

export type MemberMasterRecord = {
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
};

export const getMemberMaster = async (
  config: AppConfig,
  targetUser: string
): Promise<MemberMasterRecord | undefined> => {
  const row = await getDb(config)
    .prepare("SELECT * FROM member_master WHERE target_user = ?")
    .bind(targetUser)
    .first<MemberMasterRow>();
  if (!row) return undefined;
  const mapped = rowToMemberMaster(row);
  return {
    targetUser: mapped.targetUser,
    active: mapped.active,
    defaultNotifyChannels: mapped.defaultNotifyChannels,
    defaultNotifyUsers: mapped.defaultNotifyUsers,
    defaultRegistrationNotify: mapped.defaultRegistrationNotify
  };
};

export const upsertMemberMaster = async (
  config: AppConfig,
  record: MemberMasterRecord
): Promise<void> => {
  const timestamp = nowIso();
  await getDb(config)
    .prepare(
      `INSERT INTO member_master (
        target_user, active, default_notify_channels, default_notify_users,
        default_registration_notify, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_user) DO UPDATE SET
        active = excluded.active,
        default_notify_channels = excluded.default_notify_channels,
        default_notify_users = excluded.default_notify_users,
        default_registration_notify = excluded.default_registration_notify,
        updated_at = excluded.updated_at`
    )
    .bind(
      record.targetUser,
      record.active ? 1 : 0,
      serializeJsonArray(record.defaultNotifyChannels),
      serializeJsonArray(record.defaultNotifyUsers),
      record.defaultRegistrationNotify,
      timestamp
    )
    .run();
};

export const ensureMemberMasterActive = async (
  config: AppConfig,
  targetUser: string
): Promise<MemberMasterRecord> => {
  const existing = await getMemberMaster(config, targetUser);
  if (existing) return existing;
  const created: MemberMasterRecord = {
    targetUser,
    active: true,
    defaultNotifyChannels: [],
    defaultNotifyUsers: [],
    defaultRegistrationNotify: "none"
  };
  await upsertMemberMaster(config, created);
  return created;
};

export const loadMemberMasterActiveMap = async (
  config: AppConfig
): Promise<Map<string, { targetUser: string; active: boolean }>> => {
  const result = await getDb(config).prepare("SELECT target_user, active FROM member_master").all<{
    target_user: string;
    active: number;
  }>();
  const map = new Map<string, { targetUser: string; active: boolean }>();
  for (const row of result.results ?? []) {
    if (map.has(row.target_user)) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "duplicate_member_master_user",
          targetUser: row.target_user
        })
      );
      continue;
    }
    map.set(row.target_user, { targetUser: row.target_user, active: row.active !== 0 });
  }
  return map;
};

export const countMemberMaster = async (config: AppConfig): Promise<number> => {
  const row = await getDb(config)
    .prepare("SELECT COUNT(*) AS count FROM member_master")
    .first<{ count: number }>();
  return row?.count ?? 0;
};

export const insertMemberMasterOrIgnore = async (
  config: AppConfig,
  record: MemberMasterRecord,
  updatedAt: string
): Promise<boolean> => {
  const result = await getDb(config)
    .prepare(
      `INSERT OR IGNORE INTO member_master (
        target_user, active, default_notify_channels, default_notify_users,
        default_registration_notify, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.targetUser,
      record.active ? 1 : 0,
      serializeJsonArray(record.defaultNotifyChannels),
      serializeJsonArray(record.defaultNotifyUsers),
      record.defaultRegistrationNotify,
      updatedAt
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
};
