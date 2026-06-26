import { describe, expect, it } from "vitest";
import {
  createAbsence,
  deleteAbsenceById,
  getAbsenceById,
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
});
