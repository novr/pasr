import { describe, expect, it } from "vitest";
import {
  filterEndedBefore,
  filterOwnFutureAbsences,
  filterToday,
  findOwnAbsenceByStartDate,
  groupByChannel,
  parseAbsence,
  type AbsenceRecord
} from "./absence";

const baseItem = {
  id: "item-1",
  fields: {
    target_user: "U001",
    start_date: "2026-06-01",
    end_date: "2026-06-10",
    notify_channels: ["C001", "C001"],
    notify_users: ["U002"]
  }
};

describe("parseAbsence", () => {
  it("parses valid record", () => {
    const result = parseAbsence(baseItem);
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.targetUser).toBe("U001");
    expect(result.record.notifyChannels).toEqual(["C001"]);
  });

  it("returns missing_target_user when target is empty", () => {
    const result = parseAbsence({ id: "x", fields: { start_date: "2026-06-01" } });
    expect(result).toEqual({ ok: false, itemId: "x", reason: "missing_target_user" });
  });

  it("returns missing_start_date when start date is empty", () => {
    const result = parseAbsence({ id: "x", fields: { target_user: "U001" } });
    expect(result).toEqual({ ok: false, itemId: "x", reason: "missing_start_date" });
  });

  it("returns invalid_date_range when start is after end", () => {
    const result = parseAbsence({
      id: "x",
      fields: { target_user: "U001", start_date: "2026-06-10", end_date: "2026-06-01" }
    });
    expect(result).toEqual({ ok: false, itemId: "x", reason: "invalid_date_range" });
  });

  it("falls back end_date to start_date when end is empty", () => {
    const result = parseAbsence({
      id: "x",
      fields: { target_user: "U001", start_date: "2026-06-05" }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.endDate).toBe("2026-06-05");
  });

  it("allows empty notify_channels", () => {
    const result = parseAbsence({
      id: "x",
      fields: { target_user: "U001", start_date: "2026-06-01", notify_channels: [] }
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.record.notifyChannels).toEqual([]);
  });
});

describe("filterToday", () => {
  const records: AbsenceRecord[] = [
    {
      itemId: "1",
      targetUser: "U1",
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      notifyChannels: [],
      notifyUsers: []
    },
    {
      itemId: "2",
      targetUser: "U2",
      startDate: "2026-06-20",
      endDate: "2026-06-30",
      notifyChannels: [],
      notifyUsers: []
    }
  ];

  it("includes records covering today", () => {
    expect(filterToday(records, "2026-06-05").map((r) => r.itemId)).toEqual(["1"]);
    expect(filterToday(records, "2026-06-10").map((r) => r.itemId)).toEqual(["1"]);
  });

  it("excludes records outside range", () => {
    expect(filterToday(records, "2026-06-15")).toEqual([]);
  });
});

describe("filterEndedBefore", () => {
  const records: AbsenceRecord[] = [
    {
      itemId: "1",
      targetUser: "U1",
      startDate: "2026-06-01",
      endDate: "2026-06-09",
      notifyChannels: [],
      notifyUsers: []
    },
    {
      itemId: "2",
      targetUser: "U2",
      startDate: "2026-06-10",
      endDate: "2026-06-10",
      notifyChannels: [],
      notifyUsers: []
    }
  ];

  it("returns records with end_date before today", () => {
    expect(filterEndedBefore(records, "2026-06-10").map((r) => r.itemId)).toEqual(["1"]);
    expect(filterEndedBefore(records, "2026-06-11").map((r) => r.itemId)).toEqual(["1", "2"]);
  });
});

describe("filterOwnFutureAbsences", () => {
  const records: AbsenceRecord[] = [
    {
      itemId: "2",
      targetUser: "U1",
      startDate: "2026-06-20",
      endDate: "2026-06-30",
      notifyChannels: [],
      notifyUsers: []
    },
    {
      itemId: "1",
      targetUser: "U1",
      startDate: "2026-06-10",
      endDate: "2026-06-15",
      notifyChannels: [],
      notifyUsers: []
    },
    {
      itemId: "3",
      targetUser: "U2",
      startDate: "2026-06-10",
      endDate: "2026-06-15",
      notifyChannels: [],
      notifyUsers: []
    }
  ];

  it("filters by user and end_date then sorts by startDate", () => {
    expect(filterOwnFutureAbsences(records, "U1", "2026-06-10").map((r) => r.itemId)).toEqual(["1", "2"]);
    expect(filterOwnFutureAbsences(records, "U1", "2026-06-16").map((r) => r.itemId)).toEqual(["2"]);
  });
});

describe("findOwnAbsenceByStartDate", () => {
  const records: AbsenceRecord[] = [
    {
      itemId: "1",
      targetUser: "U1",
      startDate: "2026-06-10",
      endDate: "2026-06-15",
      notifyChannels: [],
      notifyUsers: []
    },
    {
      itemId: "2",
      targetUser: "U1",
      startDate: "2026-06-10",
      endDate: "2026-06-20",
      notifyChannels: [],
      notifyUsers: []
    }
  ];

  it("matches own records by start date with end_date >= today", () => {
    expect(findOwnAbsenceByStartDate(records, "U1", "2026-06-10", "2026-06-10").map((r) => r.itemId)).toEqual([
      "1",
      "2"
    ]);
    expect(findOwnAbsenceByStartDate(records, "U1", "2026-06-10", "2026-06-16").map((r) => r.itemId)).toEqual(["2"]);
  });
});

describe("groupByChannel", () => {
  it("groups records by channel and skips empty channels", () => {
    const grouped = groupByChannel([
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        notifyChannels: ["C1", "C2"],
        notifyUsers: []
      },
      {
        itemId: "2",
        targetUser: "U2",
        startDate: "2026-06-01",
        endDate: "2026-06-02",
        notifyChannels: [],
        notifyUsers: []
      }
    ]);
    expect(grouped.get("C1")?.map((r) => r.itemId)).toEqual(["1"]);
    expect(grouped.get("C2")?.map((r) => r.itemId)).toEqual(["1"]);
    expect(grouped.has("")).toBe(false);
  });
});
