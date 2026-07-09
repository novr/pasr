import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import { createAbsence } from "../db/absence-repository";
import { upsertMemberMaster } from "../db/member-master-repository";
import { readLastRunSummary } from "../state/kv";
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

  it("skips empty channel notifications when notify_when_empty is off", async () => {
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
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      notifyChannels: ["C_EMPTY_OFF", "C_EMPTY_ON"],
      notifyUsers: [],
      absenceType: "absence"
    });
    const { upsertChannelNotifySetting } = await import("../db/channel-notify-repository");
    await upsertChannelNotifySetting(config, "C_EMPTY_OFF", false, "U_ADMIN");

    const result = await runDailyNotify(config, { runId: "run_empty_off", trigger: "manual" });

    expect(result.todayAbsenceCount).toBe(0);
    expect(postChannelMessageMock).toHaveBeenCalledTimes(1);
    expect(postChannelMessageMock).toHaveBeenCalledWith(expect.anything(), "C_EMPTY_ON", expect.anything());
    expect(result.sent).toBe(1);
  });

  it("skips empty channels when org default notify_when_empty is off", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv, { notifyEmptyDefault: false });
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      notifyChannels: ["C_ORG_OFF"],
      notifyUsers: [],
      absenceType: "absence"
    });

    const result = await runDailyNotify(config, { runId: "run_org_off", trigger: "manual" });

    expect(result.todayAbsenceCount).toBe(0);
    expect(postChannelMessageMock).not.toHaveBeenCalled();
    expect(result.sent).toBe(0);
  });

  it("uses org default empty on when channel_notify_settings table is missing", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv, {
      db: createMockD1({ includeChannelNotifySettings: false })
    });
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      notifyChannels: ["C_PRE_MIGRATE"],
      notifyUsers: [],
      absenceType: "absence"
    });

    const result = await runDailyNotify(config, { runId: "run_pre_migrate", trigger: "manual" });

    expect(result.errors).toBe(0);
    expect(postChannelMessageMock).toHaveBeenCalledWith(expect.anything(), "C_PRE_MIGRATE", expect.anything());
    expect(result.sent).toBe(1);
  });

  it("notifies override-only channels when no valid absence records exist on empty days", async () => {
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
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      notifyChannels: [],
      notifyUsers: [],
      absenceType: "absence"
    });
    const { upsertChannelNotifySetting } = await import("../db/channel-notify-repository");
    await upsertChannelNotifySetting(config, "C_OVERRIDE_ONLY", true, "U_ADMIN");

    const result = await runDailyNotify(config, { runId: "run_override_only", trigger: "manual" });

    expect(result.todayAbsenceCount).toBe(0);
    expect(result.skipped).toBe(1);
    expect(result.skipReasons.missing_notify_channels).toBe(1);
    expect(postChannelMessageMock).toHaveBeenCalledWith(expect.anything(), "C_OVERRIDE_ONLY", expect.anything());
    expect(result.sent).toBe(1);
  });

  it("counts DM deliveries in result.sent", async () => {
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
      notifyChannels: ["C1"],
      notifyUsers: ["U2"],
      absenceType: "absence"
    });

    const result = await runDailyNotify(config, { runId: "run_dm_sent", trigger: "manual" });

    expect(result.sent).toBe(2);
    expect(openDirectMessageMock).toHaveBeenCalledWith(expect.anything(), "U2");
  });

  it("records ops failures in last summary errors", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv, { opsChannelId: "C_OPS" });
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
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });
    postChannelMessageMock.mockImplementation(async (...args: unknown[]) => {
      if (args[1] === "C_OPS") throw new Error("not_in_channel");
      return { ok: true, ts: "123.456" };
    });

    const result = await runDailyNotify(config, { runId: "run_ops_fail", trigger: "scheduled" });
    const summary = await readLastRunSummary(config);

    expect(result.errors).toBe(1);
    expect(summary?.errors).toBe(1);
  });

  it("posts ops report only for scheduled trigger", async () => {
    const kvManual = createMockKv();
    const configManual = createTestConfig(kvManual, { opsChannelId: "C_OPS" });
    await upsertMemberMaster(configManual, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await createAbsence(configManual, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });

    await runDailyNotify(configManual, { runId: "run_manual", trigger: "manual" });
    expect(postChannelMessageMock).not.toHaveBeenCalledWith(expect.anything(), "C_OPS", expect.anything());

    postChannelMessageMock.mockClear();
    const kvScheduled = createMockKv();
    const configScheduled = createTestConfig(kvScheduled, { opsChannelId: "C_OPS" });
    await upsertMemberMaster(configScheduled, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await createAbsence(configScheduled, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });
    await runDailyNotify(configScheduled, { runId: "run_scheduled", trigger: "scheduled" });
    expect(postChannelMessageMock).toHaveBeenCalledWith(expect.anything(), "C_OPS", expect.anything());
  });
});
