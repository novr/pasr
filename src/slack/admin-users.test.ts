import { describe, expect, it, vi } from "vitest";
import { upsertMemberMaster } from "../db/member-master-repository";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { ADMIN_USERS_PAGE_ACTION_ID } from "./action-ids";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";
import type { AdminEphemeralReply } from "./admin-format";
import { ADMIN_EPHEMERAL_TEXT_MAX, computeAdminTotalPages, normalizeAdminPage } from "./admin-format";
import { buildUsersListReply, handleAdminUsersPageInteraction, handleUsersCommand } from "./admin-users";
import type { SlackCommandPayload } from "./command";

const replyText = (reply: AdminEphemeralReply | string): string =>
  typeof reply === "string" ? reply : reply.text;

const basePayload = (overrides: Partial<SlackCommandPayload> = {}): SlackCommandPayload => ({
  command: "/pasr-admin",
  text: "users",
  userId: "U_ADMIN",
  teamId: "T1",
  channelId: "C1",
  triggerId: "tr1",
  responseUrl: "",
  ...overrides
});

describe("users pagination helpers", () => {
  it("computes total pages", () => {
    expect(computeAdminTotalPages(1)).toBe(1);
    expect(computeAdminTotalPages(ADMIN_EPHEMERAL_LIST_MAX)).toBe(1);
    expect(computeAdminTotalPages(ADMIN_EPHEMERAL_LIST_MAX + 1)).toBe(2);
  });

  it("normalizes page within bounds", () => {
    expect(normalizeAdminPage(0, 3)).toBe(1);
    expect(normalizeAdminPage(99, 3)).toBe(3);
  });
});

describe("handleUsersCommand", () => {
  it("lists member_master with active counts", async () => {
    const config = createTestConfig(createMockKv());
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: ["C1"],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "ch"
    });
    await upsertMemberMaster(config, {
      targetUser: "U2",
      active: false,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    const text = replyText(await handleUsersCommand(config, basePayload(), 1));
    expect(text).toContain("active 1 / 全 2");
    expect(text).toContain("ページ 1/1");
    expect(text).toContain("<@U1>");
    expect(text).toContain("inactive");
  });

  it("shows status prefs when schema 0004 is applied", async () => {
    const config = createTestConfig(createMockKv(), {
      slackClientId: "C1",
      slackClientSecret: "secret",
      slackOauthEncryptionKey: btoa(String.fromCharCode(...new Uint8Array(32).fill(11))),
      statusDefaultText: "不在",
      statusEmoji: ":date:"
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
    const text = replyText(await handleUsersCommand(config, basePayload(), 1));
    expect(text).toContain("Status OAuth:");
    expect(text).toContain("Status文言: リモート :house:");
  });

  it("shows pagination button instead of plain hidden count", async () => {
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < ADMIN_EPHEMERAL_LIST_MAX + 1; i++) {
      await upsertMemberMaster(config, {
        targetUser: `U${String(i).padStart(4, "0")}`,
        active: true,
        defaultNotifyChannels: [],
        defaultNotifyUsers: [],
        defaultRegistrationNotify: "none"
      });
    }
    const reply = await handleUsersCommand(config, basePayload(), 1);
    expect(typeof reply).not.toBe("string");
    if (typeof reply === "string") return;
    expect(reply.text).toContain("ページ 1/2");
    expect(reply.text).not.toContain("… 他");
    const section = reply.blocks?.[0] as { type?: string; text?: { text?: string } };
    expect(section.type).toBe("section");
    expect(section.text?.text).toContain("<@U0000>");
    const actions = reply.blocks?.[1] as { type?: string; elements?: Array<{ text?: { text?: string } }> };
    expect(actions.type).toBe("actions");
    expect(actions.elements?.some((element) => element.text?.text === "次ページ（1 件）→")).toBe(true);
  });

  it("loads requested page via slash text", async () => {
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < ADMIN_EPHEMERAL_LIST_MAX + 1; i++) {
      await upsertMemberMaster(config, {
        targetUser: `U${String(i).padStart(4, "0")}`,
        active: true,
        defaultNotifyChannels: [],
        defaultNotifyUsers: [],
        defaultRegistrationNotify: "none"
      });
    }
    const text = replyText(await buildUsersListReply(config, 2));
    expect(text).toContain("ページ 2/2");
    expect(text).toContain("<@U0025>");
  });

  it("returns empty message when no users", async () => {
    const config = createTestConfig(createMockKv());
    const reply = await handleUsersCommand(config, basePayload(), 1);
    expect(reply).toBe("PASR 登録ユーザーは 0 件です。");
  });
});

describe("handleAdminUsersPageInteraction", () => {
  it("replaces ephemeral on page button click", async () => {
    const config = createTestConfig(createMockKv());
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleAdminUsersPageInteraction(config, {
      actionId: ADMIN_USERS_PAGE_ACTION_ID,
      userId: "U_ADMIN",
      pageValue: "1",
      responseUrl: "https://hooks.slack.com/actions/T/1/2"
    });
    expect(result.handled).toBe(true);
    await result.followUp?.();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T/1/2",
      expect.objectContaining({
        body: expect.stringContaining("replace_original")
      })
    );
    vi.unstubAllGlobals();
  });

  it("posts section mrkdwn before pagination actions", async () => {
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < ADMIN_EPHEMERAL_LIST_MAX + 1; i++) {
      await upsertMemberMaster(config, {
        targetUser: `U${String(i).padStart(4, "0")}`,
        active: true,
        defaultNotifyChannels: [],
        defaultNotifyUsers: [],
        defaultRegistrationNotify: "none"
      });
    }
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleAdminUsersPageInteraction(config, {
      actionId: ADMIN_USERS_PAGE_ACTION_ID,
      userId: "U_ADMIN",
      pageValue: "1",
      responseUrl: "https://hooks.slack.com/actions/T/1/2"
    });
    await result.followUp?.();
    expect(fetchMock.mock.calls.length).toBeGreaterThan(0);
    const [, requestInit] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    const body = JSON.parse(requestInit.body as string) as {
      replace_original?: boolean;
      blocks?: Array<{ type: string; text?: { type: string; text: string } }>;
    };
    expect(body.replace_original).toBe(true);
    expect(body.blocks?.[0]?.type).toBe("section");
    expect(body.blocks?.[0]?.text?.type).toBe("mrkdwn");
    expect(body.blocks?.[1]?.type).toBe("actions");
    vi.unstubAllGlobals();
  });

  it("ignores non-admin users", async () => {
    const config = createTestConfig(createMockKv());
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleAdminUsersPageInteraction(config, {
      actionId: ADMIN_USERS_PAGE_ACTION_ID,
      userId: "U_OTHER",
      pageValue: "2",
      responseUrl: "https://hooks.slack.com/actions/T/1/2"
    });
    expect(result.handled).toBe(true);
    await result.followUp?.();
    expect(fetchMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("stays within ephemeral text max", async () => {
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < 10; i++) {
      await upsertMemberMaster(config, {
        targetUser: `U${i}`,
        active: true,
        defaultNotifyChannels: ["C_LONG_CHANNEL_NAME".repeat(3)],
        defaultNotifyUsers: ["U_LONG_USER".repeat(3)],
        defaultRegistrationNotify: "both"
      });
    }
    const text = replyText(await handleUsersCommand(config, basePayload(), 1));
    expect(text.length).toBeLessThanOrEqual(ADMIN_EPHEMERAL_TEXT_MAX);
  });
});
