import type { AdminTaskMessage } from "./queue/admin-task";

export type Env = {
  PASR_STATE: KVNamespace;
  ADMIN_TASK_QUEUE: Queue<AdminTaskMessage>;
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  RUN_ENDPOINT_TOKEN?: string;
  TZ: string;
  SLACK_ADMIN_USER_IDS?: string;
};

export type AppConfig = {
  stateKv: KVNamespace;
  runEndpointToken: string;
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

  return {
    stateKv: env.PASR_STATE,
    runEndpointToken: env.RUN_ENDPOINT_TOKEN ?? "",
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    timezone: env.TZ || "Asia/Tokyo",
    adminUserIds: (env.SLACK_ADMIN_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  };
};
