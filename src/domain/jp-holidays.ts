import holidays from "../data/jp-holidays.json";
import { addJstDays, getJstDateParts, isWeekdayInJst } from "./jst-date";

export type JpHolidayDataStatus = "ok" | "stale";
export type ScheduledSkipReason = "weekend" | "holiday" | "data_stale";

const holidayDates = new Set(holidays.dates);

export const getJpHolidayCoverage = (): { from: string; to: string } => holidays.coverage;

export const getJpHolidayDataStatus = (dayJst: string): JpHolidayDataStatus => {
  if (dayJst < holidays.coverage.from || dayJst > holidays.coverage.to) {
    return "stale";
  }
  return "ok";
};

export const isJpHoliday = (dayJst: string): boolean => {
  if (getJpHolidayDataStatus(dayJst) !== "ok") return false;
  return holidayDates.has(dayJst);
};

export const getScheduledSkipReason = (
  trigger: "manual" | "scheduled",
  now = new Date()
): ScheduledSkipReason | undefined => {
  if (trigger !== "scheduled") return undefined;
  if (!isWeekdayInJst(now)) return "weekend";
  const { day } = getJstDateParts(now);
  if (getJpHolidayDataStatus(day) === "stale") return "data_stale";
  if (isJpHoliday(day)) return "holiday";
  return undefined;
};

export const isScheduledBusinessDayInJst = (now = new Date()): boolean =>
  getScheduledSkipReason("scheduled", now) === undefined;

export const assertJpHolidayCoverageFresh = (todayJst: string): void => {
  const minimumCoverageTo = addJstDays(todayJst, 90);
  if (holidays.coverage.to < minimumCoverageTo) {
    throw new Error(
      `jp_holidays_stale: coverage.to ${holidays.coverage.to} is before ${minimumCoverageTo}`
    );
  }
};
