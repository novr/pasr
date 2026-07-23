import type { AppConfig } from "../config";
import {
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { isTransientError } from "../errors/transient";
import { runDailyNotify } from "../jobs/daily-notify";
import { formatRunSentForAdmin } from "../domain/run-sent-metrics";
import { isValidJstDateString, getJstDateParts } from "../domain/jst-date";
import { checkDbSchema, checkChannelNotifySettingsSchema, checkSlackUserOAuthSchema } from "../db/schema-check";
import {
  openAbsenceEditModal,
  formatResolveOwnAbsenceForEditError,
  resolveOwnAbsenceForEdit,
  findOwnAbsenceRecordsByStartDate
} from "./absence-edit";
import { showOwnAbsenceList } from "./absence-list";
import { openAbsenceRegisterModal } from "./absence-register";
import { handleChannelConfigCommand } from "./channel-config";
import { handleUsersCommand } from "./admin-users";
import { handleAbsencesCommand } from "./admin-absences";
import type { AdminEphemeralReply } from "./admin-format";
import { deliverAdminEphemeralReply } from "./admin-format";
import {
  adminCommandParseAction,
  type AdminCommandParse,
  type DeferredAdminCommandParse,
  isDeferredAdminCommandParse,
  parseAdminCommandText
} from "./admin-command-parse";
import { openMemberMasterSettingsModal } from "./member-master-modal";
import { readLastRunSummary } from "../state/kv";
import { postStatusOAuthEphemeral } from "./status-oauth-ui";
export {
  handleSlackInteraction,
  type SlackInteractionPayload,
  type SlackInteractionResult
} from "./interaction-router";

const handleDeferredAdminCommand = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  parse: DeferredAdminCommandParse
): Promise<string | AdminEphemeralReply> => {
  switch (parse.kind) {
    case "channel-config":
      return handleChannelConfigCommand(config, payload, parse.sub);
    case "users":
      return handleUsersCommand(config, payload, parse.page);
    case "absences":
      return handleAbsencesCommand(config, payload, parse.page);
    default: {
      const _never: never = parse;
      return _never;
    }
  }
};

const deliverDeferredAdminResult = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  result: string | AdminEphemeralReply
): Promise<void> => {
  await deliverAdminEphemeralReply(
    config,
    {
      userId: payload.userId,
      responseUrl: payload.responseUrl,
      channelId: payload.channelId
    },
    result
  );
};

export const COMMAND_ACK_UNAUTHORIZED = "Received. Processing...";
export const COMMAND_ACK_DUPLICATE =
  "同じコマンドは処理中です。完了後に結果を表示してください。";
export const COMMAND_ACK_ENQUEUE_FAILED =
  "キューへの投入に失敗しました。しばらく待って再実行してください。";

export const buildQueuedSelfAck = (): string =>
  "一覧を表示しています。完了後に結果を表示します。";

export const buildQueuedAdminAck = (action: string): string => {
  switch (action) {
    case "run":
      return "通知処理を実行中です。完了後に結果を表示します。";
    default:
      return "処理を実行中です。完了後に結果を表示します。";
  }
};

export type SlackCommandPayload = {
  command: string;
  text: string;
  userId: string;
  teamId: string;
  channelId: string;
  triggerId: string;
  responseUrl: string;
};

export type SlashCommandDispatch =
  | { mode: "text"; text: string }
  | { mode: "queue"; listPrefix?: string }
  | { mode: "deferred"; ackText: string; run: () => Promise<void> };

export type SelfCommandParse =
  | { kind: "help" }
  | { kind: "settings" }
  | { kind: "list" }
  | { kind: "update_list" }
  | { kind: "update_date"; startDate: string }
  | { kind: "update_item"; itemId: string }
  | { kind: "update_invalid_date" }
  | { kind: "register" }
  | { kind: "unknown"; action: string };

export const parseSelfCommandText = (text: string): SelfCommandParse => {
  const parts = text.split(/\s+/).filter((part) => part.length > 0);
  const action = parts[0] ?? "help";
  if (action === "help") return { kind: "help" };
  if (action === "settings") return { kind: "settings" };
  if (action === "list") return { kind: "list" };
  if (action === "register") return { kind: "register" };
  if (action === "update") {
    if (parts.length === 1) return { kind: "update_list" };
    const token = parts[1];
    if (isValidJstDateString(token)) return { kind: "update_date", startDate: token };
    if (/^\d{4}-\d{2}-\d{2}$/.test(token)) return { kind: "update_invalid_date" };
    if (token.length > 0) return { kind: "update_item", itemId: token };
  }
  return { kind: "unknown", action };
};

const selfListPrefixForParse = (parse: SelfCommandParse): string | undefined => {
  switch (parse.kind) {
    case "update_invalid_date":
      return "日付の形式が正しくありません（YYYY-MM-DD）。";
    default:
      return undefined;
  }
};

const isSelfAction = (action: string): action is (typeof SELF_ACTIONS)[number] =>
  SELF_ACTIONS.includes(action as (typeof SELF_ACTIONS)[number]);

const parseValue = (params: URLSearchParams, key: string): string => params.get(key)?.trim() ?? "";

export const parseSlackCommandPayload = (rawBody: string): SlackCommandPayload | undefined => {
  const params = new URLSearchParams(rawBody);
  const command = parseValue(params, "command");
  const text = parseValue(params, "text");
  const userId = parseValue(params, "user_id");
  const teamId = parseValue(params, "team_id");
  const channelId = parseValue(params, "channel_id");
  const triggerId = parseValue(params, "trigger_id");
  const responseUrl = parseValue(params, "response_url");
  if (!command || !userId || !teamId || !triggerId) return undefined;
  return { command, text, userId, teamId, channelId, triggerId, responseUrl };
};

export const isSlackAdminUser = (config: AppConfig, userId: string): boolean =>
  config.adminUserIds.includes(userId);

export const notifySlashCommandEphemeral = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  text: string,
  blocks?: Array<Record<string, unknown>>
): Promise<void> => {
  const reply: AdminEphemeralReply | string = blocks ? { text, blocks } : text;
  await deliverAdminEphemeralReply(
    config,
    {
      userId: payload.userId,
      responseUrl: payload.responseUrl,
      channelId: payload.channelId
    },
    reply
  );
};

const buildHelpText = (): string =>
  [
    "/pasr help - ユーザ向けコマンドの使い方表示",
    "/pasr settings - 自分の通知・Status 設定を表示・編集",
    "/pasr list - 自分の不在予定一覧（編集・削除）",
    "/pasr update - /pasr list と同じ",
    "/pasr update YYYY-MM-DD - 開始日指定で不在予定を編集",
    "/pasr register - 自分の不在予定を登録"
  ].join("\n");

const buildAdminHelpText = (): string =>
  [
    "/pasr-admin help - 管理者向けコマンドの使い方表示",
    "/pasr-admin run - 通知処理を手動実行",
    "/pasr-admin status - 直近実行の要約表示",
    "/pasr-admin users - 登録ユーザー一覧（ページ番号・ボタンでページ送り）",
    "/pasr-admin absences - 本日の不在一覧（today / ページ番号省略可）",
    "/pasr-admin channel-config empty on|off|default - この CH の 0件時通知を上書き",
    "/pasr-admin channel-config list - CH 別 0件時通知の上書き一覧"
  ].join("\n");

type CommandKind = "self" | "admin" | "unsupported";

const SELF_ACTIONS = ["help", "list", "settings", "update", "register"] as const;

export const getCommandKind = (command: string): CommandKind => {
  if (command === "/pasr") return "self";
  if (command === "/pasr-admin") return "admin";
  return "unsupported";
};

export const parseSlackCommandAction = (text: string): string =>
  text.split(/\s+/).filter((part) => part.length > 0)[0] ?? "help";

export const adminSlashCommandLogAction = (text: string): string =>
  adminCommandParseAction(parseAdminCommandText(text));

export const slashCommandLogFields = (payload: SlackCommandPayload): Record<string, string | boolean> => ({
  command: payload.command,
  action:
    payload.command === "/pasr-admin"
      ? adminSlashCommandLogAction(payload.text)
      : parseSlackCommandAction(payload.text),
  text: payload.text,
  user_id: payload.userId,
  team_id: payload.teamId,
  trigger_id: payload.triggerId,
  has_response_url: payload.responseUrl.length > 0
});

const handleSelfImmediateText = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  parse: SelfCommandParse,
  options?: { publicBaseUrl?: string }
): Promise<SlashCommandDispatch> => {
  switch (parse.kind) {
    case "help":
      return { mode: "text", text: buildHelpText() };
    case "unknown":
      return { mode: "text", text: `unsupported action: ${parse.action}\n${buildHelpText()}` };
    case "settings":
      return {
        mode: "deferred",
        ackText: "設定フォームを開きます…",
        run: async () => {
          await openMemberMasterSettingsModal(config, {
            triggerId: payload.triggerId,
            userId: payload.userId
          });
          if (payload.channelId && options?.publicBaseUrl) {
            await postStatusOAuthEphemeral(config, {
              channelId: payload.channelId,
              userId: payload.userId,
              publicBaseUrl: options.publicBaseUrl
            });
          }
        }
      };
    case "register":
      return {
        mode: "deferred",
        ackText: "不在予定登録フォームを開きます…",
        run: async () => {
          await openAbsenceRegisterModal(config, {
            triggerId: payload.triggerId,
            userId: payload.userId,
            channelId: payload.channelId,
            teamId: payload.teamId,
            triggerSource: "slash"
          });
        }
      };
    case "list":
    case "update_list":
    case "update_invalid_date":
      return { mode: "queue", listPrefix: selfListPrefixForParse(parse) };
    case "update_date":
      return {
        mode: "deferred",
        ackText: "編集フォームを準備しています…",
        run: async () => {
          const { day: todayJst } = getJstDateParts();
          const matches = await findOwnAbsenceRecordsByStartDate(
            config,
            payload.userId,
            parse.startDate,
            todayJst
          );
          if (matches.length === 1) {
            await openAbsenceEditModal(config, {
              triggerId: payload.triggerId,
              userId: payload.userId,
              record: matches[0]
            });
            return;
          }
          const listPrefix =
            matches.length === 0
              ? "指定された開始日の不在予定が見つかりませんでした。"
              : "同じ開始日の不在予定が複数あります。一覧から編集してください。";
          await showOwnAbsenceList(config, payload, { prefixMessage: listPrefix, includeEdit: true });
        }
      };
    case "update_item": {
      const itemId = parse.itemId;
      return {
        mode: "deferred",
        ackText: "編集フォームを準備しています…",
        run: async () => {
          const resolved = await resolveOwnAbsenceForEdit(config, payload.userId, itemId);
          if (!resolved.ok) {
            await notifySlashCommandEphemeral(
              config,
              payload,
              formatResolveOwnAbsenceForEditError(resolved.reason)
            );
            return;
          }
          await openAbsenceEditModal(config, {
            triggerId: payload.triggerId,
            userId: payload.userId,
            record: resolved.record
          });
        }
      };
    }
    default: {
      const _never: never = parse;
      return _never;
    }
  }
};

const buildAdminStatusText = async (config: AppConfig): Promise<string> => {
  const summary = await readLastRunSummary(config);
  const dbSchema = await checkDbSchema(config);
  const channelNotifySchema = await checkChannelNotifySettingsSchema(config);
  const oauthSchema = await checkSlackUserOAuthSchema(config);
  const dbLine = `db: ${dbSchema === "ok" ? "ok" : "schema_missing"}`;
  const channelNotifyLine = `channel_notify_settings: ${channelNotifySchema === "ok" ? "ok" : "schema_missing"}`;
  const oauthLine = `slack_user_oauth: ${oauthSchema === "ok" ? "ok" : "schema_missing"}`;
  return summary
    ? [
        `last run: processed=${summary.processed} ${formatRunSentForAdmin(summary)} skipped=${summary.skipped} deleted=${summary.deleted ?? 0} errors=${summary.errors}`,
        `run_id: ${summary.runId}`,
        dbLine,
        channelNotifyLine,
        oauthLine,
        `executed_at: ${summary.executedAt}`
      ].join("\n")
    : [`No run history yet.`, dbLine, channelNotifyLine, oauthLine].join("\n");
};

const handleAdminSlashCommandDispatch = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  parse: AdminCommandParse
): Promise<SlashCommandDispatch> => {
  if (isDeferredAdminCommandParse(parse)) {
    return {
      mode: "deferred",
      ackText: "処理しています…",
      run: async () => {
        const result = await handleDeferredAdminCommand(config, payload, parse);
        await deliverDeferredAdminResult(config, payload, result);
      }
    };
  }

  switch (parse.kind) {
    case "help":
      return { mode: "text", text: buildAdminHelpText() };
    case "status":
      return { mode: "text", text: await buildAdminStatusText(config) };
    case "run":
      return { mode: "queue" };
    case "invalid":
      return { mode: "text", text: parse.message };
    case "unknown":
      return { mode: "text", text: `unsupported action: ${parse.action}\n${buildAdminHelpText()}` };
    default: {
      const _never: never = parse;
      return _never;
    }
  }
};

export const resolveSlashCommandDispatch = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  options?: { publicBaseUrl?: string }
): Promise<SlashCommandDispatch> => {
  const commandKind = getCommandKind(payload.command);
  if (commandKind === "admin") {
    return handleAdminSlashCommandDispatch(
      config,
      payload,
      parseAdminCommandText(payload.text)
    );
  }
  if (commandKind === "self") {
    const parse = parseSelfCommandText(payload.text);
    if (!isSelfAction(parseSlackCommandAction(payload.text)) && parse.kind === "unknown") {
      return { mode: "text", text: `unsupported action: ${parse.action}\n${buildHelpText()}` };
    }
    try {
      return await handleSelfImmediateText(config, payload, parse, options);
    } catch (error) {
      return {
        mode: "text",
        text: `self record の準備に失敗しました: ${error instanceof Error ? error.message : String(error)}`
      };
    }
  }
  return { mode: "text", text: "unsupported slash command." };
};

export const getSlashCommandImmediateText = async (
  config: AppConfig,
  payload: SlackCommandPayload
): Promise<string | undefined> => {
  const dispatch = await resolveSlashCommandDispatch(config, payload);
  if (dispatch.mode === "text") return dispatch.text;
  return undefined;
};

export const runSlackCommandAsync = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  options?: { listPrefix?: string }
): Promise<void> => {
  const commandKind = getCommandKind(payload.command);
  if (commandKind === "self") {
    await showOwnAbsenceList(config, payload, {
      prefixMessage: options?.listPrefix,
      includeEdit: true
    });
    return;
  }

  const parse = parseAdminCommandText(payload.text);
  if (commandKind !== "admin") {
    return;
  }

  if (parse.kind !== "run") {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "unsupported_slash_command_action",
        command: payload.command,
        action: adminCommandParseAction(parse),
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId
      })
    );
    return;
  }

  try {
    const runId = `cmd_${crypto.randomUUID()}`;
    const result = await runDailyNotify(config, { runId, trigger: "manual" });
    console.log(
      JSON.stringify({
        level: "info",
        event: "slash_command_run_done",
        command: payload.command,
        action: "run",
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId,
        run_id: runId,
        processed: result.processed,
        sent: result.sent,
        sent_channels: result.sentChannels,
        sent_dms: result.sentDms,
        skipped: result.skipped,
        deleted: result.deleted,
        errors: result.errors
      })
    );

    const status = result.errors > 0 ? "一部エラーあり" : "完了";
    const resultText = [
      `run ${status}: processed=${result.processed} ${formatRunSentForAdmin(result)} skipped=${result.skipped} deleted=${result.deleted} errors=${result.errors}`,
      `run_id: ${runId}`
    ].join("\n");
    await notifySlashCommandEphemeral(config, payload, resultText);
  } catch (error) {
    if (isTransientError(error)) throw error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "slash_command_async_failed",
        command: payload.command,
        action: "run",
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId,
        message: errorMessage
      })
    );
    await notifySlashCommandEphemeral(config, payload, `処理に失敗しました: ${errorMessage}`);
  }
};
