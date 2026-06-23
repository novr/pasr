import { SlackApiError } from "../slack/client";

export class TransientAdminTaskError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "TransientAdminTaskError";
  }
}

const TRANSIENT_SLACK_ERRORS = new Set([
  "rate_limited",
  "timeout",
  "request_timeout",
  "service_unavailable",
  "fatal_error",
  "internal_error"
]);

export const isTransientError = (error: unknown): boolean => {
  if (error instanceof TransientAdminTaskError) return true;
  if (error instanceof TypeError) return true;
  if (error instanceof SlackApiError) {
    return TRANSIENT_SLACK_ERRORS.has(error.slackError);
  }
  if (error instanceof Error && /Slack API HTTP error \([^)]+\): (429|5\d\d)/.test(error.message)) {
    return true;
  }
  return false;
};
