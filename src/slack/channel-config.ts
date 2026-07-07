import type { AppConfig } from "../config";
import {
  assertChannelNotifySettingsTable,
  deleteChannelNotifySetting,
  getChannelNotifySetting,
  listChannelNotifySettings,
  loadChannelNotifySettingsMap,
  resolveNotifyWhenEmpty,
  upsertChannelNotifySetting
} from "../db/channel-notify-repository";
import { parseChannelConfigCommand } from "./admin-command-parse";
import type { SlackCommandPayload } from "./command";

const formatNotifyWhenEmpty = (value: boolean): string => (value ? "on" : "off");

const formatChannelConfigList = async (config: AppConfig): Promise<string> => {
  const settings = await listChannelNotifySettings(config);
  if (settings.length === 0) {
    return `CH 別 0件時通知の上書きはありません（org default: ${formatNotifyWhenEmpty(config.notifyEmptyDefault)}）`;
  }
  const lines = settings.map(
    (setting) =>
      `<#${setting.channelId}>: ${formatNotifyWhenEmpty(setting.notifyWhenEmpty)} (by ${setting.updatedBy})`
  );
  return [`org default: ${formatNotifyWhenEmpty(config.notifyEmptyDefault)}`, ...lines].join("\n");
};

export const handleChannelConfigCommand = async (
  config: AppConfig,
  payload: SlackCommandPayload
): Promise<string> => {
  const parsed = parseChannelConfigCommand(payload.text);
  if (!parsed) {
    return "使い方: /pasr-admin channel-config empty on|off|default | list";
  }
  if (parsed.kind === "invalid") {
    return parsed.message;
  }

  try {
    await assertChannelNotifySettingsTable(config);
  } catch {
    return "db: schema_missing（channel_notify_settings）。`npx wrangler d1 migrations apply` を実行してください。";
  }

  if (parsed.kind === "list") {
    return formatChannelConfigList(config);
  }
  if (!payload.channelId.startsWith("C")) {
    return "このコマンドはチャンネル内でのみ実行できます。";
  }

  const channelId = payload.channelId;
  if (parsed.value === "default") {
    await deleteChannelNotifySetting(config, channelId);
  } else {
    await upsertChannelNotifySetting(config, channelId, parsed.value === "on", payload.userId);
  }

  const settingsMap = await loadChannelNotifySettingsMap(config);
  const effective = resolveNotifyWhenEmpty(channelId, settingsMap, config.notifyEmptyDefault);
  const override = await getChannelNotifySetting(config, channelId);
  const source = override ? "channel override" : "org default";
  return [
    `<#${channelId}> の 0件時通知: ${formatNotifyWhenEmpty(effective)}（${source}）`,
    `設定: empty ${parsed.value}`
  ].join("\n");
};
