import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import type { AbsenceRecord } from "../domain/absence";
import { upsertSlackUserOAuth } from "../db/slack-user-oauth-repository";
import { syncTodayAbsenceStatus } from "./status-sync";

const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(11)));

const { setUserProfileStatusMock } = vi.hoisted(() => ({
  setUserProfileStatusMock: vi.fn(async () => undefined)
}));

vi.mock("../slack/user-api", () => ({
  setUserProfileStatus: setUserProfileStatusMock
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
});
