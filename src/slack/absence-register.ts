import type { AppConfig } from "../config";
import {
  formatRegistrationNotifyModeLabel,
  parseRegistrationNotifyMode,
  REGISTRATION_NOTIFY_SELECT_OPTIONS,
  resolveAbsenceEndDate,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { parseMentionConfirmPayload } from "../domain/absence-mention-parse";
import { commitAbsenceRegistration } from "./absence-register-commit";
import { slackApi } from "./api";
import { resolveMasterContext } from "./member-master-context";
import { resolveAppHomeDmChannelId } from "./app-home-channel";
import { isAppHomeBlockActions } from "./app-home-context";
import { ABSENCE_REGISTER_OPEN_ACTION_ID } from "./action-ids";
import { consumeInteractionMessage } from "./interaction-message";
import { postUserFacingMessage } from "./user-message";

export const ABSENCE_REGISTER_MODAL_CALLBACK_ID = "pasr_absence_register";
export { ABSENCE_REGISTER_OPEN_ACTION_ID } from "./action-ids";

type AbsenceRegisterMetadata = {
  userId: string;
  channelId: string;
};

type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  response_url?: string;
  user?: { id?: string };
  channel?: { id?: string };
  container?: { type?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
  view?: {
    type?: string;
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
  channelId: string;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
  initialStartDate?: string;
  initialEndDate?: string;
  initialNote?: string;
}): Record<string, unknown> => {
  const startDateElement: Record<string, unknown> = {
    type: "datepicker",
    action_id: "start_date",
    placeholder: { type: "plain_text", text: "開始日を選択" }
  };
  if (params.initialStartDate) {
    startDateElement.initial_date = params.initialStartDate;
  }

  const endDateElement: Record<string, unknown> = {
    type: "datepicker",
    action_id: "end_date",
    placeholder: { type: "plain_text", text: "終了日を選択" }
  };
  if (params.initialEndDate) {
    endDateElement.initial_date = params.initialEndDate;
  }

  const noteElement: Record<string, unknown> = {
    type: "plain_text_input",
    action_id: "note_input",
    multiline: true,
    placeholder: { type: "plain_text", text: "例: 通院のため午後から、午前中のみ など" }
  };
  if (params.initialNote) {
    noteElement.initial_value = params.initialNote;
  }

  return {
  type: "modal",
  callback_id: ABSENCE_REGISTER_MODAL_CALLBACK_ID,
  private_metadata: JSON.stringify({
    userId: params.userId,
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
      element: startDateElement
    },
    {
      type: "input",
      block_id: "end_block",
      optional: true,
      label: { type: "plain_text", text: "終了日" },
      element: endDateElement
    },
    {
      type: "input",
      block_id: "note_block",
      optional: true,
      label: { type: "plain_text", text: "詳細（任意）" },
      element: noteElement
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
};
};

export const openAbsenceRegisterModal = async (
  config: AppConfig,
  params: {
    triggerId: string;
    userId: string;
    channelId: string;
    teamId: string;
    triggerSource: "slash" | "mention_button" | "app_home";
    initialStartDate?: string;
    initialEndDate?: string;
    initialNote?: string;
  }
): Promise<void> => {
  const master = await resolveMasterContext(config, params.userId);
  await slackApi.openModal(
    config,
    params.triggerId,
    buildAbsenceRegisterModalView({
      userId: params.userId,
      channelId: params.channelId,
      defaultNotifyChannels: master.defaultNotifyChannels,
      defaultNotifyUsers: master.defaultNotifyUsers,
      defaultRegistrationNotify: master.defaultRegistrationNotify,
      initialStartDate: params.initialStartDate,
      initialEndDate: params.initialEndDate,
      initialNote: params.initialNote
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
    if (!parsed?.userId) return undefined;
    return {
      userId: parsed.userId,
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
  const note = parsePlainTextValue(values.note_block?.note_input);
  const notifyChannels = parseSelectedChannels(values.channels_block?.notify_channels_select);
  const notifyUsers = parseSelectedUsers(values.users_block?.notify_users_select);
  const selectedMode = parseRegistrationNotifyMode(
    parseStaticSelectValue(values.notify_block?.registration_notify_select)
  );

  const master = await resolveMasterContext(config, metadata.userId);
  const result = await commitAbsenceRegistration(config, {
    userId: metadata.userId,
    channelId: metadata.channelId,
    startDate,
    endDate,
    note: note || undefined,
    notifyChannels,
    notifyUsers,
    selectedMode,
    active: master.active
  });
  if (!result.ok) {
    return { ok: false, error: result.error, errorBlockId: result.errorBlockId };
  }

  return { ok: true, followUp: result.followUp };
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
    const buttonValue = payload.actions?.[0]?.value ?? "";
    const fromAppHome = isAppHomeBlockActions(payload);
    if (!userId) {
      return { ok: true };
    }
    if (!triggerId) {
      if (fromAppHome) {
        try {
          const dmChannelId = await resolveAppHomeDmChannelId(config, userId, channelId);
          await postUserFacingMessage(config, {
            channelId: dmChannelId,
            userId,
            text: "登録フォームを開けませんでした。もう一度お試しください。"
          });
        } catch (error) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "absence_register_app_home_notify_failed",
              user_id: userId,
              message: error instanceof Error ? error.message : String(error)
            })
          );
        }
      }
      return { ok: true };
    }
    let resolvedChannelId = channelId;
    if (fromAppHome && !resolvedChannelId) {
      try {
        resolvedChannelId = await resolveAppHomeDmChannelId(config, userId);
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "absence_register_dm_resolve_failed",
            user_id: userId,
            message: error instanceof Error ? error.message : String(error)
          })
        );
        await postUserFacingMessage(config, {
          channelId,
          userId,
          text: "登録フォームを開けませんでした。しばらく待ってから再度お試しください。"
        }).catch(() => undefined);
        return { ok: true };
      }
    }
    if (!resolvedChannelId) {
      return { ok: true };
    }
    const mentionDraft = parseMentionConfirmPayload(buttonValue);
    if (mentionDraft && mentionDraft.userId !== userId) {
      await slackApi.postEphemeral(config, channelId, userId, "本人以外は編集できません。");
      return { ok: true };
    }
    if (mentionDraft && mentionDraft.channelId !== resolvedChannelId) {
      await slackApi.postEphemeral(
        config,
        resolvedChannelId,
        userId,
        "確認情報が無効です。もう一度 @PASR で登録してください。"
      );
      return { ok: true };
    }
    if (mentionDraft) {
      await consumeInteractionMessage(payload.response_url);
    }
    try {
      await openAbsenceRegisterModal(config, {
        triggerId,
        userId,
        channelId: resolvedChannelId,
        teamId: "",
        triggerSource: fromAppHome ? "app_home" : "mention_button",
        initialStartDate: mentionDraft?.startDate,
        initialEndDate: mentionDraft?.endDate,
        initialNote: mentionDraft?.note
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
      if (fromAppHome) {
        try {
          const dmChannelId = await resolveAppHomeDmChannelId(config, userId, resolvedChannelId);
          await postUserFacingMessage(config, {
            channelId: dmChannelId,
            userId,
            text: "登録フォームを開けませんでした。しばらく待ってから再度お試しください。"
          });
        } catch (notifyError) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "absence_register_app_home_notify_failed",
              user_id: userId,
              message: notifyError instanceof Error ? notifyError.message : String(notifyError)
            })
          );
        }
      }
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
