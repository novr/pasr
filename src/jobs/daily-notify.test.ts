import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createAbsence } from "../db/absence-repository";
import { upsertMemberMaster } from "../db/member-master-repository";
import { runDailyNotify } from "./daily-notify";

const { postChannelMessageMock, updateChannelMessageMock, openDirectMessageMock } = vi.hoisted(() => ({
  postChannelMessageMock: vi.fn(async () => ({ ok: true, ts: "123.456" })),
  updateChannelMessageMock: vi.fn(async () => ({ ok: true, ts: "123.456" })),
  openDirectMessageMock: vi.fn(async () => "D_DM")
}));

vi.mock("../slack/api", () => ({
  slackApi: {
    postChannelMessage: postChannelMessageMock,
    updateChannelMessage: updateChannelMessageMock,
    openDirectMessage: openDirectMessageMock
  }
}));

describe("runDailyNotify", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-06-24T00:30:00.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("skips inactive users and deletes ended absences", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv);
    await upsertMemberMaster(config, {
      targetUser: "U_ACTIVE",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await upsertMemberMaster(config, {
      targetUser: "U_INACTIVE",
      active: false,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await createAbsence(config, {
      targetUser: "U_ACTIVE",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });
    await createAbsence(config, {
      targetUser: "U_INACTIVE",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });
    await createAbsence(config, {
      targetUser: "U_ACTIVE",
      startDate: "2026-06-20",
      endDate: "2026-06-23",
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });

    const result = await runDailyNotify(config, { runId: "run_test", trigger: "manual" });

    expect(result.processed).toBe(3);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons.inactive_user_master).toBe(1);
    expect(result.deleted).toBe(1);
    expect(postChannelMessageMock).toHaveBeenCalled();
  });

  it("isolates notify errors and continues", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv);
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: ["C_FAIL", "C_OK"],
      notifyUsers: [],
      absenceType: "absence"
    });
    postChannelMessageMock.mockImplementation(async (...args: unknown[]) => {
      const channel = args[1] as string;
      if (channel === "C_FAIL") throw new Error("channel failed");
      return { ok: true, ts: "123.456" };
    });

    const result = await runDailyNotify(config, { runId: "run_test2", trigger: "manual" });

    expect(result.errors).toBe(1);
    expect(result.sent).toBe(1);
  });
});
