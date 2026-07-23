import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import type { AbsenceRecord } from "../domain/absence";
import { createAbsence } from "../db/absence-repository";
import { upsertSlackUserOAuth } from "../db/slack-user-oauth-repository";
import { upsertMemberMaster } from "../db/member-master-repository";
import * as jstDate from "../domain/jst-date";
import {
  reconcileStatusAfterAbsenceChange,
  reconcileStatusAfterAbsenceChangeIsolated,
  reconcileStatusAfterMemberMasterSettingsChangeIsolated,
  reconcileStatusIfRecordsAffectToday,
  syncStatusForUserToday,
  syncTodayAbsenceStatus
} from "./status-sync";

const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));

const { setUserProfileStatusMock, clearUserProfileStatusMock } = vi.hoisted(() => ({
  setUserProfileStatusMock: vi.fn(async () => undefined),
  clearUserProfileStatusMock: vi.fn(async () => undefined)
}));

vi.mock("../slack/user-api", () => ({
  setUserProfileStatus: setUserProfileStatusMock,
  clearUserProfileStatus: clearUserProfileStatusMock
}));

describe("syncTodayAbsenceStatus", () => {
  const config = createTestConfig(createMockKv(), {
    db: createMockD1(),
    slackClientId: "C1",
    slackClientSecret: "secret",
    slackOauthEncryptionKey: TEST_KEY_B64,
    statusDefaultText: "不在",
    statusEmoji: ":date:"
  });

  beforeEach(() => {
    setUserProfileStatusMock.mockClear();
    clearUserProfileStatusMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("skips manual trigger", async () => {
    const result = await syncTodayAbsenceStatus(config, { runId: "r1", trigger: "manual" }, [], "2026-06-24");
    expect(result).toEqual({
      active: false,
      statusSet: 0,
      statusSkipped: 0,
      statusErrors: 0
    });
    expect(setUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("sets status for oauth-linked user without notify channels", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: [],
        note: "通院"
      }
    ];
    const result = await syncTodayAbsenceStatus(
      config,
      { runId: "r2", trigger: "scheduled" },
      records,
      "2026-06-24"
    );
    expect(result.statusSet).toBe(1);
    expect(result.active).toBe(true);
    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({
        status_text: "通院",
        status_emoji: ":date:"
      })
    );
  });

  it("skips users without oauth", async () => {
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U_NO_OAUTH",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: ["C1"],
        notifyUsers: [],
        note: "休み"
      }
    ];
    const result = await syncTodayAbsenceStatus(
      config,
      { runId: "r3", trigger: "scheduled" },
      records,
      "2026-06-24"
    );
    expect(result.statusSet).toBe(0);
    expect(result.statusSkipped).toBe(1);
  });

  it("uses user status prefs when note is empty", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusDefaultText: "リモート",
      statusEmoji: ":house:"
    });
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: []
      }
    ];
    const result = await syncTodayAbsenceStatus(
      config,
      { runId: "r4", trigger: "scheduled" },
      records,
      "2026-06-24"
    );
    expect(result.statusSet).toBe(1);
    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({
        status_text: "リモート",
        status_emoji: ":house:"
      })
    );
  });

  it("prefers note over user status prefs", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusDefaultText: "リモート",
      statusEmoji: ":house:"
    });
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: [],
        note: "通院"
      }
    ];
    await syncTodayAbsenceStatus(config, { runId: "r5", trigger: "scheduled" }, records, "2026-06-24");
    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({
        status_text: "通院",
        status_emoji: ":house:"
      })
    );
  });
});

describe("syncStatusForUserToday", () => {
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(() => {
    config = createTestConfig(createMockKv(), {
      db: createMockD1(),
      slackClientId: "C1",
      slackClientSecret: "secret",
      slackOauthEncryptionKey: TEST_KEY_B64,
      statusDefaultText: "不在",
      statusEmoji: ":date:"
    });
    setUserProfileStatusMock.mockClear();
    clearUserProfileStatusMock.mockClear();
  });

  it("sets status for today registration", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: [],
        note: "通院"
      }
    ];
    const result = await syncStatusForUserToday(config, {
      userId: "U1",
      todayJst: "2026-06-24",
      runId: "evt-1",
      records
    });
    expect(result).toBe("set");
    expect(setUserProfileStatusMock).toHaveBeenCalledOnce();
  });

  it("skips future-only registration", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-25",
        endDate: "2026-06-25",
        notifyChannels: [],
        notifyUsers: [],
        note: "休み"
      }
    ];
    const result = await syncStatusForUserToday(config, {
      userId: "U1",
      todayJst: "2026-06-24",
      runId: "evt-2",
      records
    });
    expect(result).toBe("skipped_not_today");
    expect(setUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("skips when oauth is missing", async () => {
    const records: AbsenceRecord[] = [
      {
        itemId: "1",
        targetUser: "U1",
        startDate: "2026-06-24",
        endDate: "2026-06-24",
        notifyChannels: [],
        notifyUsers: [],
        note: "休み"
      }
    ];
    const result = await syncStatusForUserToday(config, {
      userId: "U1",
      todayJst: "2026-06-24",
      runId: "evt-3",
      records
    });
    expect(result).toBe("skipped_no_oauth");
    expect(setUserProfileStatusMock).not.toHaveBeenCalled();
  });
});

describe("reconcileStatusAfterAbsenceChange", () => {
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(() => {
    config = createTestConfig(createMockKv(), {
      db: createMockD1(),
      slackClientId: "C1",
      slackClientSecret: "secret",
      slackOauthEncryptionKey: TEST_KEY_B64,
      statusDefaultText: "不在",
      statusEmoji: ":date:"
    });
    setUserProfileStatusMock.mockClear();
    clearUserProfileStatusMock.mockClear();
  });

  it("re-sets status when another today absence remains", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: [],
      notifyUsers: [],
      note: "午後休"
    });
    const result = await reconcileStatusAfterAbsenceChange(config, {
      userId: "U1",
      todayJst: "2026-06-24",
      runId: "evt-5"
    });
    expect(result).toBe("set");
    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({ status_text: "午後休" })
    );
    expect(clearUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("clears status when no today absences remain", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    const result = await reconcileStatusAfterAbsenceChange(config, {
      userId: "U1",
      todayJst: "2026-06-24",
      runId: "evt-4"
    });
    expect(result).toBe("cleared");
    expect(clearUserProfileStatusMock).toHaveBeenCalledOnce();
    expect(setUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("re-resolves from all today absences in db", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: [],
      notifyUsers: [],
      note: "午前休"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: [],
      notifyUsers: [],
      note: "通院"
    });
    const result = await reconcileStatusAfterAbsenceChange(config, {
      userId: "U1",
      todayJst: "2026-06-24",
      runId: "evt-6"
    });
    expect(result).toBe("set");
    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({
        status_text: expect.stringMatching(/午前休|通院/)
      })
    );
  });
});

describe("reconcileStatusIfRecordsAffectToday", () => {
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(() => {
    config = createTestConfig(createMockKv(), {
      db: createMockD1(),
      slackClientId: "C1",
      slackClientSecret: "secret",
      slackOauthEncryptionKey: TEST_KEY_B64,
      statusDefaultText: "不在",
      statusEmoji: ":date:"
    });
    setUserProfileStatusMock.mockClear();
    clearUserProfileStatusMock.mockClear();
  });

  it("skips reconcile for future-only records", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await reconcileStatusIfRecordsAffectToday(config, {
      userId: "U1",
      records: [
        {
          itemId: "1",
          targetUser: "U1",
          startDate: "2026-06-25",
          endDate: "2026-06-25",
          notifyChannels: [],
          notifyUsers: []
        }
      ]
    });
    expect(setUserProfileStatusMock).not.toHaveBeenCalled();
    expect(clearUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("isolates reconcile failures", async () => {
    const repo = await import("../db/absence-repository");
    const listSpy = vi.spyOn(repo, "listAbsencesByUserActiveOnDate").mockRejectedValueOnce(new Error("db down"));
    await expect(
      reconcileStatusAfterAbsenceChangeIsolated(config, { userId: "U1", runId: "evt-7" })
    ).resolves.toBeUndefined();
    listSpy.mockRestore();
  });
});

describe("reconcileStatusAfterMemberMasterSettingsChangeIsolated", () => {
  let config: ReturnType<typeof createTestConfig>;

  beforeEach(() => {
    config = createTestConfig(createMockKv(), {
      db: createMockD1(),
      slackClientId: "C1",
      slackClientSecret: "secret",
      slackOauthEncryptionKey: TEST_KEY_B64,
      statusDefaultText: "不在",
      statusEmoji: ":date:"
    });
    setUserProfileStatusMock.mockClear();
    clearUserProfileStatusMock.mockClear();
    vi.spyOn(jstDate, "getJstDateParts").mockReturnValue({ day: "2026-06-24", hour: 10 });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("re-sets status with updated user prefs when today absence has no note", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusDefaultText: "リモート",
      statusEmoji: ":house:"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: [],
      notifyUsers: []
    });

    await reconcileStatusAfterMemberMasterSettingsChangeIsolated(config, { userId: "U1", runId: "set-1" });

    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({
        status_text: "リモート",
        status_emoji: ":house:"
      })
    );
    expect(clearUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("prefers note over updated user prefs", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusDefaultText: "リモート",
      statusEmoji: ":house:"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: [],
      notifyUsers: [],
      note: "通院"
    });

    await reconcileStatusAfterMemberMasterSettingsChangeIsolated(config, { userId: "U1", runId: "set-2" });

    expect(setUserProfileStatusMock).toHaveBeenCalledWith(
      "xoxp-u1",
      expect.objectContaining({ status_text: "通院" })
    );
  });

  it("does not change status when there is no today absence", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-u1",
      scope: "users.profile:write"
    });
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      notifyChannels: [],
      notifyUsers: []
    });

    await reconcileStatusAfterMemberMasterSettingsChangeIsolated(config, { userId: "U1", runId: "set-3" });

    expect(setUserProfileStatusMock).not.toHaveBeenCalled();
    expect(clearUserProfileStatusMock).not.toHaveBeenCalled();
  });

  it("isolates failures without throwing", async () => {
    const repo = await import("../db/absence-repository");
    const listSpy = vi.spyOn(repo, "listAbsencesByUserActiveOnDate").mockRejectedValueOnce(new Error("db down"));
    await expect(
      reconcileStatusAfterMemberMasterSettingsChangeIsolated(config, { userId: "U1", runId: "set-4" })
    ).resolves.toBeUndefined();
    listSpy.mockRestore();
  });
});
