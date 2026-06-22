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
  responseUrl: string;
};

const parseValue = (params: URLSearchParams, key: string): string => params.get(key)?.trim() ?? "";

export const parseSlackCommandPayload = (rawBody: string): SlackCommandPayload | undefined => {
  const params = new URLSearchParams(rawBody);
  const command = parseValue(params, "command");
  const text = parseValue(params, "text");
  const userId = parseValue(params, "user_id");
  const teamId = parseValue(params, "team_id");
  const triggerId = parseValue(params, "trigger_id");
  const responseUrl = parseValue(params, "response_url");
  if (!command || !userId || !teamId || !triggerId) return undefined;
  return { command, text, userId, teamId, triggerId, responseUrl };
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

  if (payload.responseUrl) {
    const status = result.errors > 0 ? "一部エラーあり" : "完了";
    const resultText = [
      `run ${status}: processed=${result.processed} sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`,
      `run_id: ${runId}`
    ].join("\n");
    try {
      const response = await fetch(payload.responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify({ response_type: "ephemeral", text: resultText })
      });
      if (!response.ok) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "slash_command_response_failed",
            trigger_id: payload.triggerId,
            user_id: payload.userId,
            team_id: payload.teamId,
            status: response.status
          })
        );
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "slash_command_response_failed",
          trigger_id: payload.triggerId,
          user_id: payload.userId,
          team_id: payload.teamId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
};
