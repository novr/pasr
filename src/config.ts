export type Env = {
  SLACK_BOT_TOKEN: string;
  SLACK_SIGNING_SECRET: string;
  SLACK_ABSENCE_LIST_ID: string;
  TZ: string;
  SLACK_LIST_ACCESS_USER_IDS?: string;
};

export type AppConfig = {
  slackBotToken: string;
  slackSigningSecret: string;
  absenceListId: string;
  timezone: string;
  listAccessUserIds: string[];
};

export const getConfig = (env: Env): AppConfig => {
  if (!env.SLACK_BOT_TOKEN) {
    throw new Error("Missing SLACK_BOT_TOKEN");
  }
  if (!env.SLACK_SIGNING_SECRET) {
    throw new Error("Missing SLACK_SIGNING_SECRET");
  }

  return {
    slackBotToken: env.SLACK_BOT_TOKEN,
    slackSigningSecret: env.SLACK_SIGNING_SECRET,
    absenceListId: env.SLACK_ABSENCE_LIST_ID ?? "",
    timezone: env.TZ || "Asia/Tokyo",
    listAccessUserIds: (env.SLACK_LIST_ACCESS_USER_IDS ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter((value) => value.length > 0)
  };
};
