import type { AppConfig } from "../config";
import {
  assertChannelNotifySettingsTable,
  deleteChannelNotifySetting,
  getChannelNotifySetting,
  isEmptyNotifyCandidate,
  listChannelNotifySettings,
  loadChannelNotifySettingsMap,
  willReceiveEmptyNotify,
  upsertChannelNotifySetting
} from "../db/channel-notify-repository";
import type { ValidChannelConfigCommand } from "./admin-command-parse";
import type { SlackCommandPayload } from "./command";

const formatNotifyWhenEmpty = (value: boolean): string => (value ? "on" : "off");

const formatEmptyNotifyDetail = (
  config: AppConfig,
  channelId: string,
  hasOverride: boolean,
  overrideOn: boolean | undefined
): string => {
  if (hasOverride) {
    return `channel override ${formatNotifyWhenEmpty(Boolean(overrideOn))}`;
  }
  if (config.noticeChannels.includes(channelId)) {
    return `notice CH / org default ${formatNotifyWhenEmpty(config.notifyEmptyDefault)}`;
  }
  return "notice 外（empty on でオプトイン）";
};

const formatCurrentChannelEmptyNotify = async (
  config: AppConfig,
  channelId: string
): Promise<string> => {
  const settingsMap = await loadChannelNotifySettingsMap(config);
  const override = await getChannelNotifySetting(config, channelId);
  const willReceive = willReceiveEmptyNotify(
    channelId,
    config.noticeChannels,
    settingsMap,
    config.notifyEmptyDefault
  );
  const detail = formatEmptyNotifyDetail(
    config,
    channelId,
    Boolean(override),
    override?.notifyWhenEmpty
  );
  const lines = [
    `<#${channelId}> の空日「予定なし」: ${willReceive ? "配信する" : "配信しない"}（${detail}）`
  ];
  if (!isEmptyNotifyCandidate(channelId, config.noticeChannels, settingsMap) && !override) {
    lines.push("※ notice 外の CH は empty on でオプトイン");
  }
  return lines.join("\n");
};

const formatChannelConfigList = async (config: AppConfig): Promise<string> => {
  const settings = await listChannelNotifySettings(config);
  const header = [
    `org default: ${formatNotifyWhenEmpty(config.notifyEmptyDefault)}`,
    "空日の配信対象: notice CH（org default）と empty on の上書きのみ"
  ];
  if (settings.length === 0) {
    return [...header, "CH 別上書きはありません"].join("\n");
  }
  const lines = settings.map(
    (setting) =>
      `<#${setting.channelId}>: ${formatNotifyWhenEmpty(setting.notifyWhenEmpty)} (by ${setting.updatedBy})`
  );
  return [...header, ...lines].join("\n");
};

export const handleChannelConfigCommand = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  parsed: ValidChannelConfigCommand
): Promise<string> => {
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
  if (parsed.kind === "status") {
    return formatCurrentChannelEmptyNotify(config, channelId);
  }
  if (parsed.kind !== "empty") {
    const _never: never = parsed;
    return _never;
  }

  if (parsed.value === "default") {
    await deleteChannelNotifySetting(config, channelId);
  } else {
    await upsertChannelNotifySetting(config, channelId, parsed.value === "on", payload.userId);
  }

  const status = await formatCurrentChannelEmptyNotify(config, channelId);
  return [`${status}`, `設定: empty ${parsed.value}`].join("\n");
};
