import { describe, expect, it } from "vitest";
import {
  assertJpHolidayCoverageFresh,
  getJpHolidayCoverage,
  getJpHolidayDataStatus,
  getScheduledSkipReason,
  isJpHoliday,
  isScheduledBusinessDayInJst
} from "./jp-holidays";
import { getJstDateParts } from "./jst-date";

describe("jp-holidays", () => {
  it("detects known holidays", () => {
    expect(isJpHoliday("2026-01-01")).toBe(true);
    expect(isJpHoliday("2026-05-06")).toBe(true);
    expect(isJpHoliday("2026-06-24")).toBe(false);
  });

  it("marks dates outside coverage as stale", () => {
    expect(getJpHolidayDataStatus("2029-01-01")).toBe("stale");
    expect(isJpHoliday("2029-01-01")).toBe(false);
    expect(isScheduledBusinessDayInJst(new Date("2029-01-02T00:30:00.000Z"))).toBe(false);
  });

  it("prioritizes weekend over holiday", () => {
    const saturday = new Date("2026-01-03T00:30:00.000Z");
    expect(getScheduledSkipReason("scheduled", saturday)).toBe("weekend");
  });

  it("returns holiday skip reason on weekday holidays", () => {
    const greeneryDay = new Date("2026-05-04T00:30:00.000Z");
    expect(getScheduledSkipReason("scheduled", greeneryDay)).toBe("holiday");
    expect(isScheduledBusinessDayInJst(greeneryDay)).toBe(false);
  });

  it("does not skip manual runs on holidays", () => {
    const greeneryDay = new Date("2026-05-04T00:30:00.000Z");
    expect(getScheduledSkipReason("manual", greeneryDay)).toBeUndefined();
  });

  it("keeps coverage fresh for at least 90 days ahead", () => {
    const { day: todayJst } = getJstDateParts();
    expect(() => assertJpHolidayCoverageFresh(todayJst)).not.toThrow();
  });

  it("treats dates beyond coverage.to as data_stale on weekdays", () => {
    const { to } = getJpHolidayCoverage();
    expect(getJpHolidayDataStatus(to)).toBe("ok");
    const staleDay = "2029-01-02";
    expect(getJpHolidayDataStatus(staleDay)).toBe("stale");
    expect(getScheduledSkipReason("scheduled", new Date("2029-01-02T00:30:00.000Z"))).toBe("data_stale");
  });
});
