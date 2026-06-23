import type { AppConfig } from "../config";

type SlackOkResponse<T> = T & { ok: true };
type SlackErrorResponse = { ok: false; error: string };
type SlackResponse<T> = SlackOkResponse<T> | SlackErrorResponse;

export class SlackApiError extends Error {
  readonly method: string;
  readonly slackError: string;

  constructor(method: string, slackError: string) {
    super(`Slack API error (${method}): ${slackError}`);
    this.method = method;
    this.slackError = slackError;
  }
}

export const isSkippableSlackLookupError = (error: unknown): boolean => {
  if (!(error instanceof SlackApiError)) return false;
  return ["unknown_method", "missing_scope", "not_visible", "access_denied", "method_deprecated"].includes(
    error.slackError
  );
};

const parseSlackResponse = async <T>(method: string, res: Response): Promise<T> => {
  const json = (await res.json()) as SlackResponse<T>;
  if (!res.ok) {
    throw new Error(`Slack API HTTP error (${method}): ${res.status}`);
  }
  if (!json.ok) {
    throw new SlackApiError(method, json.error);
  }
  return json;
};

export const slackApiPost = async <T>(
  config: AppConfig,
  method: string,
  payload: Record<string, unknown>
): Promise<T> => {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slackBotToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  return parseSlackResponse<T>(method, res);
};

export const slackApiGet = async <T>(
  config: AppConfig,
  method: string,
  params: Record<string, string | number>
): Promise<T> => {
  const url = new URL(`https://slack.com/api/${method}`);
  for (const [key, value] of Object.entries(params)) {
    url.searchParams.set(key, String(value));
  }
  const res = await fetch(url, {
    headers: {
      Authorization: `Bearer ${config.slackBotToken}`
    }
  });
  return parseSlackResponse<T>(method, res);
};
