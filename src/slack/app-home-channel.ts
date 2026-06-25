import type { AppConfig } from "../config";
import { slackApi } from "./api";

export const resolveAppHomeDmChannelId = async (
  config: AppConfig,
  userId: string,
  channelId?: string
): Promise<string> => {
  if (channelId) return channelId;
  return slackApi.openDirectMessage(config, userId);
};
