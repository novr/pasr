import type { AppConfig } from "../config";

const postTsKey = (jstDate: string, channelId: string): string =>
  `absence:post:${jstDate}:${channelId}`;

const directMessageTsKey = (jstDate: string, userId: string): string =>
  `absence:dm:${jstDate}:${userId}`;

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
  processed: number;
  sent: number;
  sentChannels?: number;
  sentDms?: number;
  skipped: number;
  errors: number;
  deleted?: number;
  executedAt: string;
  dbStatus?: string;
};

export const readLastRunSummary = async (config: AppConfig): Promise<LastRunSummary | undefined> => {
  const value = await config.stateKv.get("absence:run:last_summary");
  if (!value) return undefined;
  try {
    return JSON.parse(value) as LastRunSummary;
  } catch {
    return undefined;
  }
};

export const writeLastRunSummary = async (config: AppConfig, summary: LastRunSummary): Promise<void> => {
  await config.stateKv.put("absence:run:last_summary", JSON.stringify(summary));
};
