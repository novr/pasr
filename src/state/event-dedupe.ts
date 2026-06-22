import type { AppConfig } from "../config";

const dedupeKey = (eventId: string): string => `slack:event:dedupe:${eventId}`;
const commandDedupeKey = (triggerId: string): string => `slack:command:dedupe:${triggerId}`;
const DEDUPE_TTL_SEC = 60 * 5;

export const SLACK_EVENT_DEDUPE_TTL_SEC = DEDUPE_TTL_SEC;

export const isDuplicateSlackEvent = async (config: AppConfig, eventId: string): Promise<boolean> => {
  if (!eventId) return false;
  const key = dedupeKey(eventId);
  const existing = await config.stateKv.get(key);
  if (existing) return true;
  await config.stateKv.put(key, "1", { expirationTtl: DEDUPE_TTL_SEC });
  return false;
};

export const isDuplicateSlackCommandTrigger = async (
  config: AppConfig,
  triggerId: string
): Promise<boolean> => {
  if (!triggerId) return false;
  const key = commandDedupeKey(triggerId);
  const existing = await config.stateKv.get(key);
  if (existing) return true;
  await config.stateKv.put(key, "1", { expirationTtl: DEDUPE_TTL_SEC });
  return false;
};
