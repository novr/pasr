import type { AppConfig } from "../config";
import { reconcileStatusAfterMemberMasterSettingsChangeIsolated } from "../jobs/status-sync";
import { checkMemberMasterStatusPrefsSchema } from "../db/schema-check";
import { upsertMemberMaster, getMemberMaster } from "../db/member-master-repository";
import { DbSchemaMismatchError, assertDbSchema } from "../db/schema-check";
import {
  ABSENCE_EDIT_MODAL_CALLBACK_ID,
  handleAbsenceEditInteraction
} from "./absence-edit";
import { handleAbsenceListInteraction } from "./absence-list";
import { handleAbsenceRegisterInteraction } from "./absence-register";
import { handleAbsenceMentionInteraction, isMentionAction } from "./absence-mention";
import { handleAppHomeInteraction } from "./app-home";
import { refreshAppHomeAfterMutation } from "./app-home-publish";
import { handleAdminUsersPageInteraction } from "./admin-users";
import { handleAdminAbsencesPageInteraction } from "./admin-absences";
import {
  MEMBER_MASTER_MODAL_CALLBACK_ID,
  parseMemberMasterSubmission
} from "./member-master-modal";
import { handleStatusOAuthDisconnectAction } from "./status-oauth-ui";

export type SlackInteractionPayload = {
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

export type SlackInteractionResult = {
  ok: boolean;
  error?: string;
  errorBlockId?: string;
  followUp?: () => Promise<void>;
};

const handleMemberMasterSettingsSubmission = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<SlackInteractionResult> => {
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
  const statusPrefsEnabled = (await checkMemberMasterStatusPrefsSchema(config)) === "ok";
  const parsed = parseMemberMasterSubmission(values as Record<string, Record<string, unknown>>, {
    statusPrefsEnabled
  });
  if (!parsed.ok) {
    return { ok: false, error: parsed.error, errorBlockId: parsed.errorBlockId };
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
    const existing = await getMemberMaster(config, metadata.userId);
    const nextStatusDefaultText =
      parsed.record.statusDefaultText !== undefined
        ? parsed.record.statusDefaultText
        : existing?.statusDefaultText;
    const nextStatusEmoji =
      parsed.record.statusEmoji !== undefined ? parsed.record.statusEmoji : existing?.statusEmoji;
    const statusPrefsSubmitted =
      statusPrefsEnabled &&
      (parsed.record.statusDefaultText !== undefined || parsed.record.statusEmoji !== undefined);
    const statusPrefsChanged =
      statusPrefsSubmitted &&
      (nextStatusDefaultText !== existing?.statusDefaultText ||
        nextStatusEmoji !== existing?.statusEmoji);
    await upsertMemberMaster(config, {
      targetUser: metadata.userId,
      active: parsed.record.active,
      defaultNotifyChannels: parsed.record.defaultNotifyChannels,
      defaultNotifyUsers: parsed.record.defaultNotifyUsers,
      defaultRegistrationNotify: parsed.record.defaultRegistrationNotify,
      statusDefaultText: nextStatusDefaultText,
      statusEmoji: nextStatusEmoji
    });
    const userId = metadata.userId;
    return {
      ok: true,
      followUp: async () => {
        if (statusPrefsChanged) {
          await reconcileStatusAfterMemberMasterSettingsChangeIsolated(config, { userId });
        }
        await refreshAppHomeAfterMutation(config, userId);
      }
    };
  } catch (error) {
    return {
      ok: false,
      error: `設定の保存に失敗しました: ${error instanceof Error ? error.message : String(error)}`,
      errorBlockId: "active_block"
    };
  }
};

export const handleSlackInteraction = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<SlackInteractionResult> => {
  if (payload.type === "block_actions") {
    const actionId = payload.actions?.[0]?.action_id ?? "";
    const userId = payload.user?.id ?? "";
    const usersPageResult = await handleAdminUsersPageInteraction(config, {
      actionId,
      userId,
      pageValue: payload.actions?.[0]?.value ?? "",
      responseUrl: payload.response_url,
      channelId: payload.channel?.id
    });
    if (usersPageResult.handled) {
      return { ok: true, followUp: usersPageResult.followUp };
    }
    const absencesPageResult = await handleAdminAbsencesPageInteraction(config, {
      actionId,
      userId,
      pageValue: payload.actions?.[0]?.value ?? "",
      responseUrl: payload.response_url,
      channelId: payload.channel?.id
    });
    if (absencesPageResult.handled) {
      return { ok: true, followUp: absencesPageResult.followUp };
    }
    const disconnectResult = await handleStatusOAuthDisconnectAction(config, {
      actionId,
      userId: payload.user?.id ?? "",
      channelId: payload.channel?.id,
      responseUrl: payload.response_url
    });
    if (disconnectResult.handled) {
      return { ok: true, followUp: disconnectResult.followUp };
    }
  }

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
    return { ok: true, followUp: editResult.followUp };
  }

  if (payload.type !== "view_submission") {
    return { ok: true };
  }
  const callbackId = payload.view?.callback_id ?? "";
  if (callbackId !== MEMBER_MASTER_MODAL_CALLBACK_ID) {
    return { ok: true };
  }
  return handleMemberMasterSettingsSubmission(config, payload);
};
