import type { AppConfig } from "../config";
import {
  parseRegistrationNotifyMode,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { isTransientError } from "../errors/transient";
import { runDailyNotify } from "../jobs/daily-notify";
import { isValidJstDateString, getJstDateParts } from "../domain/jst-date";
import { checkDbSchema } from "../db/schema-check";
import { getImportGateMessage } from "../db/import-gate";
import { upsertMemberMaster } from "../db/member-master-repository";
import { DbSchemaMismatchError, assertDbSchema } from "../db/schema-check";
import {
  ABSENCE_EDIT_MODAL_CALLBACK_ID,
  handleAbsenceEditInteraction,
  openAbsenceEditModal,
  formatResolveOwnAbsenceForEditError,
  resolveOwnAbsenceForEdit,
  findOwnAbsenceRecordsByStartDate
} from "./absence-edit";
import { showOwnAbsenceList, handleAbsenceListInteraction } from "./absence-list";
import { openAbsenceRegisterModal, handleAbsenceRegisterInteraction } from "./absence-register";
import { handleAbsenceMentionInteraction, isMentionAction } from "./absence-mention";
import { handleAppHomeInteraction } from "./app-home";
import { MEMBER_MASTER_MODAL_CALLBACK_ID, openMemberMasterSettingsModal } from "./member-master-modal";
import { slackApi } from "./api";
import { readImportCompleted, readLastRunSummary } from "../state/kv";

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

type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  user?: { id?: string };
  channel?: { id?: string };
  response_url?: string;
  container?: { type?: string };
  view?: {
    type?: string;
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
  actions?: Array<{ action_id?: string; value?: string }>;
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

export type SlackInteractionResult = {
  ok: boolean;
  error?: string;
  errorBlockId?: string;
  followUp?: () => Promise<void>;
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

const postEphemeralResponse = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  text: string,
  blocks?: Array<Record<string, unknown>>
): Promise<void> => {
  if (payload.responseUrl) {
    try {
      const body: Record<string, unknown> = { response_type: "ephemeral", text };
      if (blocks) body.blocks = blocks;
      const response = await fetch(payload.responseUrl, {
        method: "POST",
        headers: { "Content-Type": "application/json; charset=utf-8" },
        body: JSON.stringify(body)
      });
      if (response.ok) return;
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

  if (!payload.channelId) return;
  try {
    await slackApi.postEphemeral(config, payload.channelId, payload.userId, text, blocks);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "slash_command_ephemeral_failed",
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId,
        channel_id: payload.channelId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
};

export const notifySlashCommandEphemeral = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  text: string
): Promise<void> => {
  await postEphemeralResponse(config, payload, text);
};

const buildHelpText = (): string =>
  [
    "/pasr help - ユーザ向けコマンドの使い方表示",
    "/pasr settings - 自分の通知設定を表示・編集",
    "/pasr list - 自分の不在一覧（編集・削除）",
    "/pasr update - /pasr list と同じ",
    "/pasr update YYYY-MM-DD - 開始日指定で不在を編集",
    "/pasr register - 自分の不在を登録"
  ].join("\n");

const buildAdminHelpText = (): string =>
  [
    "/pasr-admin help - 管理者向けコマンドの使い方表示",
    "/pasr-admin run - 通知処理を手動実行",
    "/pasr-admin status - 直近実行の要約表示"
  ].join("\n");

type CommandKind = "self" | "admin" | "unsupported";

const SELF_ACTIONS = ["help", "list", "settings", "update", "register"] as const;
const ADMIN_ACTIONS = ["help", "run", "status"] as const;

export const getCommandKind = (command: string): CommandKind => {
  if (command === "/pasr") return "self";
  if (command === "/pasr-admin") return "admin";
  return "unsupported";
};

const isAdminAction = (action: string): action is (typeof ADMIN_ACTIONS)[number] =>
  ADMIN_ACTIONS.includes(action as (typeof ADMIN_ACTIONS)[number]);

export const parseSlackCommandAction = (text: string): string =>
  text.split(/\s+/).filter((part) => part.length > 0)[0] ?? "help";

export const slashCommandLogFields = (payload: SlackCommandPayload): Record<string, string | boolean> => ({
  command: payload.command,
  action: parseSlackCommandAction(payload.text),
  text: payload.text,
  user_id: payload.userId,
  team_id: payload.teamId,
  trigger_id: payload.triggerId,
  has_response_url: payload.responseUrl.length > 0
});

const parseSelectedChannels = (value: unknown): string[] => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_conversations;
  if (!Array.isArray(selected)) return [];
  return selected.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const parseSelectedUsers = (value: unknown): string[] => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_users;
  if (!Array.isArray(selected)) return [];
  return selected.filter((entry): entry is string => typeof entry === "string" && entry.length > 0);
};

const parseActiveValue = (value: unknown): boolean => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selectedOptions = record?.selected_options;
  if (!Array.isArray(selectedOptions)) return false;
  return selectedOptions.some((option) => {
    const optionRecord = option && typeof option === "object" ? (option as Record<string, unknown>) : null;
    return optionRecord?.value === "active";
  });
};

const parseStaticSelectValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const option = record?.selected_option;
  if (!option || typeof option !== "object") return "";
  const optionRecord = option as Record<string, unknown>;
  return typeof optionRecord.value === "string" ? optionRecord.value : "";
};

const handleSelfImmediateText = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  parse: SelfCommandParse
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
        }
      };
    case "register":
      return {
        mode: "deferred",
        ackText: "不在登録フォームを開きます…",
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
              ? "指定された開始日の不在が見つかりませんでした。"
              : "同じ開始日の不在が複数あります。一覧から編集してください。";
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

export const resolveSlashCommandDispatch = async (
  config: AppConfig,
  payload: SlackCommandPayload
): Promise<SlashCommandDispatch> => {
  const commandKind = getCommandKind(payload.command);
  const action = parseSlackCommandAction(payload.text);
  if (commandKind === "admin") {
    const adminText = await getAdminImmediateText(config, payload, action);
    if (adminText !== undefined) return { mode: "text", text: adminText };
    return { mode: "queue" };
  }
  if (commandKind === "self") {
    const parse = parseSelfCommandText(payload.text);
    if (!isSelfAction(parseSlackCommandAction(payload.text)) && parse.kind === "unknown") {
      return { mode: "text", text: `unsupported action: ${parse.action}\n${buildHelpText()}` };
    }
    try {
      return await handleSelfImmediateText(config, payload, parse);
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

const getAdminImmediateText = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  action: string
): Promise<string | undefined> => {
  if (!isAdminAction(action)) {
    return `unsupported action: ${action}\n${buildAdminHelpText()}`;
  }
  if (action === "help") return buildAdminHelpText();
  if (action === "status") {
    const summary = await readLastRunSummary(config);
    const dbSchema = await checkDbSchema(config);
    const importCompleted = await readImportCompleted(config);
    const dbLine = `db: ${dbSchema === "ok" ? "ok" : "schema_missing"}`;
    const importLine = `import: ${importCompleted ? "completed" : "pending"}`;
    return summary
      ? [
          `last run: processed=${summary.processed} sent=${summary.sent} skipped=${summary.skipped} deleted=${summary.deleted ?? 0} errors=${summary.errors}`,
          `run_id: ${summary.runId}`,
          dbLine,
          importLine,
          `executed_at: ${summary.executedAt}`
        ].join("\n")
      : [`No run history yet.`, dbLine, importLine].join("\n");
  }
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

  const action = parseSlackCommandAction(payload.text);
  if (commandKind !== "admin") {
    return;
  }

  if (!isAdminAction(action) || action !== "run") {
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

  try {
    if (action === "run") {
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
          deleted: result.deleted,
          errors: result.errors
        })
      );

      const status = result.errors > 0 ? "一部エラーあり" : "完了";
      const resultText = [
        `run ${status}: processed=${result.processed} sent=${result.sent} skipped=${result.skipped} deleted=${result.deleted} errors=${result.errors}`,
        `run_id: ${runId}`
      ].join("\n");
      await postEphemeralResponse(config, payload, resultText);
      return;
    }
  } catch (error) {
    if (isTransientError(error)) throw error;
    const errorMessage = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "slash_command_async_failed",
        command: payload.command,
        action,
        trigger_id: payload.triggerId,
        user_id: payload.userId,
        team_id: payload.teamId,
        message: errorMessage
      })
    );
    await notifySlashCommandEphemeral(config, payload, `処理に失敗しました: ${errorMessage}`);
  }
};

export const handleSlackInteraction = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<SlackInteractionResult> => {
  const homeResult = await handleAppHomeInteraction(config, payload);
  if (homeResult.handled) {
    return { ok: homeResult.ok, followUp: homeResult.followUp };
  }

  const mentionResult = await handleAbsenceMentionInteraction(config, payload);
  if (isMentionAction(payload)) {
    return mentionResult;
  }

  const registerResult = await handleAbsenceRegisterInteraction(config, payload);
  if (payload.type === "view_submission" && payload.view?.callback_id === "pasr_absence_register") {
    return registerResult;
  }
  if (payload.type === "block_actions") {
    const registerActionId = payload.actions?.[0]?.action_id ?? "";
    if (registerActionId === "pasr_register_open") {
      return registerResult;
    }
  }

  const listResult = await handleAbsenceListInteraction(config, payload);
  if (listResult.followUp) {
    return listResult;
  }

  const editResult = await handleAbsenceEditInteraction(config, payload);
  if (payload.type === "view_submission" && payload.view?.callback_id === ABSENCE_EDIT_MODAL_CALLBACK_ID) {
    if (!editResult.ok) {
      return {
        ok: false,
        error: editResult.error,
        errorBlockId: editResult.errorBlockId
      };
    }
    return { ok: true };
  }

  if (payload.type !== "view_submission") {
    return { ok: true };
  }
  const callbackId = payload.view?.callback_id ?? "";
  if (callbackId !== MEMBER_MASTER_MODAL_CALLBACK_ID) {
    return { ok: true };
  }
  const metadataRaw = payload.view?.private_metadata ?? "";
  let metadata: { userId: string } | undefined;
  try {
    metadata = JSON.parse(metadataRaw) as { userId: string };
  } catch {
    return {
      ok: false,
      error: "フォーム情報の読み取りに失敗しました。もう一度 /pasr settings を実行してください。",
      errorBlockId: "active_block"
    };
  }
  if (!metadata || !metadata.userId) {
    return {
      ok: false,
      error: "フォーム情報が不足しています。もう一度 /pasr settings を実行してください。",
      errorBlockId: "active_block"
    };
  }
  const actorUserId = payload.user?.id ?? "";
  if (actorUserId !== metadata.userId) {
    return { ok: false, error: "本人以外の設定は更新できません。", errorBlockId: "active_block" };
  }
  const values = payload.view?.state?.values ?? {};
  const channelsValue = values.channels_block?.default_channels_select;
  const usersValue = values.users_block?.default_users_select;
  const activeValue = values.active_block?.active_checkbox;
  const registrationNotifyValue = values.registration_notify_block?.default_registration_notify_select;
  const defaultChannels = parseSelectedChannels(channelsValue);
  const defaultUsers = parseSelectedUsers(usersValue);
  const active = parseActiveValue(activeValue);
  const defaultRegistrationNotify = parseRegistrationNotifyMode(parseStaticSelectValue(registrationNotifyValue));
  const gateMessage = await getImportGateMessage(config);
  if (gateMessage) {
    return { ok: false, error: gateMessage, errorBlockId: "active_block" };
  }
  try {
    await assertDbSchema(config);
  } catch (error) {
    if (error instanceof DbSchemaMismatchError) {
      return { ok: false, error: "データベースの準備が完了していません。", errorBlockId: "active_block" };
    }
    throw error;
  }
  try {
    await upsertMemberMaster(config, {
      targetUser: metadata.userId,
      active,
      defaultNotifyChannels: defaultChannels,
      defaultNotifyUsers: defaultUsers,
      defaultRegistrationNotify
    });
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `設定の保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      errorBlockId: "active_block"
    };
  }
};
