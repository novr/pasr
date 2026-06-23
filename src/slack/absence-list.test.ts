import { describe, expect, it } from "vitest";
import type { AbsenceRecord } from "../domain/absence";
import { ABSENCE_LIST_MAX_ROWS, buildOwnAbsenceListBlocks } from "./absence-list";

const record = (id: string, start: string): AbsenceRecord => ({
  itemId: id,
  targetUser: "U1",
  startDate: start,
  endDate: start,
  notifyChannels: [],
  notifyUsers: []
});

describe("buildOwnAbsenceListBlocks", () => {
  it("truncates to ABSENCE_LIST_MAX_ROWS", () => {
    const records = Array.from({ length: 30 }, (_, index) => record(`item-${index}`, `2026-06-${String(index + 1).padStart(2, "0")}`));
    const { blocks, omitted } = buildOwnAbsenceListBlocks(records);
    expect(omitted).toBe(5);
    expect(blocks.length).toBe(ABSENCE_LIST_MAX_ROWS * 2);
  });
});
