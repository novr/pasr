import type { AppConfig } from "../config";
import { isStatusOAuthEnabled } from "../config";
import { checkSlackUserOAuthSchema } from "../db/schema-check";
import { deleteSlackUserOAuthByUserId, hasSlackUserOAuth } from "../db/slack-user-oauth-repository";
import { rememberWorkerOriginForUser } from "../state/worker-origin";
import { resolveAppHomeDmChannelId } from "./app-home-channel";
import { refreshAppHomeAfterMutation } from "./app-home-publish";
import { slackApi } from "./api";
import { issueOAuthStartUrlForUser } from "./oauth";
import { postUserFacingMessage } from "./user-message";

export const STATUS_OAUTH_DISCONNECT_ACTION_ID = "pasr_status_oauth_disconnect";
export const STATUS_OAUTH_DISCONNECT_CONFIRM_ACTION_ID = "pasr_status_oauth_disconnect_confirm";

export const STATUS_OAUTH_NOTICE_TEXT =
  "不在の *詳細* がそのまま Slack Status としてワークスペース全体に表示されます。連携は任意です。";

export const buildStatusOAuthEphemeralText = (params: {
  linked: boolean;
  startUrl?: string | null;
}): string => {
  if (!params.linked && params.startUrl) {
    return `${STATUS_OAUTH_NOTICE_TEXT}\n<${params.startUrl}|Slack Status を連携>`;
  }
  if (params.linked) {
    return "Slack Status 連携済みです。「連携解除」ボタンでトークンを削除できます。";
  }
  return "Slack Status 連携は現在利用できません（管理者に OAuth 設定を確認してください）。";
};

export const postStatusOAuthEphemeral = async (
  config: AppConfig,
  params: { channelId: string; userId: string; publicBaseUrl: string }
): Promise<void> => {
  if (!params.channelId) return;
  if (params.publicBaseUrl) {
    await rememberWorkerOriginForUser(config.stateKv, params.userId, params.publicBaseUrl);
  }
  const enabled = isStatusOAuthEnabled(config);
  const schemaOk = enabled ? (await checkSlackUserOAuthSchema(config)) === "ok" : false;
  const linked = schemaOk ? await hasSlackUserOAuth(config, params.userId) : false;
  const startUrl =
    enabled && schemaOk && !linked
      ? await issueOAuthStartUrlForUser(config, params.userId, params.publicBaseUrl)
      : null;
  const text = buildStatusOAuthEphemeralText({ linked, startUrl });
  const blocks: Array<Record<string, unknown>> = [
    { type: "section", text: { type: "mrkdwn", text } }
  ];
  if (linked) {
    blocks.push({
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: STATUS_OAUTH_DISCONNECT_ACTION_ID,
          text: { type: "plain_text", text: "連携解除" }
        }
      ]
    });
  }
  await slackApi.postEphemeral(config, params.channelId, params.userId, text, blocks);
};

export const handleStatusOAuthDisconnectAction = async (
  config: AppConfig,
  params: { actionId: string; userId: string; channelId?: string; responseUrl?: string }
): Promise<{ handled: boolean; followUp?: () => Promise<void> }> => {
  if (
    params.actionId !== STATUS_OAUTH_DISCONNECT_ACTION_ID &&
    params.actionId !== STATUS_OAUTH_DISCONNECT_CONFIRM_ACTION_ID
  ) {
    return { handled: false };
  }
  if (!params.userId) return { handled: true };

  const confirmText = "表示中の Status は手動で消すか、期限まで残ります。トークンのみ削除します。";
  const confirmBlocks: Array<Record<string, unknown>> = [
    {
      type: "actions",
      elements: [
        {
          type: "button",
          action_id: STATUS_OAUTH_DISCONNECT_CONFIRM_ACTION_ID,
          text: { type: "plain_text", text: "削除する" },
          style: "danger"
        }
      ]
    }
  ];

  if (params.actionId === STATUS_OAUTH_DISCONNECT_ACTION_ID) {
    const channelId = await resolveAppHomeDmChannelId(config, params.userId, params.channelId);
    await postUserFacingMessage(config, {
      channelId,
      userId: params.userId,
      text: confirmText,
      blocks: confirmBlocks
    });
    return { handled: true };
  }

  return {
    handled: true,
    followUp: async () => {
      try {
        await deleteSlackUserOAuthByUserId(config, params.userId);
        console.log(
          JSON.stringify({
            level: "info",
            event: "oauth_disconnected",
            user_id: params.userId
          })
        );
        const channelId = await resolveAppHomeDmChannelId(config, params.userId, params.channelId);
        await postUserFacingMessage(config, {
          channelId,
          userId: params.userId,
          text: "Slack Status 連携を解除しました。"
        });
        await refreshAppHomeAfterMutation(config, params.userId);
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "oauth_disconnect_failed",
            user_id: params.userId,
            message: error instanceof Error ? error.message : String(error)
          })
        );
      }
    }
  };
};

export const buildAppHomeStatusOAuthBlock = (params: {
  linked: boolean;
  startUrl?: string | null;
}): Record<string, unknown> => {
  const text = buildStatusOAuthEphemeralText(params);
  const block: Record<string, unknown> = {
    type: "section",
    block_id: "pasr_home_status_oauth",
    text: { type: "mrkdwn", text: `*Slack Status 連携*\n${text}` }
  };
  if (params.linked) {
    return {
      ...block,
      accessory: {
        type: "button",
        action_id: STATUS_OAUTH_DISCONNECT_ACTION_ID,
        text: { type: "plain_text", text: "連携解除" }
      }
    };
  }
  return block;
};
