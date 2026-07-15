import { describe, expect, it } from "vitest";
import { selectStatusNotesByUser, statusExpirationUnixForJstDay } from "./status-expiration";
import type { AbsenceRecord } from "./absence";

describe("status-expiration", () => {
  it("computes JST end of day unix", () => {
    const unix = statusExpirationUnixForJstDay("2026-06-24");
    expect(unix).toBe(Math.floor(new Date("2026-06-24T23:59:59+09:00").getTime() / 1000));
  });

  it("selects itemId ascending note per user", () => {
    const records: AbsenceRecord[] = [
      {
        itemId: "b",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: [],
        note: "second"
      },
      {
        itemId: "a",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: [],
        note: "first"
      }
    ];
    const selected = selectStatusNotesByUser(records);
    expect(selected).toEqual([{ targetUser: "U1", note: "first" }]);
  });
});
