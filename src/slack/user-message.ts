import type { AppConfig } from "../config";
import { slackApi } from "./api";

export const isImChannelId = (channelId: string): boolean => channelId.startsWith("D");

export const postUserFacingMessage = async (
  config: AppConfig,
  params: {
    channelId: string;
    userId: string;
    text: string;
    blocks?: Array<Record<string, unknown>>;
  }
): Promise<void> => {
  const { channelId, userId, text, blocks } = params;
  if (isImChannelId(channelId)) {
    await slackApi.postChannelMessage(config, channelId, text, blocks);
    return;
  }
  await slackApi.postEphemeral(config, channelId, userId, text, blocks);
};
