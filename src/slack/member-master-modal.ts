import type { AppConfig } from "../config";
import { isStatusOAuthEnabled } from "../config";
import {
  REGISTRATION_NOTIFY_SELECT_OPTIONS,
  parseRegistrationNotifyMode,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import type { MemberMasterRecord } from "../db/member-master-repository";
import {
  normalizeStatusDefaultTextInput,
  normalizeStatusEmojiInput,
  validateStatusDefaultText,
  validateStatusEmoji
} from "../domain/status-profile";
import { checkMemberMasterStatusPrefsSchema } from "../db/schema-check";
import { resolveMasterContext } from "./member-master-context";
import { slackApi } from "./api";

export const MEMBER_MASTER_MODAL_CALLBACK_ID = "pasr_member_master_update";

export const STATUS_DEFAULT_TEXT_BLOCK_ID = "status_default_text_block";
export const STATUS_EMOJI_BLOCK_ID = "status_emoji_block";

export type MemberMasterSubmissionResult =
  | {
      ok: true;
      record: Omit<MemberMasterRecord, "targetUser" | "statusDefaultText" | "statusEmoji"> & {
        statusDefaultText?: string | null;
        statusEmoji?: string | null;
      };
    }
  | { ok: false; error: string; errorBlockId: string };

const parseSelectedChannels = (value: unknown): string[] => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_conversations;
  if (!Array.isArray(selected)) return [];
  return selected.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const parseSelectedUsers = (value: unknown): string[] => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_users;
  if (!Array.isArray(selected)) return [];
  return selected.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const parseActiveValue = (value: unknown): boolean => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selectedOptions = record?.selected_options;
  if (!Array.isArray(selectedOptions)) return false;
  return selectedOptions.some((option) => {
    const optionRecord = option && typeof option === "object" ? (option as Record<string, unknown>) : null;
    return optionRecord?.value === "active";
  });
};

const parseStaticSelectValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const option = record?.selected_option;
  if (!option || typeof option !== "object") return "";
  const optionRecord = option as Record<string, unknown>;
  return typeof optionRecord.value === "string" ? optionRecord.value : "";
};

const parsePlainTextInput = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  return typeof record?.value === "string" ? record.value : "";
};

const buildRegistrationNotifySelectElement = (
  initialMode: RegistrationNotifyMode
): Record<string, unknown> => {
  const options = REGISTRATION_NOTIFY_SELECT_OPTIONS.map((option) => ({
    text: { type: "plain_text", text: option.label },
    value: option.value
  }));
  const initialOption = options.find((option) => option.value === initialMode) ?? options[0];
  return {
    type: "static_select",
    action_id: "default_registration_notify_select",
    options,
    initial_option: initialOption
  };
};

const buildStatusBlocks = (params: {
  config: AppConfig;
  statusDefaultText?: string;
  statusEmoji?: string;
}): Record<string, unknown>[] => {
  const blocks: Record<string, unknown>[] = [
    {
      type: "section",
      text: {
        type: "mrkdwn",
        text: `*Status 設定*\n不在 note がある日は note が優先されます。\n組織既定: \`${params.config.statusDefaultText}\` / \`${params.config.statusEmoji}\``
      }
    }
  ];
  if (isStatusOAuthEnabled(params.config)) {
    blocks.push({
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "当日不在の scheduled 実行時に Slack Status へ反映されます。OAuth 連携が必要です。"
        }
      ]
    });
  }
  blocks.push(
    {
      type: "input",
      block_id: STATUS_DEFAULT_TEXT_BLOCK_ID,
      optional: true,
      label: { type: "plain_text", text: "Status デフォルト文言" },
      hint: { type: "plain_text", text: "note が空のときに使う文言。未入力なら組織既定を使用。" },
      element: {
        type: "plain_text_input",
        action_id: "status_default_text_input",
        max_length: 100,
        ...(params.statusDefaultText ? { initial_value: params.statusDefaultText } : {})
      }
    },
    {
      type: "input",
      block_id: STATUS_EMOJI_BLOCK_ID,
      optional: true,
      label: { type: "plain_text", text: "Status 絵文字" },
      hint: { type: "plain_text", text: "例: :date: または単一の絵文字。未入力なら組織既定を使用。" },
      element: {
        type: "plain_text_input",
        action_id: "status_emoji_input",
        ...(params.statusEmoji ? { initial_value: params.statusEmoji } : {})
      }
    }
  );
  return blocks;
};

export const buildMemberMasterModalView = (params: {
  userId: string;
  config: AppConfig;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
  statusPrefsEnabled: boolean;
  statusDefaultText?: string;
  statusEmoji?: string;
}): Record<string, unknown> => ({
  type: "modal",
  callback_id: MEMBER_MASTER_MODAL_CALLBACK_ID,
  private_metadata: JSON.stringify({
    userId: params.userId
  }),
  title: { type: "plain_text", text: "PASR Self Profile" },
  submit: { type: "plain_text", text: "Save" },
  close: { type: "plain_text", text: "Cancel" },
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: `更新対象: <@${params.userId}>` }
    },
    {
      type: "input",
      block_id: "active_block",
      optional: true,
      label: { type: "plain_text", text: "Active" },
      element: {
        type: "checkboxes",
        action_id: "active_checkbox",
        options: [{ text: { type: "plain_text", text: "通知対象として有効" }, value: "active" }],
        initial_options: params.active
          ? [{ text: { type: "plain_text", text: "通知対象として有効" }, value: "active" }]
          : []
      }
    },
    {
      type: "input",
      block_id: "channels_block",
      optional: true,
      label: { type: "plain_text", text: "Default Notify Channels" },
      element: {
        type: "multi_conversations_select",
        action_id: "default_channels_select",
        initial_conversations: params.defaultNotifyChannels
      }
    },
    {
      type: "input",
      block_id: "users_block",
      optional: true,
      label: { type: "plain_text", text: "Default Notify Users" },
      element: {
        type: "multi_users_select",
        action_id: "default_users_select",
        initial_users: params.defaultNotifyUsers
      }
    },
    {
      type: "input",
      block_id: "registration_notify_block",
      label: { type: "plain_text", text: "既定の登録通知" },
      element: buildRegistrationNotifySelectElement(params.defaultRegistrationNotify)
    },
    ...(params.statusPrefsEnabled
      ? buildStatusBlocks({
          config: params.config,
          statusDefaultText: params.statusDefaultText,
          statusEmoji: params.statusEmoji
        })
      : [])
  ]
});

export const parseMemberMasterSubmission = (
  values: Record<string, Record<string, unknown>>,
  options: { statusPrefsEnabled: boolean }
): MemberMasterSubmissionResult => {
  let statusDefaultText: string | null | undefined;
  let statusEmoji: string | null | undefined;

  if (options.statusPrefsEnabled && STATUS_DEFAULT_TEXT_BLOCK_ID in values) {
    const statusDefaultTextRaw = parsePlainTextInput(
      values[STATUS_DEFAULT_TEXT_BLOCK_ID]?.status_default_text_input
    );
    const statusDefaultTextError = validateStatusDefaultText(statusDefaultTextRaw);
    if (statusDefaultTextError) {
      return { ok: false, error: statusDefaultTextError, errorBlockId: STATUS_DEFAULT_TEXT_BLOCK_ID };
    }
    statusDefaultText = normalizeStatusDefaultTextInput(statusDefaultTextRaw) ?? null;
  }

  if (options.statusPrefsEnabled && STATUS_EMOJI_BLOCK_ID in values) {
    const statusEmojiRaw = parsePlainTextInput(values[STATUS_EMOJI_BLOCK_ID]?.status_emoji_input);
    const statusEmojiError = validateStatusEmoji(statusEmojiRaw);
    if (statusEmojiError) {
      return { ok: false, error: statusEmojiError, errorBlockId: STATUS_EMOJI_BLOCK_ID };
    }
    statusEmoji = normalizeStatusEmojiInput(statusEmojiRaw) ?? null;
  }

  return {
    ok: true,
    record: {
      active: parseActiveValue(values.active_block?.active_checkbox),
      defaultNotifyChannels: parseSelectedChannels(values.channels_block?.default_channels_select),
      defaultNotifyUsers: parseSelectedUsers(values.users_block?.default_users_select),
      defaultRegistrationNotify: parseRegistrationNotifyMode(
        parseStaticSelectValue(values.registration_notify_block?.default_registration_notify_select)
      ),
      ...(statusDefaultText !== undefined ? { statusDefaultText } : {}),
      ...(statusEmoji !== undefined ? { statusEmoji } : {})
    }
  };
};

export const openMemberMasterSettingsModal = async (
  config: AppConfig,
  params: { triggerId: string; userId: string }
): Promise<void> => {
  const [master, statusPrefsEnabled] = await Promise.all([
    resolveMasterContext(config, params.userId),
    checkMemberMasterStatusPrefsSchema(config).then((result) => result === "ok")
  ]);
  await slackApi.openModal(
    config,
    params.triggerId,
    buildMemberMasterModalView({
      userId: params.userId,
      config,
      active: master.active,
      defaultNotifyChannels: master.defaultNotifyChannels,
      defaultNotifyUsers: master.defaultNotifyUsers,
      defaultRegistrationNotify: master.defaultRegistrationNotify,
      statusPrefsEnabled,
      statusDefaultText: master.statusDefaultText,
      statusEmoji: master.statusEmoji
    })
  );
};
