import { describe, expect, it } from "vitest";
import {
  filterEndedBefore,
  filterOwnFutureAbsences,
  filterToday,
  findOwnAbsenceByStartDate,
  groupByChannel,
  type AbsenceRecord
} from "./absence";

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
