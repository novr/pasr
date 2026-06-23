import type { AppConfig } from "../config";
import {
  parseRegistrationNotifyMode,
  REGISTRATION_NOTIFY_SELECT_OPTIONS,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { isTransientError } from "../errors/transient";
import { runDailyNotify } from "../jobs/daily-notify";
import { isValidJstDateString, getJstDateParts } from "../domain/jst-date";
import { findOwnAbsenceByStartDate, parseAbsence, type AbsenceRecord } from "../domain/absence";
import { ensureMemberMasterList, resolveActiveListIds, runListMigration, runListPrune } from "../jobs/setup";
import { ABSENCE_EDIT_MODAL_CALLBACK_ID, handleAbsenceEditInteraction, openAbsenceEditModal, formatResolveOwnAbsenceForEditError, resolveOwnAbsenceForEdit } from "./absence-edit";
import { showOwnAbsenceList, handleAbsenceListInteraction } from "./absence-list";
import { openAbsenceRegisterModal, handleAbsenceRegisterInteraction } from "./absence-register";
import { handleAbsenceMentionInteraction, isMentionAction } from "./absence-mention";
import { slackApi } from "./api";
import { readLastRunSummary, readPersistedMemberMasterListId } from "../state/kv";

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
    case "migrate":
      return "migrate を実行中です。完了後に結果を表示します。";
    case "prune":
      return "prune を実行中です。完了後に結果を表示します。";
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
  actions?: Array<{ action_id?: string; value?: string }>;
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
};

export type SlashCommandDispatch =
  | { mode: "text"; text: string }
  | { mode: "queue"; listPrefix?: string };

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
    "/pasr-admin status - 直近実行の要約表示",
    "/pasr-admin migrate - absence/member_master を新スキーマへ移行",
    "/pasr-admin prune - migrate 後に旧 absence/member_master List を削除"
  ].join("\n");

const buildSlackListLink = (teamId: string, listId: string): string =>
  `https://app.slack.com/lists/${teamId}/${listId}`;

const formatListLinks = (teamId: string, listIds: string[]): string =>
  listIds.length > 0 ? listIds.map((listId) => buildSlackListLink(teamId, listId)).join(", ") : "none";

const formatMigrationKind = (
  teamId: string,
  target: {
    listName: string;
    fromListIds: string[];
    toListId: string;
    sourceRows: number;
    migratedRows: number;
    skippedRows: number;
    errors: number;
    skipped: boolean;
  }
): string => {
  if (target.skipped) {
    return `${target.listName}: skip (up to date) list=${buildSlackListLink(teamId, target.toListId)}`;
  }
  return [
    `${target.listName}: source=${target.sourceRows} migrated=${target.migratedRows} skipped=${target.skippedRows} errors=${target.errors}`,
    `from: ${formatListLinks(teamId, target.fromListIds)}`,
    `to: ${buildSlackListLink(teamId, target.toListId)}`
  ].join("\n");
};

type CommandKind = "self" | "admin" | "unsupported";

const SELF_ACTIONS = ["help", "list", "settings", "update", "register"] as const;
const ADMIN_ACTIONS = ["help", "run", "status", "migrate", "prune"] as const;

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

const resolveSelfMasterRecord = async (
  config: AppConfig,
  payload: SlackCommandPayload
): Promise<{
  memberMasterListId: string;
  recordId: string;
  created: boolean;
  deleted: string[];
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
}> => {
  const memberMasterListId = await ensureMemberMasterList(config);
  const resolved = await slackApi.resolveMemberMasterRecord(config, memberMasterListId, payload.userId);
  if (!resolved.kept) {
    throw new Error("member_master record resolution failed");
  }
  return {
    memberMasterListId,
    recordId: resolved.kept,
    created: resolved.created,
    deleted: resolved.deleted,
    targetUser: resolved.targetUser,
    active: resolved.active,
    defaultNotifyChannels: resolved.defaultNotifyChannels,
    defaultNotifyUsers: resolved.defaultNotifyUsers,
    defaultRegistrationNotify: resolved.defaultRegistrationNotify
  };
};

const MEMBER_MASTER_MODAL_CALLBACK_ID = "pasr_member_master_update";

const buildRegistrationNotifySelectElement = (
  initialMode: RegistrationNotifyMode
): Record<string, unknown> => {
  const options = REGISTRATION_NOTIFY_SELECT_OPTIONS.map((option) => ({
    text: { type: "plain_text", text: option.label },
    value: option.value
  }));
  const initialOption = options.find((option) => option.value === initialMode) ?? options[0];
  return {
    type: "static_select",
    action_id: "default_registration_notify_select",
    options,
    initial_option: initialOption
  };
};

const buildMemberMasterModalView = (params: {
  userId: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
}): Record<string, unknown> => ({
  type: "modal",
  callback_id: MEMBER_MASTER_MODAL_CALLBACK_ID,
  private_metadata: JSON.stringify({
    userId: params.userId
  }),
  title: { type: "plain_text", text: "PASR Self Profile" },
  submit: { type: "plain_text", text: "Save" },
  close: { type: "plain_text", text: "Cancel" },
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: `更新対象: <@${params.userId}>` }
    },
    {
      type: "input",
      block_id: "active_block",
      optional: true,
      label: { type: "plain_text", text: "Active" },
      element: {
        type: "checkboxes",
        action_id: "active_checkbox",
        options: [{ text: { type: "plain_text", text: "通知対象として有効" }, value: "active" }],
        initial_options: params.active ? [{ text: { type: "plain_text", text: "通知対象として有効" }, value: "active" }] : []
      }
    },
    {
      type: "input",
      block_id: "channels_block",
      optional: true,
      label: { type: "plain_text", text: "Default Notify Channels" },
      element: {
        type: "multi_conversations_select",
        action_id: "default_channels_select",
        initial_conversations: params.defaultNotifyChannels
      }
    },
    {
      type: "input",
      block_id: "users_block",
      optional: true,
      label: { type: "plain_text", text: "Default Notify Users" },
      element: {
        type: "multi_users_select",
        action_id: "default_users_select",
        initial_users: params.defaultNotifyUsers
      }
    },
    {
      type: "input",
      block_id: "registration_notify_block",
      label: { type: "plain_text", text: "既定の登録通知" },
      element: buildRegistrationNotifySelectElement(params.defaultRegistrationNotify)
    }
  ]
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
    case "settings": {
      const resolved = await resolveSelfMasterRecord(config, payload);
      await slackApi.openModal(
        config,
        payload.triggerId,
        buildMemberMasterModalView({
          userId: payload.userId,
          active: resolved.active,
          defaultNotifyChannels: resolved.defaultNotifyChannels,
          defaultNotifyUsers: resolved.defaultNotifyUsers,
          defaultRegistrationNotify: resolved.defaultRegistrationNotify
        })
      );
      return { mode: "text", text: "設定フォームを開きました。" };
    }
    case "register":
      await openAbsenceRegisterModal(config, {
        triggerId: payload.triggerId,
        userId: payload.userId,
        channelId: payload.channelId,
        teamId: payload.teamId,
        triggerSource: "slash"
      });
      return { mode: "text", text: "不在登録フォームを開きました。" };
    case "list":
    case "update_list":
    case "update_invalid_date":
      return { mode: "queue", listPrefix: selfListPrefixForParse(parse) };
    case "update_date": {
      const { absenceListId } = await resolveActiveListIds(config);
      const listResponse = await slackApi.listItems(config, absenceListId, { fetchContext: "absence_update_date" });
      const records: AbsenceRecord[] = [];
      for (const item of listResponse.items ?? []) {
        const parsed = parseAbsence(item);
        if (parsed.ok) records.push(parsed.record);
      }
      const { day: todayJst } = getJstDateParts();
      const matches = findOwnAbsenceByStartDate(records, payload.userId, parse.startDate, todayJst);
      if (matches.length === 1) {
        await openAbsenceEditModal(config, {
          triggerId: payload.triggerId,
          userId: payload.userId,
          record: matches[0],
          absenceListId
        });
        return { mode: "text", text: "編集フォームを開きました。" };
      }
      const listPrefix =
        matches.length === 0
          ? "指定された開始日の不在が見つかりませんでした。"
          : "同じ開始日の不在が複数あります。一覧から編集してください。";
      return { mode: "queue", listPrefix };
    }
    case "update_item": {
      const resolved = await resolveOwnAbsenceForEdit(
        config,
        payload.userId,
        parse.itemId,
        "absence_update_item"
      );
      if (!resolved.ok) {
        return { mode: "text", text: formatResolveOwnAbsenceForEditError(resolved.reason) };
      }
      await openAbsenceEditModal(config, {
        triggerId: payload.triggerId,
        userId: payload.userId,
        record: resolved.record,
        absenceListId: resolved.absenceListId
      });
      return { mode: "text", text: "編集フォームを開きました。" };
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
    const memberMasterListId = await readPersistedMemberMasterListId(config);
    return summary
      ? [
          `last run: processed=${summary.processed} sent=${summary.sent} skipped=${summary.skipped} deleted=${summary.deleted ?? 0} errors=${summary.errors}`,
          `run_id: ${summary.runId}`,
          `absent: ${buildSlackListLink(payload.teamId, summary.listId)}`,
          `master: ${memberMasterListId ? buildSlackListLink(payload.teamId, memberMasterListId) : "N/A"}`,
          `executed_at: ${summary.executedAt}`
        ].join("\n")
      : "No run history yet.";
  }
  if (action === "migrate") {
    return undefined;
  }
  if (action === "prune") {
    return undefined;
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

  if (!isAdminAction(action) || (action !== "run" && action !== "migrate" && action !== "prune")) {
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

    if (action === "migrate") {
      const result = await runListMigration(config);
      if (result.skippedMigration) {
        const resultText = [
          "migrate skip: absence/member_master は最新スキーマです。",
          formatMigrationKind(payload.teamId, result.absence),
          formatMigrationKind(payload.teamId, result.memberMaster)
        ].join("\n");
        await postEphemeralResponse(config, payload, resultText);
        return;
      }
      const totalErrors = result.absence.errors + result.memberMaster.errors;
      const status = totalErrors > 0 ? "一部エラーあり" : "完了";
      console.log(
        JSON.stringify({
          level: "info",
          event: "slash_command_migrate_done",
          command: payload.command,
          action,
          trigger_id: payload.triggerId,
          user_id: payload.userId,
          team_id: payload.teamId,
          absence: result.absence,
          memberMaster: result.memberMaster
        })
      );
      const resultText = [
        `migrate ${status}`,
        formatMigrationKind(payload.teamId, result.absence),
        formatMigrationKind(payload.teamId, result.memberMaster),
        ...result.hints
      ].join("\n");
      await postEphemeralResponse(config, payload, resultText);
      return;
    }

    if (action === "prune") {
      const result = await runListPrune(config);
      if (result.skippedPrune) {
        const resultText = ["prune skip: 先に /pasr-admin migrate を実行してください。", ...result.hints].join("\n");
        await postEphemeralResponse(config, payload, resultText);
        return;
      }
      const totalErrors = result.absence.errors + result.memberMaster.errors;
      const status = totalErrors > 0 ? "一部エラーあり" : "完了";
      const resultText = [
        `prune ${status}`,
        `absence: found=${result.absence.found} deleted=${result.absence.deleted} errors=${result.absence.errors}`,
        `member_master: found=${result.memberMaster.found} deleted=${result.memberMaster.deleted} errors=${result.memberMaster.errors}`,
        `active absence: ${buildSlackListLink(payload.teamId, result.absence.activeListId)}`,
        `active member_master: ${buildSlackListLink(payload.teamId, result.memberMaster.activeListId)}`,
        ...result.hints
      ].join("\n");
      await postEphemeralResponse(config, payload, resultText);
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
  try {
    const memberMasterListId = await ensureMemberMasterList(config);
    const resolved = await slackApi.resolveMemberMasterRecord(config, memberMasterListId, metadata.userId);
    await slackApi.updateMemberMasterItem(
      config,
      memberMasterListId,
      resolved.kept,
      metadata.userId,
      defaultChannels,
      defaultUsers,
      active,
      defaultRegistrationNotify
    );
    if (resolved.deleted.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "member_master_duplicates_cleaned_on_update",
          targetUser: metadata.userId,
          deletedCount: resolved.deleted.length,
          keptRecordId: resolved.kept
        })
      );
    }
    return { ok: true };
  } catch (error) {
    return {
      ok: false,
      error: `設定の保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      errorBlockId: "active_block"
    };
  }
};
