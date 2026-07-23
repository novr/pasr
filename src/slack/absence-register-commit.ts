import type { AppConfig } from "../config";
import { DEFAULT_ABSENCE_TYPE, type AbsenceRecord } from "../domain/absence";
import {
  resolveRegistrationNotifyMode,
  validateAbsenceRegistration,
  type AbsenceRegisterValidationError,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { createAbsence } from "../db/absence-repository";
import { DbSchemaMismatchError } from "../db/schema-check";
import { runRegistrationNotifyAndAck } from "../jobs/registration-notify";
import { reconcileStatusIfRecordsAffectToday } from "../jobs/status-sync";
import { assertDbSchema } from "../db/schema-check";

export type CommitAbsenceRegistrationParams = {
  userId: string;
  channelId: string;
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
  try {
    await assertDbSchema(config);
  } catch (error) {
    if (error instanceof DbSchemaMismatchError) {
      return { ok: false, error: "データベースの準備が完了していません。", errorBlockId: "start_block" };
    }
    throw error;
  }

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

  const recordInput = {
    targetUser: params.userId,
    absenceType: DEFAULT_ABSENCE_TYPE,
    startDate: params.startDate,
    endDate: params.endDate,
    notifyChannels: [...new Set(params.notifyChannels)],
    notifyUsers: [...new Set(params.notifyUsers)],
    note: params.note || undefined
  };

  let record: AbsenceRecord;
  try {
    record = await createAbsence(config, recordInput);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.error(
      JSON.stringify({
        level: "error",
        event: "absence_register_failed",
        user_id: params.userId,
        message
      })
    );
    return {
      ok: false,
      error: `不在予定の登録に失敗しました: ${message}`,
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
      item_id: record.itemId,
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
        itemId: record.itemId,
        record,
        selectedMode: params.selectedMode,
        resolvedMode
      });
      await reconcileStatusIfRecordsAffectToday(config, {
        userId: params.userId,
        records: [record],
        runId: crypto.randomUUID()
      });
    }
  };
};
