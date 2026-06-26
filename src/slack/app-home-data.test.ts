import { describe, expect, it } from "vitest";
import type { AbsenceRecord } from "../domain/absence";
import { createAbsence, listAbsencesByUserFuture } from "../db/absence-repository";
import { upsertMemberMaster } from "../db/member-master-repository";
import { createTestConfig, createMockKv } from "../test/mock-kv";
import { loadAppHomeData } from "./app-home-data";

describe("loadAppHomeData", () => {
  it("loads master and future absences with hasMore flag", async () => {
    const config = createTestConfig(createMockKv());
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: ["C1"],
      defaultNotifyUsers: ["U2"],
      defaultRegistrationNotify: "both"
    });
    const absences: AbsenceRecord[] = [];
    for (let index = 0; index < 6; index += 1) {
      const created = await createAbsence(config, {
        targetUser: "U1",
        startDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        endDate: `2026-07-${String(index + 1).padStart(2, "0")}`,
        notifyChannels: ["C1"],
        notifyUsers: []
      });
      absences.push(created);
    }

    const data = await loadAppHomeData(config, "U1");

    expect(data.master?.defaultNotifyChannels).toEqual(["C1"]);
    expect(data.absences).toHaveLength(6);
    expect(data.hasMoreAbsences).toBe(true);
  });
});

describe("listAbsencesByUserFuture limit", () => {
  it("respects optional limit", async () => {
    const config = createTestConfig(createMockKv());
    for (let index = 0; index < 3; index += 1) {
      await createAbsence(config, {
        targetUser: "U1",
        startDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        endDate: `2026-08-${String(index + 1).padStart(2, "0")}`,
        notifyChannels: ["C1"],
        notifyUsers: []
      });
    }

    const limited = await listAbsencesByUserFuture(config, "U1", "2026-06-01", { limit: 2 });
    expect(limited).toHaveLength(2);
  });
});
