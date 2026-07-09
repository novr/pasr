import type { AppConfig } from "../config";
import { checkChannelNotifySettingsSchema } from "./schema-check";
import { getDb } from "./client";

export type ChannelNotifySetting = {
  channelId: string;
  notifyWhenEmpty: boolean;
  updatedAt: string;
  updatedBy: string;
};

const CHANNEL_NOTIFY_TABLE = "channel_notify_settings";

export const hasChannelNotifySettingsTable = async (config: AppConfig): Promise<boolean> =>
  (await checkChannelNotifySettingsSchema(config)) === "ok";

export const assertChannelNotifySettingsTable = async (config: AppConfig): Promise<void> => {
  if (!(await hasChannelNotifySettingsTable(config))) {
    throw new Error("channel_notify_settings_missing");
  }
};

export const loadChannelNotifySettingsMap = async (config: AppConfig): Promise<Map<string, boolean>> => {
  const map = new Map<string, boolean>();
  if (!(await hasChannelNotifySettingsTable(config))) {
    console.warn(JSON.stringify({ level: "warn", event: "channel_notify_settings_table_missing" }));
    return map;
  }
  const result = await getDb(config)
    .prepare(`SELECT channel_id, notify_when_empty FROM ${CHANNEL_NOTIFY_TABLE}`)
    .all<{ channel_id: string; notify_when_empty: number }>();
  for (const row of result.results ?? []) {
    map.set(row.channel_id, row.notify_when_empty !== 0);
  }
  return map;
};

export const upsertChannelNotifySetting = async (
  config: AppConfig,
  channelId: string,
  notifyWhenEmpty: boolean,
  updatedBy: string
): Promise<void> => {
  const timestamp = new Date().toISOString();
  await getDb(config)
    .prepare(
      `INSERT INTO ${CHANNEL_NOTIFY_TABLE} (
        channel_id, notify_when_empty, updated_at, updated_by
      ) VALUES (?, ?, ?, ?)
      ON CONFLICT(channel_id) DO UPDATE SET
        notify_when_empty = excluded.notify_when_empty,
        updated_at = excluded.updated_at,
        updated_by = excluded.updated_by`
    )
    .bind(channelId, notifyWhenEmpty ? 1 : 0, timestamp, updatedBy)
    .run();
};

export const deleteChannelNotifySetting = async (config: AppConfig, channelId: string): Promise<void> => {
  await getDb(config).prepare(`DELETE FROM ${CHANNEL_NOTIFY_TABLE} WHERE channel_id = ?`).bind(channelId).run();
};

export const getChannelNotifySetting = async (
  config: AppConfig,
  channelId: string
): Promise<ChannelNotifySetting | undefined> => {
  if (!(await hasChannelNotifySettingsTable(config))) return undefined;
  const row = await getDb(config)
    .prepare(`SELECT * FROM ${CHANNEL_NOTIFY_TABLE} WHERE channel_id = ?`)
    .bind(channelId)
    .first<{
      channel_id: string;
      notify_when_empty: number;
      updated_at: string;
      updated_by: string;
    }>();
  if (!row) return undefined;
  return {
    channelId: row.channel_id,
    notifyWhenEmpty: row.notify_when_empty !== 0,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  };
};

export const listChannelNotifySettings = async (config: AppConfig): Promise<ChannelNotifySetting[]> => {
  if (!(await hasChannelNotifySettingsTable(config))) return [];
  const result = await getDb(config)
    .prepare(`SELECT * FROM ${CHANNEL_NOTIFY_TABLE} ORDER BY channel_id`)
    .all<{
      channel_id: string;
      notify_when_empty: number;
      updated_at: string;
      updated_by: string;
    }>();
  return (result.results ?? []).map((row) => ({
    channelId: row.channel_id,
    notifyWhenEmpty: row.notify_when_empty !== 0,
    updatedAt: row.updated_at,
    updatedBy: row.updated_by
  }));
};
export const resolveNotifyWhenEmpty = (
  channelId: string,
  settingsMap: Map<string, boolean>,
  orgDefault: boolean
): boolean => {
  if (settingsMap.has(channelId)) {
    return settingsMap.get(channelId) ?? orgDefault;
  }
  return orgDefault;
};
