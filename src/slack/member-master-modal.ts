import type { AppConfig } from "../config";
import {
  REGISTRATION_NOTIFY_SELECT_OPTIONS,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { resolveMasterContext } from "./member-master-context";
import { slackApi } from "./api";

export const MEMBER_MASTER_MODAL_CALLBACK_ID = "pasr_member_master_update";

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

const buildMemberMasterModalView = (params: {
  userId: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
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
    }
  ]
});

export const openMemberMasterSettingsModal = async (
  config: AppConfig,
  params: { triggerId: string; userId: string }
): Promise<void> => {
  const master = await resolveMasterContext(config, params.userId);
  await slackApi.openModal(
    config,
    params.triggerId,
    buildMemberMasterModalView({
      userId: params.userId,
      active: master.active,
      defaultNotifyChannels: master.defaultNotifyChannels,
      defaultNotifyUsers: master.defaultNotifyUsers,
      defaultRegistrationNotify: master.defaultRegistrationNotify
    })
  );
};
