import { addJstDays, isValidJstDateString } from "./jst-date";

export const ABSENCE_RANGE_MAX_INCLUSIVE_DAYS = 92;
export const SLACK_CHANNEL_ID_PATTERN = /^C[A-Z0-9]+$/i;

export type AbsenceRangeValidationError =
  | "invalid_from"
  | "invalid_to"
  | "from_before_today"
  | "from_after_to"
  | "range_too_long";

export type AbsenceCalendarPageQuery = {
  userId: string;
  from: string;
  to: string;
  channelId: string;
  page: number;
};

export const isSlackChannelId = (value: string): boolean => SLACK_CHANNEL_ID_PATTERN.test(value);

export const inclusiveJstDaySpan = (from: string, to: string): number => {
  if (!isValidJstDateString(from) || !isValidJstDateString(to) || from > to) return 0;
  let count = 0;
  let cursor = from;
  while (cursor <= to) {
    count += 1;
    if (cursor === to) break;
    cursor = addJstDays(cursor, 1);
  }
  return count;
};

export const validateAbsenceRange = (
  from: string,
  to: string,
  todayJst: string
): { ok: true } | { ok: false; error: AbsenceRangeValidationError } => {
  if (!isValidJstDateString(from)) return { ok: false, error: "invalid_from" };
  if (!isValidJstDateString(to)) return { ok: false, error: "invalid_to" };
  if (from < todayJst) return { ok: false, error: "from_before_today" };
  if (from > to) return { ok: false, error: "from_after_to" };
  if (inclusiveJstDaySpan(from, to) > ABSENCE_RANGE_MAX_INCLUSIVE_DAYS) {
    return { ok: false, error: "range_too_long" };
  }
  return { ok: true };
};

export const encodeAbsenceCalendarPageValue = (query: AbsenceCalendarPageQuery): string =>
  JSON.stringify(query);

const parseAbsenceCalendarPageNumber = (value: unknown): number | undefined => {
  if (typeof value === "number" && Number.isFinite(value)) {
    return Math.trunc(value);
  }
  if (typeof value === "string") {
    const parsed = Number.parseInt(value, 10);
    if (Number.isFinite(parsed)) return parsed;
  }
  return undefined;
};

export const decodeAbsenceCalendarPageValue = (raw: string): AbsenceCalendarPageQuery | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<AbsenceCalendarPageQuery> & { page?: unknown };
    const page = parseAbsenceCalendarPageNumber(parsed.page);
    if (
      typeof parsed.userId !== "string" ||
      typeof parsed.from !== "string" ||
      typeof parsed.to !== "string" ||
      typeof parsed.channelId !== "string" ||
      page === undefined ||
      page < 1
    ) {
      return undefined;
    }
    if (!parsed.userId) return undefined;
    return {
      userId: parsed.userId,
      from: parsed.from,
      to: parsed.to,
      channelId: parsed.channelId,
      page
    };
  } catch {
    return undefined;
  }
};

export const validateAbsenceCalendarPageTurn = (
  from: string,
  to: string
): { ok: true } | { ok: false; error: AbsenceRangeValidationError } => {
  if (!isValidJstDateString(from)) return { ok: false, error: "invalid_from" };
  if (!isValidJstDateString(to)) return { ok: false, error: "invalid_to" };
  if (from > to) return { ok: false, error: "from_after_to" };
  if (inclusiveJstDaySpan(from, to) > ABSENCE_RANGE_MAX_INCLUSIVE_DAYS) {
    return { ok: false, error: "range_too_long" };
  }
  return { ok: true };
};

export const formatAbsenceRangeValidationError = (error: AbsenceRangeValidationError): string => {
  switch (error) {
    case "invalid_from":
    case "invalid_to":
      return "日付の形式が正しくありません（YYYY-MM-DD）。";
    case "from_before_today":
      return "開始日は今日以降を指定してください。";
    case "from_after_to":
      return "終了日は開始日以降を指定してください。";
    case "range_too_long":
      return `期間は最大 ${ABSENCE_RANGE_MAX_INCLUSIVE_DAYS} 日までです。`;
  }
};
