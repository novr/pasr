import { addJstDays, isValidJstDateString } from "../jst-date";
import type { InferredMentionDateRange } from "./types";
import { stripAppMentionText } from "./text";

/** 労働基準法の「1週間」（日曜始まり）における曜日オフセット */
const JP_WEEKDAY_OFFSET_FROM_SUNDAY: Record<string, number> = {
  日: 0,
  月: 1,
  火: 2,
  水: 3,
  木: 4,
  金: 5,
  土: 6
};

const resolveRelativeDay = (todayJst: string, keyword: string): string | undefined => {
  switch (keyword) {
    case "今日":
      return todayJst;
    case "明日":
      return addJstDays(todayJst, 1);
    case "明後日":
    case "あさって":
      return addJstDays(todayJst, 2);
    default:
      return undefined;
  }
};

const sundayOfWeekContaining = (dateStr: string): string => {
  const [year, month, day] = dateStr.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return addJstDays(dateStr, -weekday);
};

export const resolveJpWeekday = (
  todayJst: string,
  modifier: "今週" | "来週" | "翌週",
  weekday: string
): string | undefined => {
  const offset = JP_WEEKDAY_OFFSET_FROM_SUNDAY[weekday];
  if (offset === undefined) return undefined;
  let sunday = sundayOfWeekContaining(todayJst);
  if (modifier === "来週" || modifier === "翌週") {
    sunday = addJstDays(sunday, 7);
  }
  const resolved = addJstDays(sunday, offset);
  if (modifier === "今週" && resolved < todayJst) {
    return addJstDays(resolved, 7);
  }
  return resolved;
};

const formatMonthDay = (year: string, month: string, day: string): string => {
  const m = month.padStart(2, "0");
  const d = day.padStart(2, "0");
  return `${year}-${m}-${d}`;
};

const compareMonthDay = (leftMonth: number, leftDay: number, rightMonth: number, rightDay: number): number => {
  if (leftMonth !== rightMonth) return leftMonth - rightMonth;
  return leftDay - rightDay;
};

const JP_WEEKDAY_LABEL: Record<string, string> = {
  日: "日曜",
  月: "月曜",
  火: "火曜",
  水: "水曜",
  木: "木曜",
  金: "金曜",
  土: "土曜"
};

const formatWeekdayInterpretationHint = (
  modifier: "今週" | "来週" | "翌週",
  weekday: string,
  bumpedToNextWeek: boolean
): string => {
  const label = JP_WEEKDAY_LABEL[weekday] ?? `${weekday}曜`;
  if (modifier === "来週" || modifier === "翌週") {
    return `来週の${label}日で解釈しました`;
  }
  if (bumpedToNextWeek) {
    return `今週の${label}日（過ぎていたため翌週）で解釈しました`;
  }
  return `今週の${label}日で解釈しました`;
};

export const hasAmbiguousMentionDateExpressions = (userText: string): boolean => {
  const text = stripAppMentionText(userText);
  const mentionsRelativeDay = /(?:今日|明日|明後日|あさって)/.test(text);
  const mentionsWeekdayDate = /(今週|来週|翌週)(?:\s*|の)(月|火|水|木|金|土|日)曜?日?/.test(text);
  return mentionsRelativeDay && mentionsWeekdayDate;
};

const resolveMonthDayInFuture = (todayJst: string, month: string, day: string): string | undefined => {
  let year = Number(todayJst.slice(0, 4));
  let candidate = formatMonthDay(String(year), month, day);
  if (!isValidJstDateString(candidate)) return undefined;
  if (candidate < todayJst) {
    candidate = formatMonthDay(String(year + 1), month, day);
    if (!isValidJstDateString(candidate)) return undefined;
  }
  return candidate;
};

const resolveMonthDayRangeInFuture = (
  todayJst: string,
  startMonth: string,
  startDay: string,
  endMonth: string,
  endDay: string
): { startDate: string; endDate: string } | undefined => {
  const sm = Number(startMonth);
  const sd = Number(startDay);
  const em = Number(endMonth);
  const ed = Number(endDay);
  let startYear = Number(todayJst.slice(0, 4));
  let startDate = formatMonthDay(String(startYear), startMonth, startDay);
  if (!isValidJstDateString(startDate)) return undefined;
  if (startDate < todayJst) {
    startYear += 1;
    startDate = formatMonthDay(String(startYear), startMonth, startDay);
    if (!isValidJstDateString(startDate)) return undefined;
  }
  let endYear = compareMonthDay(sm, sd, em, ed) <= 0 ? startYear : startYear + 1;
  let endDate = formatMonthDay(String(endYear), endMonth, endDay);
  if (!isValidJstDateString(endDate)) return undefined;
  if (endDate < startDate) {
    endYear += 1;
    endDate = formatMonthDay(String(endYear), endMonth, endDay);
    if (!isValidJstDateString(endDate)) return undefined;
  }
  if (startDate > endDate) return undefined;
  return { startDate, endDate };
};

export const inferMentionDateRange = (
  userText: string,
  todayJst: string
): InferredMentionDateRange | undefined => {
  const text = stripAppMentionText(userText);

  if (hasAmbiguousMentionDateExpressions(text)) {
    return undefined;
  }

  const isoRange = text.match(/(\d{4}-\d{2}-\d{2})\s*から\s*(\d{4}-\d{2}-\d{2})\s*まで/);
  if (isoRange) {
    const startDate = isoRange[1];
    const endDate = isoRange[2];
    if (isValidJstDateString(startDate) && isValidJstDateString(endDate) && startDate <= endDate) {
      return { startDate, endDate, confidence: "high" };
    }
  }

  const slashRange = text.match(/(\d{1,2})\/(\d{1,2})\s*[〜～\-－]\s*(\d{1,2})\/(\d{1,2})/);
  if (slashRange) {
    const resolved = resolveMonthDayRangeInFuture(
      todayJst,
      slashRange[1],
      slashRange[2],
      slashRange[3],
      slashRange[4]
    );
    if (resolved) {
      return { ...resolved, confidence: "high" };
    }
  }

  const relativeSpan = text.match(/(今日|明日|明後日|あさって)\s*から\s*(\d+)\s*日間/);
  if (relativeSpan) {
    const startDate = resolveRelativeDay(todayJst, relativeSpan[1]);
    const spanDays = Number(relativeSpan[2]);
    if (startDate && spanDays >= 1) {
      return {
        startDate,
        endDate: addJstDays(startDate, spanDays - 1),
        confidence: "high",
        interpretationHint: `${relativeSpan[1]}から${spanDays}日間で解釈しました`
      };
    }
  }

  const hasSpecificWeekday = /(今週|来週|翌週)(?:\s*|の)(月|火|水|木|金|土|日)曜?日?/.test(text);
  if (text.match(/来週は/) && !hasSpecificWeekday) {
    const nextSunday = addJstDays(sundayOfWeekContaining(todayJst), 7);
    return {
      startDate: nextSunday,
      endDate: addJstDays(nextSunday, 6),
      confidence: "high",
      interpretationHint: "来週（日曜〜土曜）で解釈しました"
    };
  }

  const weekDay = text.match(/(今週|来週|翌週)(?:\s*|の)(月|火|水|木|金|土|日)曜?日?/);
  if (weekDay) {
    const modifier = weekDay[1] as "今週" | "来週" | "翌週";
    const weekday = weekDay[2];
    const offset = JP_WEEKDAY_OFFSET_FROM_SUNDAY[weekday];
    let sunday = sundayOfWeekContaining(todayJst);
    if (modifier === "来週" || modifier === "翌週") {
      sunday = addJstDays(sunday, 7);
    }
    const naiveResolved = offset !== undefined ? addJstDays(sunday, offset) : undefined;
    const bumpedToNextWeek =
      modifier === "今週" && naiveResolved !== undefined && naiveResolved < todayJst;
    const startDate = resolveJpWeekday(todayJst, modifier, weekday);
    if (startDate && isValidJstDateString(startDate)) {
      return {
        startDate,
        endDate: startDate,
        confidence: "high",
        interpretationHint: formatWeekdayInterpretationHint(modifier, weekday, bumpedToNextWeek)
      };
    }
  }

  const singleSlash = text.match(/(?:^|\s)(\d{1,2})\/(\d{1,2})(?:\s|$)/);
  if (singleSlash) {
    const year = Number(todayJst.slice(0, 4));
    const naiveCandidate = formatMonthDay(String(year), singleSlash[1], singleSlash[2]);
    const startDate = resolveMonthDayInFuture(todayJst, singleSlash[1], singleSlash[2]);
    if (startDate) {
      const rolledToNextYear = naiveCandidate < todayJst;
      return {
        startDate,
        endDate: startDate,
        confidence: "low",
        interpretationHint: rolledToNextYear
          ? `${singleSlash[1]}/${singleSlash[2]} を翌年として解釈しました`
          : undefined
      };
    }
  }

  const relativeSingle = text.match(/(?:^|\s)(今日|明日)(?:\s|$)/);
  if (relativeSingle) {
    const startDate = resolveRelativeDay(todayJst, relativeSingle[1]);
    if (startDate) {
      return {
        startDate,
        endDate: startDate,
        confidence: "high",
        interpretationHint: `${relativeSingle[1]}で解釈しました`
      };
    }
  }

  const relativeSingleLow = text.match(/(?:^|\s)(明後日|あさって)(?:\s|$)/);
  if (relativeSingleLow) {
    const startDate = resolveRelativeDay(todayJst, relativeSingleLow[1]);
    if (startDate) {
      return { startDate, endDate: startDate, confidence: "low" };
    }
  }

  return undefined;
};
