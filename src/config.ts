
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
  slackClientId: string;
  slackClientSecret: string;
  slackOauthEncryptionKey: string;
  publicBaseUrl: string;
  statusDefaultText: string;
  statusEmoji: string;
  timezone: string;
  adminUserIds: string[];
  pasrUsersUsergroupId: string;
  notifyEmptyDefault: boolean;
  opsChannelId: string;
  noticeChannels: string[];
};

export const isStatusOAuthEnabled = (config: AppConfig): boolean =>
  config.slackClientId.length > 0 &&
  config.slackClientSecret.length > 0 &&
  config.slackOauthEncryptionKey.length > 0;

export const resolvePublicBaseUrl = (request: Request, config: AppConfig): string => {
  const override = config.publicBaseUrl.trim().replace(/\/$/, "");
  if (override.length > 0) return override;
  return new URL(request.url).origin;
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
    debugEndpointsEnabled: parseBooleanEnv(env.DEBUG_ENDPOINTS_ENABLED, false),
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    slackClientId: (env.SLACK_CLIENT_ID ?? "").trim(),
    slackClientSecret: env.SLACK_CLIENT_SECRET ?? "",
    slackOauthEncryptionKey: env.SLACK_OAUTH_ENCRYPTION_KEY ?? "",
    publicBaseUrl: (env.PASR_PUBLIC_BASE_URL ?? "").trim(),
    statusDefaultText: (env.PASR_STATUS_DEFAULT_TEXT ?? "不在").trim() || "不在",
    statusEmoji: (env.PASR_STATUS_EMOJI ?? ":date:").trim() || ":date:",
    timezone: env.TZ || "Asia/Tokyo",
    adminUserIds: parseCommaSeparatedIds(env.SLACK_ADMIN_USER_IDS),
    pasrUsersUsergroupId: (env.SLACK_PASR_USERS_USERGROUP_ID ?? "").trim(),
    notifyEmptyDefault: parseBooleanEnv(env.PASR_NOTIFY_EMPTY_DEFAULT, true),
    opsChannelId: (env.SLACK_PASR_OPS_CHANNEL ?? "").trim(),
    noticeChannels: parseCommaSeparatedIds(env.SLACK_PASR_NOTICE_CH)
  };
};
