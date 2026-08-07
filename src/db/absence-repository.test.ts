import { describe, expect, it } from "vitest";
import {
  createAbsence,
  deleteAbsenceById,
  getAbsenceById,
  countAbsencesOverlappingRangeForChannel,
  listAbsencesOverlappingRangeForChannel,
  listAbsencesByUserFuture,
  listAbsenceIdsEndedBefore
} from "./absence-repository";
import { createTestConfig, createMockKv } from "../test/mock-kv";

describe("absence-repository", () => {
  it("creates and reads absence", async () => {
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-25",
      notifyChannels: ["C1"],
      notifyUsers: [],
      note: "test"
    });
    expect(created.itemId.length).toBeGreaterThan(0);
    const loaded = await getAbsenceById(config, created.itemId);
    expect(loaded?.targetUser).toBe("U1");
    expect(loaded?.notifyChannels).toEqual(["C1"]);
  });

  it("lists future absences for user", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-20",
      endDate: "2026-06-22",
      notifyChannels: ["C1"],
      notifyUsers: []
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-30",
      notifyChannels: ["C1"],
      notifyUsers: []
    });
    const rows = await listAbsencesByUserFuture(config, "U1", "2026-06-24");
    expect(rows).toHaveLength(1);
    expect(rows[0]?.startDate).toBe("2026-06-24");
  });

  it("lists ended absence ids", async () => {
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-01",
      endDate: "2026-06-10",
      notifyChannels: ["C1"],
      notifyUsers: []
    });
    const ids = await listAbsenceIdsEndedBefore(config, "2026-06-24");
    expect(ids).toContain(created.itemId);
    await deleteAbsenceById(config, created.itemId);
    expect(await getAbsenceById(config, created.itemId)).toBeUndefined();
  });

  it("lists overlapping absences for channel in range", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      notifyChannels: ["C1"],
      notifyUsers: []
    });
    await createAbsence(config, {
      targetUser: "U2",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      notifyChannels: ["C2"],
      notifyUsers: []
    });
    await createAbsence(config, {
      targetUser: "U3",
      startDate: "2026-09-01",
      endDate: "2026-09-02",
      notifyChannels: ["C1"],
      notifyUsers: []
    });

    expect(await countAbsencesOverlappingRangeForChannel(config, "2026-08-01", "2026-08-31", "C1")).toBe(1);
    const rows = await listAbsencesOverlappingRangeForChannel(config, "2026-08-01", "2026-08-31", "C1", {
      limit: 10,
      offset: 0
    });
    expect(rows).toHaveLength(1);
    expect(rows[0]?.targetUser).toBe("U1");
  });

  it("does not match channel ids by prefix", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      notifyChannels: ["C12"],
      notifyUsers: []
    });
    expect(await countAbsencesOverlappingRangeForChannel(config, "2026-08-01", "2026-08-31", "C1")).toBe(0);
  });

  it("returns empty for invalid channel id", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-08-01",
      endDate: "2026-08-05",
      notifyChannels: ["C1"],
      notifyUsers: []
    });
    expect(await countAbsencesOverlappingRangeForChannel(config, "2026-08-01", "2026-08-31", "D_DM")).toBe(0);
    const rows = await listAbsencesOverlappingRangeForChannel(config, "2026-08-01", "2026-08-31", "D_DM", {
      limit: 10,
      offset: 0
    });
    expect(rows).toHaveLength(0);
  });
});
