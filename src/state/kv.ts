import type { AppConfig } from "../config";

const LIST_ID_KEY = "absence:config:list_id";

const postTsKey = (jstDate: string, channelId: string): string =>
  `absence:post:${jstDate}:${channelId}`;

export const readPersistedListId = async (config: AppConfig): Promise<string | undefined> => {
  const value = await config.stateKv.get(LIST_ID_KEY);
  return value && value.length > 0 ? value : undefined;
};

export const writePersistedListId = async (config: AppConfig, listId: string): Promise<void> => {
  if (!listId) return;
  await config.stateKv.put(LIST_ID_KEY, listId);
};

export const readPostedMessageTs = async (
  config: AppConfig,
  jstDate: string,
  channelId: string
): Promise<string | undefined> => {
  const value = await config.stateKv.get(postTsKey(jstDate, channelId));
  return value && value.length > 0 ? value : undefined;
};

export const writePostedMessageTs = async (
  config: AppConfig,
  jstDate: string,
  channelId: string,
  ts: string
): Promise<void> => {
  if (!ts) return;
  await config.stateKv.put(postTsKey(jstDate, channelId), ts);
};
