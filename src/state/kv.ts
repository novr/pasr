import type { AppConfig } from "../config";

const LIST_ID_KEY = "absence:config:list_id";
const MEMBER_MASTER_LIST_ID_KEY = "member_master:config:list_id";
const LAST_RUN_SUMMARY_KEY = "absence:run:last_summary";

const postTsKey = (jstDate: string, channelId: string): string =>
  `absence:post:${jstDate}:${channelId}`;

const directMessageTsKey = (jstDate: string, userId: string): string =>
  `absence:dm:${jstDate}:${userId}`;

export const readPersistedListId = async (config: AppConfig): Promise<string | undefined> => {
  const value = await config.stateKv.get(LIST_ID_KEY);
  return value && value.length > 0 ? value : undefined;
};

export const writePersistedListId = async (config: AppConfig, listId: string): Promise<void> => {
  if (!listId) return;
  await config.stateKv.put(LIST_ID_KEY, listId);
};

export const readPersistedMemberMasterListId = async (config: AppConfig): Promise<string | undefined> => {
  const value = await config.stateKv.get(MEMBER_MASTER_LIST_ID_KEY);
  return value && value.length > 0 ? value : undefined;
};

export const writePersistedMemberMasterListId = async (config: AppConfig, listId: string): Promise<void> => {
  if (!listId) return;
  await config.stateKv.put(MEMBER_MASTER_LIST_ID_KEY, listId);
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

export const readPostedDirectMessageTs = async (
  config: AppConfig,
  jstDate: string,
  userId: string
): Promise<string | undefined> => {
  const value = await config.stateKv.get(directMessageTsKey(jstDate, userId));
  return value && value.length > 0 ? value : undefined;
};

export const writePostedDirectMessageTs = async (
  config: AppConfig,
  jstDate: string,
  userId: string,
  ts: string
): Promise<void> => {
  if (!ts) return;
  await config.stateKv.put(directMessageTsKey(jstDate, userId), ts);
};

export type LastRunSummary = {
  runId: string;
  trigger: "manual" | "scheduled";
  listId: string;
  processed: number;
  sent: number;
  skipped: number;
  errors: number;
  executedAt: string;
};

export const readLastRunSummary = async (config: AppConfig): Promise<LastRunSummary | undefined> => {
  const value = await config.stateKv.get(LAST_RUN_SUMMARY_KEY);
  if (!value) return undefined;
  try {
    return JSON.parse(value) as LastRunSummary;
  } catch {
    return undefined;
  }
};

export const writeLastRunSummary = async (config: AppConfig, summary: LastRunSummary): Promise<void> => {
  await config.stateKv.put(LAST_RUN_SUMMARY_KEY, JSON.stringify(summary));
};
