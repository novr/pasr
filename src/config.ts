import type { AdminTaskMessage } from "./queue/admin-task";

export type AppConfig = {
  stateKv: KVNamespace;
  db: D1Database;
  ai?: Ai;
  runEndpointToken: string;
  debugEndpointsEnabled: boolean;
  slackBotToken: string;
  slackSigningSecret: string;
  timezone: string;
  adminUserIds: string[];
};

export const getConfig = (env: Env): AppConfig => {
  if (!env.SLACK_BOT_TOKEN) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }
  if (!env.SLACK_SIGNING_SECRET) {
    throw new Error("Missing SLACK_SIGNING_SECRET");
  }
  if (!env.PASR_STATE) {
    throw new Error("Missing PASR_STATE binding");
  }
  if (!env.ADMIN_TASK_QUEUE) {
    throw new Error("Missing ADMIN_TASK_QUEUE binding");
  }
  if (!env.PASR_DB) {
    throw new Error("Missing PASR_DB binding");
  }

  return {
    stateKv: env.PASR_STATE,
    db: env.PASR_DB,
    ai: env.AI,
    runEndpointToken: env.RUN_ENDPOINT_TOKEN ?? "",
    debugEndpointsEnabled: env.DEBUG_ENDPOINTS_ENABLED === "true" || env.DEBUG_ENDPOINTS_ENABLED === "1",
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    timezone: env.TZ || "Asia/Tokyo",
    adminUserIds: (env.SLACK_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  };
};
