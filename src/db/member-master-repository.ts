import type { AppConfig } from "../config";
import type { RegistrationNotifyMode } from "../domain/absence-registration";
import { getDb } from "./client";
import { checkMemberMasterStatusPrefsSchema } from "./schema-check";
import { serializeJsonArray } from "./json-columns";
import { rowToMemberMaster, type MemberMasterRow } from "./row-mapper";

const nowIso = (): string => new Date().toISOString();

export type MemberMasterRecord = {
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
  statusDefaultText?: string;
  statusEmoji?: string;
};

export type MemberMasterStatusPrefs = {
  statusDefaultText?: string;
  statusEmoji?: string;
};

const toMemberMasterRecord = (mapped: ReturnType<typeof rowToMemberMaster>): MemberMasterRecord => ({
  targetUser: mapped.targetUser,
  active: mapped.active,
  defaultNotifyChannels: mapped.defaultNotifyChannels,
  defaultNotifyUsers: mapped.defaultNotifyUsers,
  defaultRegistrationNotify: mapped.defaultRegistrationNotify,
  statusDefaultText: mapped.statusDefaultText,
  statusEmoji: mapped.statusEmoji
});

export const getMemberMaster = async (
  config: AppConfig,
  targetUser: string
): Promise<MemberMasterRecord | undefined> => {
  const row = await getDb(config)
    .prepare("SELECT * FROM member_master WHERE target_user = ?")
    .bind(targetUser)
    .first<MemberMasterRow>();
  if (!row) return undefined;
  return toMemberMasterRecord(rowToMemberMaster(row));
};

export const upsertMemberMaster = async (
  config: AppConfig,
  record: MemberMasterRecord
): Promise<void> => {
  const timestamp = nowIso();
  const statusPrefsSchema = await checkMemberMasterStatusPrefsSchema(config);
  if (statusPrefsSchema !== "ok") {
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
    return;
  }
  await getDb(config)
    .prepare(
      `INSERT INTO member_master (
        target_user, active, default_notify_channels, default_notify_users,
        default_registration_notify, status_default_text, status_emoji, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(target_user) DO UPDATE SET
        active = excluded.active,
        default_notify_channels = excluded.default_notify_channels,
        default_notify_users = excluded.default_notify_users,
        default_registration_notify = excluded.default_registration_notify,
        status_default_text = excluded.status_default_text,
        status_emoji = excluded.status_emoji,
        updated_at = excluded.updated_at`
    )
    .bind(
      record.targetUser,
      record.active ? 1 : 0,
      serializeJsonArray(record.defaultNotifyChannels),
      serializeJsonArray(record.defaultNotifyUsers),
      record.defaultRegistrationNotify,
      record.statusDefaultText ?? null,
      record.statusEmoji ?? null,
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
    defaultNotifyChannels: config.noticeChannels.length > 0 ? [...config.noticeChannels] : [],
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

export const listMemberMasterStatusPrefsForUserIds = async (
  config: AppConfig,
  userIds: string[]
): Promise<Map<string, MemberMasterStatusPrefs>> => {
  const map = new Map<string, MemberMasterStatusPrefs>();
  if (userIds.length === 0) return map;
  if ((await checkMemberMasterStatusPrefsSchema(config)) !== "ok") return map;

  const placeholders = userIds.map(() => "?").join(", ");
  const result = await getDb(config)
    .prepare(
      `SELECT target_user, status_default_text, status_emoji
       FROM member_master
       WHERE target_user IN (${placeholders})`
    )
    .bind(...userIds)
    .all<{
      target_user: string;
      status_default_text: string | null;
      status_emoji: string | null;
    }>();

  for (const row of result.results ?? []) {
    const statusDefaultText = row.status_default_text?.trim() || undefined;
    const statusEmoji = row.status_emoji?.trim() || undefined;
    if (!statusDefaultText && !statusEmoji) continue;
    map.set(row.target_user, { statusDefaultText, statusEmoji });
  }
  return map;
};

export const listMemberMasterRecords = async (
  config: AppConfig,
  options: { limit: number; offset?: number }
): Promise<MemberMasterRecord[]> => {
  const offset = options.offset ?? 0;
  const result = await getDb(config)
    .prepare(
      `SELECT * FROM member_master
       ORDER BY active DESC, target_user ASC
       LIMIT ? OFFSET ?`
    )
    .bind(options.limit, offset)
    .all<MemberMasterRow>();
  return (result.results ?? []).map((row) => toMemberMasterRecord(rowToMemberMaster(row)));
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
        default_registration_notify, status_default_text, status_emoji, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.targetUser,
      record.active ? 1 : 0,
      serializeJsonArray(record.defaultNotifyChannels),
      serializeJsonArray(record.defaultNotifyUsers),
      record.defaultRegistrationNotify,
      record.statusDefaultText ?? null,
      record.statusEmoji ?? null,
      updatedAt
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
};
