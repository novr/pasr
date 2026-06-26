import type { AppConfig } from "../config";
import { DEFAULT_ABSENCE_TYPE, findOwnAbsenceByStartDate, type AbsenceRecord } from "../domain/absence";
import {
  resolveAbsenceEndDate,
  validateAbsenceEdit,
  type AbsenceEditValidationError
} from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { toNoteText } from "../domain/rich-text-plain";
import {
  getAbsenceById,
  listAbsencesByUserFuture,
  updateAbsence
} from "../db/absence-repository";
import { DbSchemaMismatchError } from "../db/schema-check";
import { assertDbSchema } from "../db/schema-check";
import { slackApi } from "./api";
import { ABSENCE_EDIT_OPEN_ACTION_ID } from "./absence-list-blocks";
import { isAppHomeBlockActions } from "./app-home-context";
import { refreshAppHomeAfterMutation } from "./app-home-publish";
import { resolveMasterContext } from "./member-master-context";

export const ABSENCE_EDIT_MODAL_CALLBACK_ID = "pasr_absence_edit";

type AbsenceEditMetadata = {
  userId: string;
  itemId: string;
  originalStartDate: string;
  fromAppHome?: boolean;
};

type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  user?: { id?: string };
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

export type AbsenceEditInteractionResult = {
  ok: boolean;
  error?: string;
  errorBlockId?: string;
  followUp?: () => Promise<void>;
};

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

const parseDateValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_date;
  return typeof selected === "string" ? selected : "";
};

const parsePlainTextValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const text = record?.value;
  return typeof text === "string" ? text.trim() : "";
};

const formatEditValidationError = (error: AbsenceEditValidationError): string => {
  switch (error.reason) {
    case "inactive_user":
      return "通知対象が無効です。/pasr settings で有効化してください。";
    case "past_end_date":
      return "終了日は今日以降にしてください。";
    case "past_start_change":
      return "開始日を過去日に変更することはできません。";
    case "invalid_range":
      return "開始日は終了日以前にしてください。";
    case "missing_notify_target":
      return "通知チャンネルまたは通知ユーザーを1件以上指定してください。";
    default: {
      const _never: never = error.reason;
      return _never;
    }
  }
};

export const buildAbsenceEditModalView = (params: {
  userId: string;
  record: AbsenceRecord;
  fromAppHome?: boolean;
}): Record<string, unknown> => ({
  type: "modal",
  callback_id: ABSENCE_EDIT_MODAL_CALLBACK_ID,
  private_metadata: JSON.stringify({
    userId: params.userId,
    itemId: params.record.itemId,
    originalStartDate: params.record.startDate,
    ...(params.fromAppHome ? { fromAppHome: true } : {})
  } satisfies AbsenceEditMetadata),
  title: { type: "plain_text", text: "不在編集" },
  submit: { type: "plain_text", text: "保存" },
  close: { type: "plain_text", text: "キャンセル" },
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: `編集対象: <@${params.userId}>` }
    },
    {
      type: "input",
      block_id: "start_block",
      label: { type: "plain_text", text: "開始日" },
      element: {
        type: "datepicker",
        action_id: "start_date",
        initial_date: params.record.startDate
      }
    },
    {
      type: "input",
      block_id: "end_block",
      optional: true,
      label: { type: "plain_text", text: "終了日" },
      element: {
        type: "datepicker",
        action_id: "end_date",
        initial_date: params.record.endDate
      }
    },
    {
      type: "input",
      block_id: "note_block",
      optional: true,
      label: { type: "plain_text", text: "詳細（任意）" },
      element: {
        type: "plain_text_input",
        action_id: "note_input",
        multiline: true,
        initial_value: toNoteText(params.record.note ?? "")
      }
    },
    {
      type: "input",
      block_id: "channels_block",
      optional: true,
      label: { type: "plain_text", text: "通知チャンネル" },
      element: {
        type: "multi_conversations_select",
        action_id: "notify_channels_select",
        initial_conversations: params.record.notifyChannels
      }
    },
    {
      type: "input",
      block_id: "users_block",
      optional: true,
      label: { type: "plain_text", text: "通知ユーザー" },
      element: {
        type: "multi_users_select",
        action_id: "notify_users_select",
        initial_users: params.record.notifyUsers
      }
    }
  ]
});

export const openAbsenceEditModal = async (
  config: AppConfig,
  params: { triggerId: string; userId: string; record: AbsenceRecord; fromAppHome?: boolean }
): Promise<void> => {
  await slackApi.openModal(
    config,
    params.triggerId,
    buildAbsenceEditModalView({
      userId: params.userId,
      record: params.record,
      fromAppHome: params.fromAppHome
    })
  );
};

export type ResolveOwnAbsenceForEditFailure = "not_found" | "forbidden" | "ended";

export const resolveOwnAbsenceForEdit = async (
  config: AppConfig,
  userId: string,
  itemId: string
): Promise<
  | { ok: true; record: AbsenceRecord }
  | { ok: false; reason: ResolveOwnAbsenceForEditFailure }
> => {
  const record = await getAbsenceById(config, itemId);
  if (!record) return { ok: false, reason: "not_found" };
  if (record.targetUser !== userId) return { ok: false, reason: "forbidden" };
  const { day: todayJst } = getJstDateParts();
  if (record.endDate < todayJst) return { ok: false, reason: "ended" };
  return { ok: true, record };
};

export const formatResolveOwnAbsenceForEditError = (reason: ResolveOwnAbsenceForEditFailure): string => {
  switch (reason) {
    case "not_found":
      return "対象の不在が見つかりませんでした。";
    case "forbidden":
      return "本人の不在のみ編集できます。";
    case "ended":
      return "終了済みの不在は編集できません。";
    default: {
      const _never: never = reason;
      return _never;
    }
  }
};

const parseEditMetadata = (raw: string): AbsenceEditMetadata | undefined => {
  try {
    const parsed = JSON.parse(raw) as AbsenceEditMetadata;
    if (!parsed?.userId || !parsed?.itemId || !parsed?.originalStartDate) {
      return undefined;
    }
    return parsed;
  } catch {
    return undefined;
  }
};

const handleEditSubmission = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceEditInteractionResult> => {
  try {
    await assertDbSchema(config);
  } catch (error) {
    if (error instanceof DbSchemaMismatchError) {
      return { ok: false, error: "データベースの準備が完了していません。", errorBlockId: "start_block" };
    }
    throw error;
  }

  const metadata = parseEditMetadata(payload.view?.private_metadata ?? "");
  if (!metadata) {
    return {
      ok: false,
      error: "フォーム情報の読み取りに失敗しました。もう一度お試しください。",
      errorBlockId: "start_block"
    };
  }
  const actorUserId = payload.user?.id ?? "";
  if (actorUserId !== metadata.userId) {
    return { ok: false, error: "本人以外は編集できません。", errorBlockId: "start_block" };
  }

  const values = payload.view?.state?.values ?? {};
  const startDate = parseDateValue(values.start_block?.start_date);
  const endDate = resolveAbsenceEndDate(startDate, parseDateValue(values.end_block?.end_date));
  const note = parsePlainTextValue(values.note_block?.note_input);
  const notifyChannels = parseSelectedChannels(values.channels_block?.notify_channels_select);
  const notifyUsers = parseSelectedUsers(values.users_block?.notify_users_select);
  const { day: todayJst } = getJstDateParts();

  const master = await resolveMasterContext(config, metadata.userId);
  const validationError = validateAbsenceEdit({
    startDate,
    endDate,
    todayJst,
    channels: notifyChannels,
    users: notifyUsers,
    active: master.active,
    originalStartDate: metadata.originalStartDate
  });
  if (validationError) {
    return {
      ok: false,
      error: formatEditValidationError(validationError),
      errorBlockId: validationError.blockId
    };
  }

  const resolved = await resolveOwnAbsenceForEdit(config, metadata.userId, metadata.itemId);
  if (!resolved.ok) {
    return {
      ok: false,
      error: formatResolveOwnAbsenceForEditError(resolved.reason),
      errorBlockId: "start_block"
    };
  }

  const record: AbsenceRecord = {
    itemId: resolved.record.itemId,
    targetUser: metadata.userId,
    absenceType: DEFAULT_ABSENCE_TYPE,
    startDate,
    endDate,
    notifyChannels: [...new Set(notifyChannels)],
    notifyUsers: [...new Set(notifyUsers)],
    note: note || undefined
  };

  try {
    await updateAbsence(config, record);
    console.log(
      JSON.stringify({
        level: "info",
        event: "absence_updated",
        user_id: metadata.userId,
        item_id: resolved.record.itemId
      })
    );
    return {
      ok: true,
      followUp: metadata.fromAppHome
        ? async () => {
            await refreshAppHomeAfterMutation(config, metadata.userId);
          }
        : undefined
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      error: `不在の更新に失敗しました: ${message}`,
      errorBlockId: "start_block"
    };
  }
};

export const handleAbsenceEditInteraction = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceEditInteractionResult> => {
  if (payload.type === "block_actions") {
    const action = payload.actions?.[0];
    if (!action || action.action_id !== ABSENCE_EDIT_OPEN_ACTION_ID) return { ok: true };
    const itemId = action.value ?? "";
    const triggerId = payload.trigger_id ?? "";
    const userId = payload.user?.id ?? "";
    if (!itemId || !triggerId || !userId) return { ok: true };
    try {
      const resolved = await resolveOwnAbsenceForEdit(config, userId, itemId);
      if (!resolved.ok) return { ok: true };
      const fromAppHome = isAppHomeBlockActions(payload);
      await openAbsenceEditModal(config, {
        triggerId,
        userId,
        record: resolved.record,
        fromAppHome
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "absence_edit_modal_open_failed",
          user_id: userId,
          itemId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return { ok: true };
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === ABSENCE_EDIT_MODAL_CALLBACK_ID) {
    return handleEditSubmission(config, payload);
  }

  return { ok: true };
};

export const findOwnAbsenceRecordsByStartDate = async (
  config: AppConfig,
  userId: string,
  startDate: string,
  todayJst: string
): Promise<AbsenceRecord[]> => {
  const records = await listAbsencesByUserFuture(config, userId, todayJst);
  return findOwnAbsenceByStartDate(records, userId, startDate, todayJst);
};
