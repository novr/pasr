import type { AppConfig } from "../config";
import { DEFAULT_ABSENCE_TYPE, type AbsenceRecord } from "../domain/absence";
import {
  resolveRegistrationNotifyMode,
  validateAbsenceRegistration,
  type AbsenceRegisterValidationError,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { runRegistrationNotifyAndAck } from "../jobs/registration-notify";
import { slackApi } from "./api";

export type CommitAbsenceRegistrationParams = {
  userId: string;
  channelId: string;
  absenceListId: string;
  startDate: string;
  endDate: string;
  note?: string;
  notifyChannels: string[];
  notifyUsers: string[];
  selectedMode: RegistrationNotifyMode;
  active: boolean;
};

export type CommitAbsenceRegistrationResult =
  | { ok: true; followUp: () => Promise<void> }
  | { ok: false; error: string; errorBlockId?: AbsenceRegisterValidationError["blockId"] };

export const formatAbsenceRegistrationValidationError = (
  error: AbsenceRegisterValidationError
): string => {
  switch (error.reason) {
    case "inactive_user":
      return "通知対象が無効です。/pasr settings で有効化してください。";
    case "past_date":
      return "過去日は指定できません。";
    case "invalid_range":
      return "開始日は終了日以前にしてください。";
    case "missing_notify_target":
      return "登録通知の設定に合わせて通知先を指定してください。";
    default: {
      const _never: never = error.reason;
      return _never;
    }
  }
};

export const commitAbsenceRegistration = async (
  config: AppConfig,
  params: CommitAbsenceRegistrationParams
): Promise<CommitAbsenceRegistrationResult> => {
  const { day: todayJst } = getJstDateParts();
  const validationError = validateAbsenceRegistration({
    startDate: params.startDate,
    endDate: params.endDate,
    todayJst,
    notifyMode: params.selectedMode,
    channels: params.notifyChannels,
    users: params.notifyUsers,
    active: params.active
  });
  if (validationError) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "absence_register_validation_failed",
        user_id: params.userId,
        reason: validationError.reason
      })
    );
    return {
      ok: false,
      error: formatAbsenceRegistrationValidationError(validationError),
      errorBlockId: validationError.blockId
    };
  }

  const record: AbsenceRecord = {
    itemId: "",
    targetUser: params.userId,
    absenceType: DEFAULT_ABSENCE_TYPE,
    startDate: params.startDate,
    endDate: params.endDate,
    notifyChannels: [...new Set(params.notifyChannels)],
    notifyUsers: [...new Set(params.notifyUsers)],
    note: params.note || undefined
  };

  let itemId = "";
  try {
    const created = await slackApi.createAbsenceItem(config, params.absenceListId, record);
    itemId = created.id ?? created.item?.id ?? "";
    record.itemId = itemId;
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "absence_register_failed",
        user_id: params.userId,
        list_id: params.absenceListId,
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
    params.startDate,
    params.endDate,
    todayJst,
    new Date(),
    params.selectedMode
  );

  console.log(
    JSON.stringify({
      level: "info",
      event: "absence_registered",
      user_id: params.userId,
      list_id: params.absenceListId,
      item_id: itemId,
      start_date: params.startDate,
      end_date: params.endDate,
      absence_type: DEFAULT_ABSENCE_TYPE,
      registration_notify_mode: params.selectedMode,
      resolved_notify_mode: resolvedMode
    })
  );

  return {
    ok: true,
    followUp: async () => {
      await runRegistrationNotifyAndAck(config, {
        userId: params.userId,
        channelId: params.channelId,
        itemId,
        listId: params.absenceListId,
        record,
        selectedMode: params.selectedMode,
        resolvedMode
      });
    }
  };
};
