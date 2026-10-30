import { getJstDateParts } from "./jst-date";

export const REGISTRATION_NOTIFY_MODES = ["none", "ch", "dm", "both"] as const;
export type RegistrationNotifyMode = (typeof REGISTRATION_NOTIFY_MODES)[number];

export const DAILY_NOTIFY_HOUR_JST = 9;

export const ABSENCE_TIME_HINT =
  "時刻は日本時間。空欄の日は終日。複数日は開始時刻を初日、終了時刻を最終日だけ案内";

const CLOCK_TIME_PATTERN = /^([01]\d|2[0-3]):[0-5]\d$/;

export type AbsenceTimeFields = {
  startTime?: string;
  endTime?: string;
};

export type AbsenceRegisterValidationError = {
  reason:
    | "past_date"
    | "invalid_range"
    | "invalid_time"
    | "invalid_time_order"
    | "missing_notify_target"
    | "inactive_user";
  blockId:
    | "start_block"
    | "end_block"
    | "start_time_block"
    | "end_time_block"
    | "channels_block"
    | "users_block";
};

export const REGISTRATION_NOTIFY_SELECT_OPTIONS: Array<{
  value: RegistrationNotifyMode;
  label: string;
}> = [
  { value: "none", label: "通知しない" },
  { value: "ch", label: "チャンネルのみ" },
  { value: "dm", label: "DM のみ" },
  { value: "both", label: "チャンネル + DM" }
];

export const parseRegistrationNotifyMode = (value: string | undefined): RegistrationNotifyMode => {
  if (value === "ch" || value === "dm" || value === "both") return value;
  return "none";
};

export const formatRegistrationNotifyModeLabel = (mode: RegistrationNotifyMode): string => {
  const found = REGISTRATION_NOTIFY_SELECT_OPTIONS.find((option) => option.value === mode);
  return found?.label ?? mode;
};

export const resolveAbsenceEndDate = (startDate: string, endDate: string): string =>
  endDate.length > 0 ? endDate : startDate;

export const normalizeStoredClockTime = (value: string | null | undefined): string | undefined => {
  if (!value) return undefined;
  return CLOCK_TIME_PATTERN.test(value) ? value : undefined;
};

export const formatDayClockLabel = (params: {
  day: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
}): string | undefined => {
  const isStartDay = params.day === params.startDate;
  const isEndDay = params.day === params.endDate;
  if (!isStartDay && !isEndDay) return undefined;
  if (isStartDay && isEndDay) {
    if (params.startTime && params.endTime) return `${params.startTime}–${params.endTime}`;
    if (params.startTime) return `${params.startTime}から`;
    if (params.endTime) return `${params.endTime}まで`;
    return undefined;
  }
  if (isStartDay && params.startTime) return `${params.startTime}から`;
  if (isEndDay && params.endTime) return `${params.endTime}まで`;
  return undefined;
};

export const formatAttendancePeriod = (
  startDate: string,
  endDate: string,
  times?: AbsenceTimeFields
): string => {
  const startTime = times?.startTime;
  const endTime = times?.endTime;
  if (startDate === endDate) {
    if (startTime && endTime) return `${startDate} ${startTime}–${endTime}`;
    if (startTime) return `${startDate} ${startTime}から`;
    if (endTime) return `${startDate} ${endTime}まで`;
    return startDate;
  }
  const startLabel = startTime ? `${startDate} ${startTime}から` : startDate;
  const endLabel = endTime ? `${endDate} ${endTime}まで` : endDate;
  return `${startLabel} 〜 ${endLabel}`;
};

const validateClockFields = (input: {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
}):
  | { reason: "invalid_time" | "invalid_time_order"; blockId: "start_time_block" | "end_time_block" }
  | undefined => {
  const startTime = input.startTime?.trim() ?? "";
  const endTime = input.endTime?.trim() ?? "";
  if (startTime && !CLOCK_TIME_PATTERN.test(startTime)) {
    return { reason: "invalid_time", blockId: "start_time_block" };
  }
  if (endTime && !CLOCK_TIME_PATTERN.test(endTime)) {
    return { reason: "invalid_time", blockId: "end_time_block" };
  }
  const endDate = resolveAbsenceEndDate(input.startDate, input.endDate);
  if (input.startDate !== endDate || (!startTime && !endTime)) return undefined;
  // 空の開始は 00:00。空の終了は日の終わり。23:59 にすると入力した 23:59 と区間が潰れる。保存や表示には使わない。
  const intervalStart = startTime || "00:00";
  const intervalEnd = endTime || "24:00";
  if (intervalStart >= intervalEnd) {
    return { reason: "invalid_time_order", blockId: "end_time_block" };
  }
  return undefined;
};

export const escapeSlackMrkdwnText = (text: string): string =>
  text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*/g, "＊")
    .replace(/_/g, "＿")
    .replace(/~/g, "～")
    .replace(/`/g, "｀");

export const formatAttendanceNoticeLine = (
  targetUser: string,
  noteText?: string,
  clockLabel?: string
): string => {
  const parts = [clockLabel, noteText].filter((part): part is string => !!part && part.length > 0);
  const suffix = parts.length > 0 ? ` ${parts.map((part) => escapeSlackMrkdwnText(part)).join(" ")}` : "";
  return `• <@${targetUser}>${suffix}`;
};

export const validateAbsenceRegistration = (input: {
  startDate: string;
  endDate: string;
  todayJst: string;
  notifyMode: RegistrationNotifyMode;
  channels: string[];
  users: string[];
  active: boolean;
  startTime?: string;
  endTime?: string;
}): AbsenceRegisterValidationError | undefined => {
  if (!input.active) {
    return { reason: "inactive_user", blockId: "start_block" };
  }
  const endDate = resolveAbsenceEndDate(input.startDate, input.endDate);
  if (input.startDate < input.todayJst) {
    return { reason: "past_date", blockId: "start_block" };
  }
  if (endDate < input.todayJst) {
    return { reason: "past_date", blockId: "end_block" };
  }
  if (input.startDate > endDate) {
    return { reason: "invalid_range", blockId: "end_block" };
  }
  const clockError = validateClockFields(input);
  if (clockError) return clockError;
  if (input.notifyMode === "ch" && input.channels.length === 0) {
    return { reason: "missing_notify_target", blockId: "channels_block" };
  }
  if (input.notifyMode === "dm" && input.users.length === 0) {
    return { reason: "missing_notify_target", blockId: "users_block" };
  }
  if (input.notifyMode === "both" && input.channels.length === 0 && input.users.length === 0) {
    return { reason: "missing_notify_target", blockId: "channels_block" };
  }
  if (input.notifyMode === "none" && input.channels.length === 0 && input.users.length === 0) {
    return { reason: "missing_notify_target", blockId: "channels_block" };
  }
  return undefined;
};

export const resolveRegistrationNotifyMode = (
  startDate: string,
  endDate: string,
  todayJst: string,
  now: Date,
  selected: RegistrationNotifyMode
): RegistrationNotifyMode => {
  const isToday = startDate <= todayJst && todayJst <= endDate;
  if (!isToday) return selected;
  const { hour } = getJstDateParts(now);
  if (hour < DAILY_NOTIFY_HOUR_JST) return selected;
  return "both";
};

export const resolveNotifyTargets = (
  mode: RegistrationNotifyMode,
  channels: string[],
  users: string[]
): { sendChannels: boolean; sendUsers: boolean } => {
  if (mode === "none") {
    return { sendChannels: false, sendUsers: false };
  }
  const hasChannels = channels.length > 0;
  const hasUsers = users.length > 0;
  if (mode === "ch") {
    return { sendChannels: hasChannels, sendUsers: false };
  }
  if (mode === "dm") {
    return { sendChannels: false, sendUsers: hasUsers };
  }
  return { sendChannels: hasChannels, sendUsers: hasUsers };
};

export const buildRegistrationNotifyMessage = (params: {
  targetUser: string;
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  note?: string;
}): string => {
  const period = formatAttendancePeriod(params.startDate, params.endDate, {
    startTime: params.startTime,
    endTime: params.endTime
  });
  const noteText = params.note?.trim();
  const detail = noteText ? `${period} — ${noteText}` : period;
  return formatAttendanceNoticeLine(params.targetUser, detail);
};

export const buildRegistrationSuccessEphemeral = (params: {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  selectedMode: RegistrationNotifyMode;
  resolvedMode: RegistrationNotifyMode;
}): string => {
  const period = formatAttendancePeriod(params.startDate, params.endDate, {
    startTime: params.startTime,
    endTime: params.endTime
  });
  const lines = [`不在予定を登録しました（${period}）。`];
  if (params.selectedMode === params.resolvedMode) {
    lines.push(`登録通知: ${formatRegistrationNotifyModeLabel(params.resolvedMode)}`);
  } else {
    lines.push(
      `登録通知: ${formatRegistrationNotifyModeLabel(params.selectedMode)} → ${formatRegistrationNotifyModeLabel(params.resolvedMode)}（当日ルール適用）`
    );
  }
  return lines.join("\n");
};

export type AbsenceEditValidationError = {
  reason:
    | "past_end_date"
    | "past_start_change"
    | "invalid_range"
    | "invalid_time"
    | "invalid_time_order"
    | "missing_notify_target"
    | "inactive_user";
  blockId:
    | "start_block"
    | "end_block"
    | "start_time_block"
    | "end_time_block"
    | "channels_block"
    | "users_block";
};

export const formatAbsenceListLine = (record: {
  startDate: string;
  endDate: string;
  startTime?: string;
  endTime?: string;
  note?: string;
}): string => {
  const period = formatAttendancePeriod(record.startDate, record.endDate, {
    startTime: record.startTime,
    endTime: record.endTime
  });
  const noteText = record.note?.trim();
  return noteText ? `${period} — ${noteText}` : period;
};

export const validateAbsenceEdit = (input: {
  startDate: string;
  endDate: string;
  todayJst: string;
  channels: string[];
  users: string[];
  active: boolean;
  originalStartDate: string;
  startTime?: string;
  endTime?: string;
}): AbsenceEditValidationError | undefined => {
  if (!input.active) {
    return { reason: "inactive_user", blockId: "start_block" };
  }
  const endDate = resolveAbsenceEndDate(input.startDate, input.endDate);
  if (endDate < input.todayJst) {
    return { reason: "past_end_date", blockId: "end_block" };
  }
  if (input.startDate > endDate) {
    return { reason: "invalid_range", blockId: "end_block" };
  }
  if (input.startDate < input.todayJst && input.startDate !== input.originalStartDate) {
    return { reason: "past_start_change", blockId: "start_block" };
  }
  const clockError = validateClockFields(input);
  if (clockError) return clockError;
  if (input.channels.length === 0 && input.users.length === 0) {
    return { reason: "missing_notify_target", blockId: "channels_block" };
  }
  return undefined;
};
