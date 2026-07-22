import type { AppConfig } from "../config";
import { getDb } from "./client";

export type DbSchemaStatus = "ok" | "schema_missing";
export type ChannelNotifySettingsSchemaStatus = "ok" | "schema_missing";
export type SlackUserOAuthSchemaStatus = "ok" | "schema_missing";
export type MemberMasterStatusPrefsSchemaStatus = "ok" | "schema_missing";

const CHANNEL_NOTIFY_SETTINGS_TABLE = "channel_notify_settings";
const SLACK_USER_OAUTH_TABLE = "slack_user_oauth";

export const checkDbSchema = async (config: AppConfig): Promise<DbSchemaStatus> => {
  const db = getDb(config);
  const result = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('absences', 'member_master')`
    )
    .all<{ name: string }>();
  const names = new Set((result.results ?? []).map((row) => row.name));
  if (!names.has("absences") || !names.has("member_master")) {
    return "schema_missing";
  }
  return "ok";
};

export const checkChannelNotifySettingsSchema = async (
  config: AppConfig
): Promise<ChannelNotifySettingsSchemaStatus> => {
  const row = await getDb(config)
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = ?`
    )
    .bind(CHANNEL_NOTIFY_SETTINGS_TABLE)
    .first<{ name: string }>();
  return row?.name === CHANNEL_NOTIFY_SETTINGS_TABLE ? "ok" : "schema_missing";
};

export const checkSlackUserOAuthSchema = async (
  config: AppConfig
): Promise<SlackUserOAuthSchemaStatus> => {
  const row = await getDb(config)
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name = ?`
    )
    .bind(SLACK_USER_OAUTH_TABLE)
    .first<{ name: string }>();
  return row?.name === SLACK_USER_OAUTH_TABLE ? "ok" : "schema_missing";
};

export const checkMemberMasterStatusPrefsSchema = async (
  config: AppConfig
): Promise<MemberMasterStatusPrefsSchemaStatus> => {
  const row = await getDb(config)
    .prepare(`PRAGMA table_info(member_master)`)
    .all<{ name: string }>();
  const hasStatusDefaultText = (row.results ?? []).some((column) => column.name === "status_default_text");
  const hasStatusEmoji = (row.results ?? []).some((column) => column.name === "status_emoji");
  return hasStatusDefaultText && hasStatusEmoji ? "ok" : "schema_missing";
};

export class DbSchemaMismatchError extends Error {
  constructor() {
    super("db_schema_mismatch");
    this.name = "DbSchemaMismatchError";
  }
}

export const assertDbSchema = async (config: AppConfig): Promise<void> => {
  const status = await checkDbSchema(config);
  if (status !== "ok") {
    console.error(JSON.stringify({ level: "error", event: "db_schema_mismatch" }));
    throw new DbSchemaMismatchError();
  }
};
