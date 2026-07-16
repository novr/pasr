import { describe, expect, it, vi } from "vitest";
import { createAbsence } from "../db/absence-repository";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { ADMIN_ABSENCES_PAGE_ACTION_ID } from "./action-ids";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";
import type { AdminEphemeralReply } from "./admin-format";
import { ADMIN_EPHEMERAL_TEXT_MAX } from "./admin-format";
import {
  buildAbsencesTodayReply,
  handleAbsencesCommand,
  handleAdminAbsencesPageInteraction
} from "./admin-absences";
import type { SlackCommandPayload } from "./command";

const replyText = (reply: AdminEphemeralReply | string): string =>
  typeof reply === "string" ? reply : reply.text;

const basePayload = (overrides: Partial<SlackCommandPayload> = {}): SlackCommandPayload => ({
  command: "/pasr-admin",
  text: "absences",
  userId: "U_ADMIN",
  teamId: "T1",
  channelId: "C1",
  triggerId: "tr1",
  responseUrl: "",
  ...overrides
});

describe("handleAbsencesCommand", () => {
  it("lists today absences with notify targets from record", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-15T00:30:00+09:00"));
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2099-06-01",
      endDate: "2099-06-30",
      notifyChannels: ["C_NOTIFY"],
      notifyUsers: ["U_DM"],
      note: "通院"
    });
    const reply = await handleAbsencesCommand(config, basePayload());
    const text = replyText(reply);
    expect(text).toContain("2099-06-15 JST): 1件");
    expect(text).toContain("通院");
    expect(text).toContain("C_NOTIFY");
    expect(text).toContain("U_DM");
    vi.useRealTimers();
  });

  it("returns zero count when no absences today", async () => {
    const config = createTestConfig(createMockKv());
    const reply = await handleAbsencesCommand(config, basePayload({ text: "absences today" }));
    expect(replyText(reply)).toMatch(/本日の不在 .* JST\): 0件/);
  });

  it("rejects unknown subcommand", async () => {
    const config = createTestConfig(createMockKv());
    const reply = await handleAbsencesCommand(config, basePayload({ text: "absences foo" }));
    expect(replyText(reply)).toContain("使い方");
  });

  it("shows pagination button instead of plain hidden count", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-15T00:30:00+09:00"));
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < ADMIN_EPHEMERAL_LIST_MAX + 1; i++) {
      await createAbsence(config, {
        itemId: `A${i}`,
        targetUser: `U${i}`,
        startDate: "2099-06-15",
        endDate: "2099-06-15",
        notifyChannels: [],
        notifyUsers: []
      });
    }
    const reply = await handleAbsencesCommand(config, basePayload());
    expect(typeof reply).not.toBe("string");
    if (typeof reply === "string") return;
    expect(reply.text).toContain("ページ 1/2");
    expect(reply.text).not.toContain("… 他");
    const section = reply.blocks?.[0] as { type?: string; text?: { text?: string } };
    expect(section.type).toBe("section");
    expect(section.text?.text).toContain("<@U0>");
    const actions = reply.blocks?.[1] as { type?: string; elements?: Array<{ text?: { text?: string } }> };
    expect(actions.type).toBe("actions");
    expect(actions.elements?.some((element) => element.text?.text === "他 1 件 →")).toBe(true);
    vi.useRealTimers();
  });

  it("loads requested page", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-15T00:30:00+09:00"));
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < ADMIN_EPHEMERAL_LIST_MAX + 1; i++) {
      await createAbsence(config, {
        itemId: `A${i}`,
        targetUser: `U${String(i).padStart(4, "0")}`,
        startDate: "2099-06-15",
        endDate: "2099-06-15",
        notifyChannels: [],
        notifyUsers: []
      });
    }
    const reply = await buildAbsencesTodayReply(config, 2);
    const text = replyText(reply);
    expect(text).toContain("ページ 2/2");
    expect(text).not.toContain("<@U0000>");
    vi.useRealTimers();
  });

  it("stays within ephemeral text max", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-15T00:30:00+09:00"));
    const config = createTestConfig(createMockKv());
    for (let i = 0; i < 8; i++) {
      await createAbsence(config, {
        itemId: `A${i}`,
        targetUser: `U${i}`,
        startDate: "2099-06-15",
        endDate: "2099-06-15",
        notifyChannels: ["C_LONG".repeat(20)],
        notifyUsers: ["U_LONG".repeat(20)],
        note: "x".repeat(200)
      });
    }
    const reply = await handleAbsencesCommand(config, basePayload());
    expect(replyText(reply).length).toBeLessThanOrEqual(ADMIN_EPHEMERAL_TEXT_MAX);
    vi.useRealTimers();
  });
});

describe("handleAdminAbsencesPageInteraction", () => {
  it("replaces ephemeral on page button click", async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2099-06-15T00:30:00+09:00"));
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2099-06-15",
      endDate: "2099-06-15",
      notifyChannels: [],
      notifyUsers: []
    });
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);

    const result = await handleAdminAbsencesPageInteraction(config, {
      actionId: ADMIN_ABSENCES_PAGE_ACTION_ID,
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
    vi.useRealTimers();
    vi.unstubAllGlobals();
  });
});
