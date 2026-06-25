import type { AppConfig } from "../config";
import { slackApiPost } from "./client";

type SlackViewOpenResponse = {
  view?: { id?: string };
};

type SlackConversationOpenResponse = {
  channel?: {
    id?: string;
  };
};

export const slackApi = {
  openModal: async (config: AppConfig, triggerId: string, view: Record<string, unknown>) =>
    slackApiPost<SlackViewOpenResponse>(config, "views.open", {
      trigger_id: triggerId,
      view
    }),

  publishHomeView: async (
    config: AppConfig,
    userId: string,
    blocks: Array<Record<string, unknown>>
  ) =>
    slackApiPost<Record<string, unknown>>(config, "views.publish", {
      user_id: userId,
      view: {
        type: "home",
        blocks
      }
    }),

  openDirectMessage: async (config: AppConfig, userId: string): Promise<string> => {
    const opened = await slackApiPost<SlackConversationOpenResponse>(config, "conversations.open", {
      users: userId
    });
    const channelId = opened.channel?.id;
    if (!channelId) {
      throw new Error("conversations.open response missing channel id");
    }
    return channelId;
  },

  postChannelMessage: async (
    config: AppConfig,
    channel: string,
    text: string,
    blocks?: Array<Record<string, unknown>>
  ) =>
    slackApiPost<{ ts?: string }>(config, "chat.postMessage", {
      channel,
      text,
      ...(blocks ? { blocks } : {})
    }),

  postEphemeral: async (
    config: AppConfig,
    channel: string,
    user: string,
    text: string,
    blocks?: Array<Record<string, unknown>>
  ) =>
    slackApiPost<Record<string, unknown>>(config, "chat.postEphemeral", {
      channel,
      user,
      text,
      ...(blocks ? { blocks } : {})
    }),

  updateChannelMessage: async (config: AppConfig, channel: string, ts: string, text: string) =>
    slackApiPost<{ ts?: string }>(config, "chat.update", {
      channel,
      ts,
      text
    })
};
