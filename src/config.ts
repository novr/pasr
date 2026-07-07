
type DashboardEnv = Env & {
  PASR_NOTIFY_EMPTY_DEFAULT?: string;
  SLACK_PASR_OPS_CHANNEL?: string;
  SLACK_PASR_NOTICE_CH?: string;
};

const parseBooleanEnv = (value: string | undefined, defaultValue: boolean): boolean => {
  if (value === undefined || value.trim().length === 0) return defaultValue;
  const normalized = value.trim().toLowerCase();
  if (normalized === "true" || normalized === "1") return true;
  if (normalized === "false" || normalized === "0") return false;
  return defaultValue;
};

const parseCommaSeparatedIds = (value: string | undefined): string[] =>
  (value ?? "")
    .split(",")
    .map((entry) => entry.trim())
    .filter((entry) => entry.length > 0);

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
  pasrUsersUsergroupId: string;
  notifyEmptyDefault: boolean;
  opsChannelId: string;
  noticeChannels: string[];
};

export const getConfig = (env: Env): AppConfig => {
  const dashboardEnv = env as DashboardEnv;
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
    adminUserIds: parseCommaSeparatedIds(env.SLACK_ADMIN_USER_IDS),
    pasrUsersUsergroupId: (env.SLACK_PASR_USERS_USERGROUP_ID ?? "").trim(),
    notifyEmptyDefault: parseBooleanEnv(dashboardEnv.PASR_NOTIFY_EMPTY_DEFAULT, true),
    opsChannelId: (dashboardEnv.SLACK_PASR_OPS_CHANNEL ?? "").trim(),
    noticeChannels: parseCommaSeparatedIds(dashboardEnv.SLACK_PASR_NOTICE_CH)
  };
};
