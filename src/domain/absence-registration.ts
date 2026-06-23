import { getJstDateParts } from "./jst-date";

export const REGISTRATION_NOTIFY_MODES = ["none", "ch", "dm", "both"] as const;
export type RegistrationNotifyMode = (typeof REGISTRATION_NOTIFY_MODES)[number];

export const DAILY_NOTIFY_HOUR_JST = 9;

export type AbsenceRegisterValidationError = {
  reason: "past_date" | "invalid_range" | "missing_notify_target" | "inactive_user";
  blockId: "start_block" | "end_block" | "channels_block" | "users_block";
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

export const formatAttendancePeriod = (startDate: string, endDate: string): string =>
  startDate === endDate ? startDate : `${startDate} 〜 ${endDate}`;

export const formatAttendanceNoticeLine = (targetUser: string, noteText?: string): string => {
  const suffix = noteText && noteText.length > 0 ? ` ${noteText}` : "";
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
  if (input.notifyMode === "ch" && input.channels.length === 0) {
    return { reason: "missing_notify_target", blockId: "channels_block" };
  }
  if (input.notifyMode === "dm" && input.users.length === 0) {
    return { reason: "missing_notify_target", blockId: "users_block" };
  }
  if (input.notifyMode === "both" && input.channels.length === 0 && input.users.length === 0) {
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
  note?: string;
}): string => {
  const period = formatAttendancePeriod(params.startDate, params.endDate);
  const noteText = params.note?.trim();
  const detail = noteText ? `${period} — ${noteText}` : period;
  return formatAttendanceNoticeLine(params.targetUser, detail);
};

export const buildRegistrationSuccessEphemeral = (params: {
  startDate: string;
  endDate: string;
  selectedMode: RegistrationNotifyMode;
  resolvedMode: RegistrationNotifyMode;
}): string => {
  const period =
    params.startDate === params.endDate
      ? params.startDate
      : `${params.startDate} 〜 ${params.endDate}`;
  const lines = [`不在を登録しました（${period}）。`];
  if (params.selectedMode === params.resolvedMode) {
    lines.push(`登録通知: ${formatRegistrationNotifyModeLabel(params.resolvedMode)}`);
  } else {
    lines.push(
      `登録通知: ${formatRegistrationNotifyModeLabel(params.selectedMode)} → ${formatRegistrationNotifyModeLabel(params.resolvedMode)}（当日ルール適用）`
    );
  }
  return lines.join("\n");
};
