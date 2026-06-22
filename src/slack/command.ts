import type { AppConfig } from "../config";
import { runDailyNotify } from "../jobs/daily-notify";
import { readLastRunSummary } from "../state/kv";
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

const postEphemeralResponse = async (payload: SlackCommandPayload, text: string): Promise<void> => {
  if (!payload.responseUrl) return;
  try {
    const response = await fetch(payload.responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify({ response_type: "ephemeral", text })
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
};

const buildHelpText = (): string =>
  ["/pasr run - 通知処理を手動実行", "/pasr status - 直近実行の要約表示", "/pasr help - 使い方表示"].join("\n");

export const parseSlackCommandAction = (text: string): string =>
  text.split(/\s+/).filter((part) => part.length > 0)[0] ?? "run";

export const getSlashCommandImmediateText = async (
  config: AppConfig,
  payload: SlackCommandPayload
): Promise<string | undefined> => {
  const action = parseSlackCommandAction(payload.text);
  if (action === "help") return buildHelpText();
  if (action === "status") {
    const summary = await readLastRunSummary(config);
    return summary
      ? [
          `last run: processed=${summary.processed} sent=${summary.sent} skipped=${summary.skipped} errors=${summary.errors}`,
          `run_id: ${summary.runId}`,
          `executed_at: ${summary.executedAt}`
        ].join("\n")
      : "No run history yet.";
  }
  return undefined;
};

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

  const action = parseSlackCommandAction(payload.text);

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

  const status = result.errors > 0 ? "一部エラーあり" : "完了";
  const resultText = [
    `run ${status}: processed=${result.processed} sent=${result.sent} skipped=${result.skipped} errors=${result.errors}`,
    `run_id: ${runId}`
  ].join("\n");
  await postEphemeralResponse(payload, resultText);
};
