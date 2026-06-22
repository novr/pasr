import type { AppConfig } from "../config";
import { runDailyNotify } from "../jobs/daily-notify";
import { SLACK_EVENT_DEDUPE_TTL_SEC, isDuplicateSlackCommandTrigger } from "../state/event-dedupe";

export const COMMAND_ACK_ACCEPTED = "Accepted";
export const COMMAND_ACK_UNAUTHORIZED = "Received. Processing...";

export type SlackCommandPayload = {
  command: string;
  text: string;
  userId: string;
  teamId: string;
  triggerId: string;
};

const parseValue = (params: URLSearchParams, key: string): string => params.get(key)?.trim() ?? "";

export const parseSlackCommandPayload = (rawBody: string): SlackCommandPayload | undefined => {
  const params = new URLSearchParams(rawBody);
  const command = parseValue(params, "command");
  const text = parseValue(params, "text");
  const userId = parseValue(params, "user_id");
  const teamId = parseValue(params, "team_id");
  const triggerId = parseValue(params, "trigger_id");
  if (!command || !userId || !teamId || !triggerId) return undefined;
  return { command, text, userId, teamId, triggerId };
};

export const isSlackAdminUser = (config: AppConfig, userId: string): boolean =>
  config.adminUserIds.includes(userId);

export const runSlackCommandAsync = async (config: AppConfig, payload: SlackCommandPayload): Promise<void> => {
  const duplicate = await isDuplicateSlackCommandTrigger(config, payload.triggerId);
  if (duplicate) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "duplicate_command_dropped",
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId,
        dedupe_ttl_sec: SLACK_EVENT_DEDUPE_TTL_SEC
      })
    );
    return;
  }

  const action = payload.text.split(/\s+/).filter((part) => part.length > 0)[0] ?? "run";
  if (action !== "run") {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "unsupported_slash_command_action",
        command: payload.command,
        action,
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId
      })
    );
    return;
  }

  const runId = `cmd_${crypto.randomUUID()}`;
  const result = await runDailyNotify(config, { runId, trigger: "manual" });
  console.log(
    JSON.stringify({
      level: "info",
      event: "slash_command_run_done",
      command: payload.command,
      action,
      trigger_id: payload.triggerId,
      user_id: payload.userId,
      team_id: payload.teamId,
      run_id: runId,
      processed: result.processed,
      sent: result.sent,
      skipped: result.skipped,
      errors: result.errors
    })
  );
};
