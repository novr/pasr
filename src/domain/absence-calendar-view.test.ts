import { describe, expect, it } from "vitest";
import type { AbsenceRecord } from "./absence";
import {
  flattenAbsenceCalendarDayGroups,
  groupAbsencesByJstDay
} from "./absence-calendar-view";

const record = (params: {
  itemId: string;
  targetUser: string;
  startDate: string;
  endDate: string;
  note?: string;
}): AbsenceRecord => ({
  itemId: params.itemId,
  targetUser: params.targetUser,
  startDate: params.startDate,
  endDate: params.endDate,
  notifyChannels: ["C1"],
  notifyUsers: [],
  note: params.note
});

describe("groupAbsencesByJstDay", () => {
  it("expands multi-day absences across each overlapping day", () => {
    const groups = groupAbsencesByJstDay(
      [record({ itemId: "A1", targetUser: "U1", startDate: "2026-08-10", endDate: "2026-08-12", note: "通院" })],
      "2026-08-05",
      "2026-08-31"
    );
    expect(groups).toHaveLength(3);
    expect(groups.map((group) => group.date)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
    expect(groups[0]?.entries[0]?.note).toBe("通院");
  });

  it("clips to query range and skips empty days", () => {
    const groups = groupAbsencesByJstDay(
      [record({ itemId: "A1", targetUser: "U1", startDate: "2026-08-01", endDate: "2026-08-20" })],
      "2026-08-10",
      "2026-08-12"
    );
    expect(groups.map((group) => group.date)).toEqual(["2026-08-10", "2026-08-11", "2026-08-12"]);
  });

  it("sorts entries by user then item id within a day", () => {
    const groups = groupAbsencesByJstDay(
      [
        record({ itemId: "B2", targetUser: "U2", startDate: "2026-08-10", endDate: "2026-08-10" }),
        record({ itemId: "A1", targetUser: "U1", startDate: "2026-08-10", endDate: "2026-08-10" })
      ],
      "2026-08-10",
      "2026-08-10"
    );
    expect(groups[0]?.entries.map((entry) => entry.targetUser)).toEqual(["U1", "U2"]);
  });
});

describe("flattenAbsenceCalendarDayGroups", () => {
  it("renders day headers and attendance notice lines", () => {
    const lines = flattenAbsenceCalendarDayGroups([
      {
        date: "2026-08-10",
        entries: [{ itemId: "A1", targetUser: "U1", note: "通院" }]
      }
    ]);
    expect(lines[0]).toBe("*2026-08-10 (月)*");
    expect(lines[1]).toBe("• <@U1> 通院");
  });
});
