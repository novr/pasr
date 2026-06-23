import type { AppConfig } from "../config";
import type { AbsenceRecord } from "../domain/absence";
import {
  formatRegistrationNotifyModeLabel,
  parseAbsenceTypeChoices,
  parseRegistrationNotifyMode,
  REGISTRATION_NOTIFY_SELECT_OPTIONS,
  resolveAbsenceEndDate,
  resolveRegistrationNotifyMode,
  validateAbsenceRegistration,
  type AbsenceTypeChoice,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { runRegistrationNotifyAndAck } from "../jobs/registration-notify";
import { ensureMemberMasterList, resolveActiveListIds } from "../jobs/setup";
import { slackApi } from "./api";

export const ABSENCE_REGISTER_MODAL_CALLBACK_ID = "pasr_absence_register";
export const ABSENCE_REGISTER_OPEN_ACTION_ID = "pasr_register_open";

type AbsenceRegisterMetadata = {
  userId: string;
  absenceListId: string;
  channelId: string;
};

type MasterContext = {
  memberMasterListId: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
};

type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  user?: { id?: string };
  channel?: { id?: string };
  actions?: Array<{ action_id?: string }>;
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
};

export type AbsenceRegisterInteractionResult = {
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

const parseStaticSelectValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const option = record?.selected_option;
  if (!option || typeof option !== "object") return "";
  const optionRecord = option as Record<string, unknown>;
  return typeof optionRecord.value === "string" ? optionRecord.value : "";
};

const parsePlainTextValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const text = record?.value;
  return typeof text === "string" ? text.trim() : "";
};

const buildTypeSelectElement = (
  typeChoices: AbsenceTypeChoice[],
  initialValue?: string
): Record<string, unknown> => {
  const options = typeChoices.map((choice) => ({
    text: { type: "plain_text", text: choice.label },
    value: choice.value
  }));
  const initial = initialValue ?? typeChoices[0]?.value;
  const element: Record<string, unknown> = {
    type: "static_select",
    action_id: "type_select",
    options
  };
  const initialOption = options.find((option) => option.value === initial);
  if (initialOption) {
    element.initial_option = initialOption;
  }
  return element;
};

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
    action_id: "registration_notify_select",
    options,
    initial_option: initialOption
  };
};

export const buildAbsenceRegisterModalView = (params: {
  userId: string;
  absenceListId: string;
  channelId: string;
  typeChoices: AbsenceTypeChoice[];
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
}): Record<string, unknown> => ({
  type: "modal",
  callback_id: ABSENCE_REGISTER_MODAL_CALLBACK_ID,
  private_metadata: JSON.stringify({
    userId: params.userId,
    absenceListId: params.absenceListId,
    channelId: params.channelId
  } satisfies AbsenceRegisterMetadata),
  title: { type: "plain_text", text: "不在登録" },
  submit: { type: "plain_text", text: "登録" },
  close: { type: "plain_text", text: "キャンセル" },
  blocks: [
    {
      type: "section",
      text: { type: "mrkdwn", text: `登録者: <@${params.userId}>` }
    },
    {
      type: "context",
      elements: [
        {
          type: "mrkdwn",
          text: "当日の不在は、9:00 JST の日次通知前は選択した登録通知に従います。9:00 以降の登録は自動で通知します（設定済みの CH/DM）。"
        }
      ]
    },
    {
      type: "input",
      block_id: "start_block",
      label: { type: "plain_text", text: "開始日" },
      element: {
        type: "datepicker",
        action_id: "start_date",
        placeholder: { type: "plain_text", text: "開始日を選択" }
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
        placeholder: { type: "plain_text", text: "終了日を選択" }
      }
    },
    {
      type: "input",
      block_id: "type_block",
      label: { type: "plain_text", text: "不在種類" },
      element: buildTypeSelectElement(params.typeChoices)
    },
    {
      type: "input",
      block_id: "note_block",
      optional: true,
      label: { type: "plain_text", text: "備考" },
      element: {
        type: "plain_text_input",
        action_id: "note_input",
        multiline: true
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
        initial_conversations: params.defaultNotifyChannels
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
        initial_users: params.defaultNotifyUsers
      }
    },
    {
      type: "input",
      block_id: "notify_block",
      label: { type: "plain_text", text: "登録通知" },
      element: buildRegistrationNotifySelectElement(params.defaultRegistrationNotify)
    }
  ]
});

const resolveMasterContext = async (config: AppConfig, userId: string): Promise<MasterContext> => {
  const memberMasterListId = await ensureMemberMasterList(config);
  const resolved = await slackApi.resolveMemberMasterRecord(config, memberMasterListId, userId);
  return {
    memberMasterListId,
    active: resolved.active,
    defaultNotifyChannels: resolved.defaultNotifyChannels,
    defaultNotifyUsers: resolved.defaultNotifyUsers,
    defaultRegistrationNotify: resolved.defaultRegistrationNotify
  };
};

const resolveAbsenceListId = async (config: AppConfig): Promise<string> => {
  const { absenceListId } = await resolveActiveListIds(config);
  return absenceListId;
};

export const openAbsenceRegisterModal = async (
  config: AppConfig,
  params: {
    triggerId: string;
    userId: string;
    channelId: string;
    teamId: string;
    triggerSource: "slash" | "mention_button";
  }
): Promise<void> => {
  const master = await resolveMasterContext(config, params.userId);
  const absenceListId = await resolveAbsenceListId(config);
  const schema = await slackApi.readAbsenceSchemaColumns(config, absenceListId);
  const typeChoices = parseAbsenceTypeChoices(schema);
  await slackApi.openModal(
    config,
    params.triggerId,
    buildAbsenceRegisterModalView({
      userId: params.userId,
      absenceListId,
      channelId: params.channelId,
      typeChoices,
      defaultNotifyChannels: master.defaultNotifyChannels,
      defaultNotifyUsers: master.defaultNotifyUsers,
      defaultRegistrationNotify: master.defaultRegistrationNotify
    })
  );
  console.log(
    JSON.stringify({
      level: "info",
      event: "absence_register_modal_opened",
      user_id: params.userId,
      team_id: params.teamId,
      trigger_source: params.triggerSource
    })
  );
};

const parseAbsenceRegisterMetadata = (raw: string): AbsenceRegisterMetadata | undefined => {
  try {
    const parsed = JSON.parse(raw) as AbsenceRegisterMetadata;
    if (!parsed?.userId || !parsed?.absenceListId) return undefined;
    return {
      userId: parsed.userId,
      absenceListId: parsed.absenceListId,
      channelId: parsed.channelId ?? ""
    };
  } catch {
    return undefined;
  }
};

const handleAbsenceRegisterSubmission = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceRegisterInteractionResult> => {
  const metadata = parseAbsenceRegisterMetadata(payload.view?.private_metadata ?? "");
  if (!metadata) {
    return {
      ok: false,
      error: "フォーム情報の読み取りに失敗しました。もう一度 /pasr register を実行してください。",
      errorBlockId: "start_block"
    };
  }
  const actorUserId = payload.user?.id ?? "";
  if (actorUserId !== metadata.userId) {
    return { ok: false, error: "本人以外は登録できません。", errorBlockId: "start_block" };
  }

  const values = payload.view?.state?.values ?? {};
  const startDate = parseDateValue(values.start_block?.start_date);
  const endDate = resolveAbsenceEndDate(startDate, parseDateValue(values.end_block?.end_date));
  const absenceType = parseStaticSelectValue(values.type_block?.type_select);
  const note = parsePlainTextValue(values.note_block?.note_input);
  const notifyChannels = parseSelectedChannels(values.channels_block?.notify_channels_select);
  const notifyUsers = parseSelectedUsers(values.users_block?.notify_users_select);
  const selectedMode = parseRegistrationNotifyMode(
    parseStaticSelectValue(values.notify_block?.registration_notify_select)
  );

  const master = await resolveMasterContext(config, metadata.userId);
  const { day: todayJst } = getJstDateParts();
  const validationError = validateAbsenceRegistration({
    startDate,
    endDate,
    todayJst,
    notifyMode: selectedMode,
    channels: notifyChannels,
    users: notifyUsers,
    active: master.active
  });
  if (validationError) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "absence_register_validation_failed",
        user_id: metadata.userId,
        reason: validationError.reason
      })
    );
    const errorMessage =
      validationError.reason === "inactive_user"
        ? "通知対象が無効です。/pasr update で有効化してください。"
        : validationError.reason === "past_date"
          ? "過去日は指定できません。"
          : validationError.reason === "invalid_range"
            ? "開始日は終了日以前にしてください。"
            : "登録通知の設定に合わせて通知先を指定してください。";
    return { ok: false, error: errorMessage, errorBlockId: validationError.blockId };
  }

  const record: AbsenceRecord = {
    itemId: "",
    targetUser: metadata.userId,
    absenceType: absenceType || undefined,
    startDate,
    endDate,
    notifyChannels: [...new Set(notifyChannels)],
    notifyUsers: [...new Set(notifyUsers)],
    note: note || undefined
  };

  let itemId = "";
  try {
    const created = await slackApi.createAbsenceItem(config, metadata.absenceListId, record);
    itemId = created.id ?? created.item?.id ?? "";
    record.itemId = itemId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "absence_register_failed",
        user_id: metadata.userId,
        list_id: metadata.absenceListId,
        message
      })
    );
    return {
      ok: false,
      error: `不在の登録に失敗しました: ${message}`,
      errorBlockId: "start_block"
    };
  }

  const resolvedMode = resolveRegistrationNotifyMode(
    startDate,
    endDate,
    todayJst,
    new Date(),
    selectedMode
  );

  console.log(
    JSON.stringify({
      level: "info",
      event: "absence_registered",
      user_id: metadata.userId,
      list_id: metadata.absenceListId,
      item_id: itemId,
      start_date: startDate,
      end_date: endDate,
      absence_type: absenceType,
      registration_notify_mode: selectedMode,
      resolved_notify_mode: resolvedMode
    })
  );

  return {
    ok: true,
    followUp: async () => {
      await runRegistrationNotifyAndAck(config, {
        userId: metadata.userId,
        channelId: metadata.channelId,
        itemId,
        listId: metadata.absenceListId,
        record,
        selectedMode,
        resolvedMode
      });
    }
  };
};

export const handleAbsenceRegisterInteraction = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceRegisterInteractionResult> => {
  if (payload.type === "block_actions") {
    const actionId = payload.actions?.[0]?.action_id ?? "";
    if (actionId !== ABSENCE_REGISTER_OPEN_ACTION_ID) {
      return { ok: true };
    }
    const triggerId = payload.trigger_id ?? "";
    const userId = payload.user?.id ?? "";
    const channelId = payload.channel?.id ?? "";
    if (!triggerId || !userId || !channelId) {
      return { ok: true };
    }
    try {
      await openAbsenceRegisterModal(config, {
        triggerId,
        userId,
        channelId,
        teamId: "",
        triggerSource: "mention_button"
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "absence_register_modal_open_failed",
          user_id: userId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
    return { ok: true };
  }

  if (payload.type === "view_submission" && payload.view?.callback_id === ABSENCE_REGISTER_MODAL_CALLBACK_ID) {
    return handleAbsenceRegisterSubmission(config, payload);
  }

  return { ok: true };
};

export const formatMasterRegistrationNotifyForView = (mode: RegistrationNotifyMode): string =>
  formatRegistrationNotifyModeLabel(mode);
