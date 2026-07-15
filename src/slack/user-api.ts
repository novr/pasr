import type { AppConfig } from "../config";
import { SlackApiError } from "./client";

type SlackOkResponse<T> = T & { ok: true };
type SlackErrorResponse = { ok: false; error: string };
type SlackResponse<T> = SlackOkResponse<T> | SlackErrorResponse;

const parseUserSlackResponse = async <T>(method: string, res: Response): Promise<T> => {
  const json = (await res.json()) as SlackResponse<T>;
  if (!res.ok) {
    throw new Error(`Slack API HTTP error (${method}): ${res.status}`);
  }
  if (!json.ok) {
    throw new SlackApiError(method, json.error);
  }
  return json;
};

export const slackUserApiPost = async <T>(
  userToken: string,
  method: string,
  payload: Record<string, unknown>
): Promise<T> => {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${userToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  return parseUserSlackResponse<T>(method, res);
};

export type UserProfileStatus = {
  status_text: string;
  status_emoji: string;
  status_expiration: number;
};

export const setUserProfileStatus = async (
  userToken: string,
  profile: UserProfileStatus
): Promise<void> => {
  await slackUserApiPost<Record<string, unknown>>(userToken, "users.profile.set", {
    profile: {
      status_text: profile.status_text,
      status_emoji: profile.status_emoji,
      status_expiration: profile.status_expiration
    }
  });
};

export { SlackApiError };
