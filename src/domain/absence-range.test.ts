import { describe, expect, it } from "vitest";
import {
  decodeAbsenceCalendarPageValue,
  encodeAbsenceCalendarPageValue,
  inclusiveJstDaySpan,
  isSlackChannelId,
  validateAbsenceRange
} from "./absence-range";

describe("absence-range", () => {
  it("validates inclusive day span", () => {
    expect(inclusiveJstDaySpan("2026-08-01", "2026-08-01")).toBe(1);
    expect(inclusiveJstDaySpan("2026-08-01", "2026-08-03")).toBe(3);
  });

  it("rejects from before today", () => {
    expect(validateAbsenceRange("2026-08-01", "2026-08-10", "2026-08-05")).toEqual({
      ok: false,
      error: "from_before_today"
    });
  });

  it("rejects from after to", () => {
    expect(validateAbsenceRange("2026-08-10", "2026-08-05", "2026-08-01")).toEqual({
      ok: false,
      error: "from_after_to"
    });
  });

  it("rejects ranges longer than max days", () => {
    const from = "2026-08-01";
    expect(validateAbsenceRange(from, "2026-11-30", from)).toEqual({ ok: false, error: "range_too_long" });
    expect(validateAbsenceRange(from, "2026-10-31", from).ok).toBe(true);
  });

  it("validates slack channel ids", () => {
    expect(isSlackChannelId("C123ABC")).toBe(true);
    expect(isSlackChannelId("D123ABC")).toBe(false);
    expect(isSlackChannelId("C12/34")).toBe(false);
  });

  it("round-trips page query value", () => {
    const encoded = encodeAbsenceCalendarPageValue({
      userId: "U1",
      from: "2026-08-01",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 2
    });
    expect(decodeAbsenceCalendarPageValue(encoded)).toEqual({
      userId: "U1",
      from: "2026-08-01",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 2
    });
    expect(decodeAbsenceCalendarPageValue("not-json")).toBeUndefined();
  });
});
