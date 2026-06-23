import { describe, expect, it } from "vitest";
import {
  buildRegistrationNotifyMessage,
  DAILY_NOTIFY_HOUR_JST,
  formatAttendanceNoticeLine,
  formatAttendancePeriod,
  resolveAbsenceEndDate,
  resolveNotifyTargets,
  resolveRegistrationNotifyMode,
  validateAbsenceRegistration
} from "./absence-registration";

describe("absence-registration", () => {
  it("formatAttendanceNoticeLine omits default type and shows note only", () => {
    expect(formatAttendanceNoticeLine("U1")).toBe("• <@U1>");
    expect(formatAttendanceNoticeLine("U1", "通院のため午後から")).toBe("• <@U1> 通院のため午後から");
  });

  it("buildRegistrationNotifyMessage includes period and optional note", () => {
    expect(
      buildRegistrationNotifyMessage({
        targetUser: "U1",
        startDate: "2026-06-20",
        endDate: "2026-06-20",
        note: "通院のため午後から"
      })
    ).toBe("• <@U1> 2026-06-20 — 通院のため午後から");
    expect(
      buildRegistrationNotifyMessage({
        targetUser: "U1",
        startDate: "2026-06-20",
        endDate: "2026-06-25"
      })
    ).toBe("• <@U1> 2026-06-20 〜 2026-06-25");
  });

  it("formatAttendancePeriod formats single day and range", () => {
    expect(formatAttendancePeriod("2026-06-20", "2026-06-20")).toBe("2026-06-20");
    expect(formatAttendancePeriod("2026-06-20", "2026-06-25")).toBe("2026-06-20 〜 2026-06-25");
  });

  it("resolveAbsenceEndDate falls back to start date when end is empty", () => {
    expect(resolveAbsenceEndDate("2026-06-20", "")).toBe("2026-06-20");
    expect(resolveAbsenceEndDate("2026-06-20", "2026-06-25")).toBe("2026-06-25");
  });

  it("validateAbsenceRegistration allows empty end date", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-06-20",
      endDate: "",
      todayJst: "2026-06-15",
      notifyMode: "none",
      channels: [],
      users: [],
      active: true
    });
    expect(error).toBeUndefined();
  });

  it("validateAbsenceRegistration rejects past start date", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      todayJst: "2026-06-15",
      notifyMode: "none",
      channels: [],
      users: [],
      active: true
    });
    expect(error).toEqual({ reason: "past_date", blockId: "start_block" });
  });

  it("validateAbsenceRegistration requires channel for ch mode", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-06-20",
      endDate: "2026-06-21",
      todayJst: "2026-06-15",
      notifyMode: "ch",
      channels: [],
      users: ["U1"],
      active: true
    });
    expect(error).toEqual({ reason: "missing_notify_target", blockId: "channels_block" });
  });

  it("validateAbsenceRegistration allows both with one side", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-06-20",
      endDate: "2026-06-21",
      todayJst: "2026-06-15",
      notifyMode: "both",
      channels: ["C1"],
      users: [],
      active: true
    });
    expect(error).toBeUndefined();
  });

  it("resolveRegistrationNotifyMode keeps selected before daily on today", () => {
    const now = new Date("2026-06-15T08:30:00+09:00");
    expect(
      resolveRegistrationNotifyMode("2026-06-15", "2026-06-15", "2026-06-15", now, "none")
    ).toBe("none");
    expect(DAILY_NOTIFY_HOUR_JST).toBe(9);
  });

  it("resolveRegistrationNotifyMode escalates to both after daily on today", () => {
    const now = new Date("2026-06-15T10:00:00+09:00");
    expect(
      resolveRegistrationNotifyMode("2026-06-15", "2026-06-15", "2026-06-15", now, "none")
    ).toBe("both");
  });

  it("resolveRegistrationNotifyMode keeps future selected", () => {
    const now = new Date("2026-06-15T10:00:00+09:00");
    expect(
      resolveRegistrationNotifyMode("2026-06-20", "2026-06-21", "2026-06-15", now, "ch")
    ).toBe("ch");
  });

  it("resolveNotifyTargets degrades both to configured sides", () => {
    expect(resolveNotifyTargets("both", ["C1"], [])).toEqual({
      sendChannels: true,
      sendUsers: false
    });
    expect(resolveNotifyTargets("both", [], ["U1"])).toEqual({
      sendChannels: false,
      sendUsers: true
    });
    expect(resolveNotifyTargets("both", [], [])).toEqual({
      sendChannels: false,
      sendUsers: false
    });
  });
});
