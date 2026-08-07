import { describe, expect, it } from "vitest";
import {
  decodeAbsenceCalendarPageValue,
  encodeAbsenceCalendarPageValue,
  inclusiveJstDaySpan,
  isSlackChannelId,
  isSlackDeliverChannelId,
  resolveSlackDeliverChannelId,
  SLACK_BUTTON_VALUE_MAX,
  validateAbsenceCalendarPageTurn,
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

  it("allows page turns without re-checking from_before_today", () => {
    expect(validateAbsenceCalendarPageTurn("2026-08-01", "2026-08-10")).toEqual({ ok: true });
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

  it("validates deliver channel ids for channel and DM", () => {
    expect(isSlackDeliverChannelId("C123ABC")).toBe(true);
    expect(isSlackDeliverChannelId("D123ABC")).toBe(true);
    expect(isSlackDeliverChannelId("U123ABC")).toBe(false);
    expect(isSlackDeliverChannelId("")).toBe(false);
    expect(isSlackDeliverChannelId(undefined)).toBe(false);
  });

  it("resolves the first valid deliver channel id", () => {
    expect(resolveSlackDeliverChannelId(undefined, "bad", "C1", "D2")).toBe("C1");
    expect(resolveSlackDeliverChannelId("D01234567")).toBe("D01234567");
    expect(resolveSlackDeliverChannelId("bad", "")).toBeUndefined();
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

  it("decodes string page numbers", () => {
    expect(
      decodeAbsenceCalendarPageValue(
        JSON.stringify({
          userId: "U1",
          from: "2026-08-05",
          to: "2026-08-31",
          channelId: "CNOTIFY",
          page: "2"
        })
      )
    ).toEqual({
      userId: "U1",
      from: "2026-08-05",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 2
    });
  });

  it("round-trips deliver channel id for DM fallback", () => {
    const encoded = encodeAbsenceCalendarPageValue({
      userId: "U1",
      from: "2026-08-01",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      deliverChannelId: "D01234567",
      page: 2
    });
    expect(decodeAbsenceCalendarPageValue(encoded)?.deliverChannelId).toBe("D01234567");
  });

  it("drops invalid deliver channel ids from encoded value", () => {
    const encoded = encodeAbsenceCalendarPageValue({
      userId: "U1",
      from: "2026-08-01",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      deliverChannelId: "not-a-channel",
      page: 2
    });
    expect(encoded).not.toContain("not-a-channel");
    expect(decodeAbsenceCalendarPageValue(encoded)?.deliverChannelId).toBeUndefined();
  });

  it("drops deliver channel id when button value exceeds Slack max", () => {
    const encoded = encodeAbsenceCalendarPageValue({
      userId: "U".repeat(1910),
      from: "2026-08-01",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      deliverChannelId: "C012RUN",
      page: 2
    });
    expect(encoded.length).toBeLessThanOrEqual(SLACK_BUTTON_VALUE_MAX);
    expect(encoded).not.toContain("deliverChannelId");
    expect(decodeAbsenceCalendarPageValue(encoded)?.deliverChannelId).toBeUndefined();
  });
});
