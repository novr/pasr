import type { AppConfig } from "../config";

const LIST_ID_KEY = "absence:config:list_id";
const MEMBER_MASTER_LIST_ID_KEY = "member_master:config:list_id";
const ABSENCE_SCHEMA_VERSION_KEY = "absence:config:schema_version";
const MEMBER_MASTER_SCHEMA_VERSION_KEY = "member_master:config:schema_version";
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

export const readPersistedAbsenceSchemaVersion = async (config: AppConfig): Promise<number | undefined> => {
  const value = await config.stateKv.get(ABSENCE_SCHEMA_VERSION_KEY);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const writePersistedAbsenceSchemaVersion = async (config: AppConfig, version: number): Promise<void> => {
  await config.stateKv.put(ABSENCE_SCHEMA_VERSION_KEY, String(version));
};

export const readPersistedMemberMasterListId = async (config: AppConfig): Promise<string | undefined> => {
  const value = await config.stateKv.get(MEMBER_MASTER_LIST_ID_KEY);
  return value && value.length > 0 ? value : undefined;
};

export const writePersistedMemberMasterListId = async (config: AppConfig, listId: string): Promise<void> => {
  if (!listId) return;
  await config.stateKv.put(MEMBER_MASTER_LIST_ID_KEY, listId);
};

export const readPersistedMemberMasterSchemaVersion = async (config: AppConfig): Promise<number | undefined> => {
  const value = await config.stateKv.get(MEMBER_MASTER_SCHEMA_VERSION_KEY);
  if (!value) return undefined;
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : undefined;
};

export const writePersistedMemberMasterSchemaVersion = async (
  config: AppConfig,
  version: number
): Promise<void> => {
  await config.stateKv.put(MEMBER_MASTER_SCHEMA_VERSION_KEY, String(version));
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

const PRUNE_PENDING_KEY = "prune:pending";

export type PruneCandidate = {
  listId: string;
  listName: string;
};

const readPrunePendingRecords = async (config: AppConfig): Promise<PruneCandidate[]> => {
  const value = await config.stateKv.get(PRUNE_PENDING_KEY);
  if (!value) return [];
  try {
    const parsed = JSON.parse(value) as PruneCandidate[];
    if (!Array.isArray(parsed)) return [];
    return parsed.filter(
      (entry): entry is PruneCandidate =>
        !!entry &&
        typeof entry.listId === "string" &&
        entry.listId.length > 0 &&
        typeof entry.listName === "string" &&
        entry.listName.length > 0
    );
  } catch {
    return [];
  }
};

export const readPrunePending = async (config: AppConfig): Promise<PruneCandidate[]> =>
  readPrunePendingRecords(config);

export const addPrunePending = async (
  config: AppConfig,
  candidates: PruneCandidate[]
): Promise<void> => {
  if (candidates.length === 0) return;
  const records = await readPrunePendingRecords(config);
  const byId = new Map(records.map((entry) => [entry.listId, entry]));
  for (const candidate of candidates) {
    byId.set(candidate.listId, candidate);
  }
  await config.stateKv.put(PRUNE_PENDING_KEY, JSON.stringify([...byId.values()]));
};

export const removePrunePending = async (config: AppConfig, listId: string): Promise<void> => {
  const records = await readPrunePendingRecords(config);
  const next = records.filter((entry) => entry.listId !== listId);
  if (next.length === records.length) return;
  if (next.length === 0) {
    await config.stateKv.delete(PRUNE_PENDING_KEY);
    return;
  }
  await config.stateKv.put(PRUNE_PENDING_KEY, JSON.stringify(next));
};
