import { describe, expect, it } from "vitest";
import {
  buildRegistrationNotifyMessage,
  DAILY_NOTIFY_HOUR_JST,
  formatAttendanceNoticeLine,
  formatAttendancePeriod,
  formatDayClockLabel,
  resolveAbsenceEndDate,
  resolveNotifyTargets,
  resolveRegistrationNotifyMode,
  validateAbsenceRegistration,
  validateAbsenceEdit
} from "./absence-registration";

describe("absence-registration", () => {
  it("formatAttendanceNoticeLine omits default type and shows note only", () => {
    expect(formatAttendanceNoticeLine("U1")).toBe("• <@U1>");
    expect(formatAttendanceNoticeLine("U1", "通院のため午後から")).toBe("• <@U1> 通院のため午後から");
  });

  it("formatAttendanceNoticeLine escapes mrkdwn in notes", () => {
    expect(formatAttendanceNoticeLine("U1", "<script> & >")).toBe(
      "• <@U1> &lt;script&gt; &amp; &gt;"
    );
    expect(formatAttendanceNoticeLine("U1", "*bold* _italic_")).toBe(
      "• <@U1> ＊bold＊ ＿italic＿"
    );
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

  it("formatAttendancePeriod attaches only the times that were entered", () => {
    expect(
      formatAttendancePeriod("2026-10-30", "2026-10-30", { startTime: "13:00", endTime: "16:00" })
    ).toBe("2026-10-30 13:00–16:00");
    expect(formatAttendancePeriod("2026-10-30", "2026-10-30", { startTime: "18:00" })).toBe(
      "2026-10-30 18:00から"
    );
    expect(formatAttendancePeriod("2026-10-30", "2026-11-02", { startTime: "18:00", endTime: "13:00" })).toBe(
      "2026-10-30 18:00から 〜 2026-11-02 13:00まで"
    );
    expect(formatAttendancePeriod("2026-10-30", "2026-11-02", { endTime: "13:00" })).toBe(
      "2026-10-30 〜 2026-11-02 13:00まで"
    );
  });

  it("formatDayClockLabel shows the end time only on the end day", () => {
    const times = { startDate: "2026-10-30", endDate: "2026-11-02", startTime: "18:00", endTime: "13:00" };
    expect(formatDayClockLabel({ day: "2026-10-30", ...times })).toBe("18:00から");
    expect(formatDayClockLabel({ day: "2026-10-31", ...times })).toBeUndefined();
    expect(formatDayClockLabel({ day: "2026-11-02", ...times })).toBe("13:00まで");
    expect(
      formatDayClockLabel({
        day: "2026-10-30",
        startDate: "2026-10-30",
        endDate: "2026-10-30",
        startTime: "13:00",
        endTime: "16:00"
      })
    ).toBe("13:00–16:00");
    expect(
      formatAttendanceNoticeLine("U1", "通院", "18:00から")
    ).toBe("• <@U1> 18:00から 通院");
  });

  it("validateAbsenceRegistration rejects a same-day range whose start time is not before the end", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-10-30",
      endDate: "2026-10-30",
      todayJst: "2026-10-30",
      notifyMode: "none",
      channels: ["C1"],
      users: [],
      active: true,
      startTime: "18:00",
      endTime: "13:00"
    });
    expect(error).toEqual({ reason: "invalid_time_order", blockId: "end_time_block" });
  });

  it("validateAbsenceRegistration rejects a same-day end time of midnight when the start is empty", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-10-30",
      endDate: "2026-10-30",
      todayJst: "2026-10-30",
      notifyMode: "none",
      channels: ["C1"],
      users: [],
      active: true,
      endTime: "00:00"
    });
    expect(error).toEqual({ reason: "invalid_time_order", blockId: "end_time_block" });
  });

  it("validateAbsenceRegistration allows a start time of 23:59 through the end of that day", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-10-30",
      endDate: "2026-10-30",
      todayJst: "2026-10-30",
      notifyMode: "none",
      channels: ["C1"],
      users: [],
      active: true,
      startTime: "23:59"
    });
    expect(error).toBeUndefined();
  });

  it("validateAbsenceRegistration allows midnight at the start of the next day", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-10-30",
      endDate: "2026-10-31",
      todayJst: "2026-10-30",
      notifyMode: "none",
      channels: ["C1"],
      users: [],
      active: true,
      endTime: "00:00"
    });
    expect(error).toBeUndefined();
  });

  it("validateAbsenceRegistration allows a start time that continues onto the next day", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-10-30",
      endDate: "2026-10-31",
      todayJst: "2026-10-30",
      notifyMode: "none",
      channels: ["C1"],
      users: [],
      active: true,
      startTime: "18:00",
      endTime: "13:00"
    });
    expect(error).toBeUndefined();
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
      channels: ["C1"],
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

  it("validateAbsenceRegistration requires notify target for none mode", () => {
    const error = validateAbsenceRegistration({
      startDate: "2026-06-20",
      endDate: "2026-06-21",
      todayJst: "2026-06-15",
      notifyMode: "none",
      channels: [],
      users: [],
      active: true
    });
    expect(error).toEqual({ reason: "missing_notify_target", blockId: "channels_block" });
  });

  it("validateAbsenceRegistration allows none mode with channel or user", () => {
    expect(
      validateAbsenceRegistration({
        startDate: "2026-06-20",
        endDate: "2026-06-21",
        todayJst: "2026-06-15",
        notifyMode: "none",
        channels: ["C1"],
        users: [],
        active: true
      })
    ).toBeUndefined();
    expect(
      validateAbsenceRegistration({
        startDate: "2026-06-20",
        endDate: "2026-06-21",
        todayJst: "2026-06-15",
        notifyMode: "none",
        channels: [],
        users: ["U1"],
        active: true
      })
    ).toBeUndefined();
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

describe("validateAbsenceEdit", () => {
  const base = {
    startDate: "2026-06-10",
    endDate: "2026-06-12",
    todayJst: "2026-06-10",
    channels: ["C1"],
    users: [] as string[],
    active: true,
    originalStartDate: "2026-06-10"
  };

  it("allows ongoing absence with past original start date", () => {
    expect(
      validateAbsenceEdit({
        ...base,
        startDate: "2026-06-08",
        originalStartDate: "2026-06-08"
      })
    ).toBeUndefined();
  });

  it("rejects changing start date into the past", () => {
    expect(
      validateAbsenceEdit({
        ...base,
        startDate: "2026-06-09",
        originalStartDate: "2026-06-10"
      })?.reason
    ).toBe("past_start_change");
  });

  it("requires notify channels or users", () => {
    expect(
      validateAbsenceEdit({
        ...base,
        channels: [],
        users: []
      })?.reason
    ).toBe("missing_notify_target");
  });
});
