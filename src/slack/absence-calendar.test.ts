import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAbsence } from "../db/absence-repository";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import type { AdminEphemeralReply } from "./admin-format";
import { ABSENCE_CALENDAR_PAGE_ACTION_ID } from "./action-ids";

const { postUserFacingMessageMock } = vi.hoisted(() => ({
  postUserFacingMessageMock: vi.fn(async () => undefined)
}));

vi.mock("./user-message", async () => {
  const actual = await vi.importActual<typeof import("./user-message")>("./user-message");
  return {
    ...actual,
    postUserFacingMessage: postUserFacingMessageMock
  };
});

import {
  ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
  buildAbsenceCalendarModalView,
  buildAbsenceCalendarReply,
  CHANNEL_BLOCK_ID,
  END_BLOCK_ID,
  handleAbsenceCalendarInteraction,
  handleAbsenceCalendarPageInteraction,
  START_BLOCK_ID
} from "./absence-calendar";

const replyText = (reply: AdminEphemeralReply | string): string =>
  typeof reply === "string" ? reply : reply.text;

describe("buildAbsenceCalendarReply", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:30:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("lists channel absences grouped by day with pagination", async () => {
    const config = createTestConfig(createMockKv());
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `A${index}`,
        targetUser: `U${index}`,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `B${index}`,
        targetUser: `V${index}`,
        startDate: "2026-08-11",
        endDate: "2026-08-11",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }

    const reply = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-05",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 1,
      todayJst: "2026-08-05"
    });
    expect(replyText(reply)).toContain("30件 / 2日");
    expect(replyText(reply)).toContain("ページ 1/2");
    expect(replyText(reply)).toContain("*2026-08-10 (月)*");
    expect(replyText(reply)).not.toContain("*2026-08-11");
    if (typeof reply !== "string" && reply.blocks) {
      const actions = reply.blocks.find((block) => block.type === "actions");
      const nextButton = (actions?.elements as Array<Record<string, unknown>>)?.find(
        (element) => element.text && String((element.text as { text?: string }).text).includes("次ページ")
      );
      expect(nextButton?.value).toContain("CNOTIFY");
      expect(String((nextButton?.text as { text?: string })?.text)).toContain("15 件");
    }
  });

  it("expands multi-day absences under each date heading", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "UALICE",
      startDate: "2026-08-10",
      endDate: "2026-08-12",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: [],
      note: "通院"
    });

    const reply = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-10",
      to: "2026-08-12",
      channelId: "CNOTIFY",
      page: 1,
      todayJst: "2026-08-05"
    });
    const text = replyText(reply);
    expect(text).toContain("1件 / 3日");
    expect(text).toContain("*2026-08-10 (月)*");
    expect(text).toContain("*2026-08-11 (火)*");
    expect(text).toContain("*2026-08-12 (水)*");
    expect(text).toContain("<@UALICE> 通院");
  });

  it("starts page two on the next day group", async () => {
    const config = createTestConfig(createMockKv());
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `A${index}`,
        targetUser: `U${index}`,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `B${index}`,
        targetUser: `V${index}`,
        startDate: "2026-08-11",
        endDate: "2026-08-11",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }

    const reply = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-05",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 2,
      todayJst: "2026-08-05"
    });
    const text = replyText(reply);
    expect(text).toContain("ページ 2/2");
    expect(text).toContain("*2026-08-11 (火)*");
    expect(text).not.toContain("*2026-08-10");
  });

  it("normalizes an out-of-range page in the header", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: []
    });

    const reply = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-10",
      to: "2026-08-10",
      channelId: "CNOTIFY",
      page: 99,
      todayJst: "2026-08-05"
    });
    expect(replyText(reply)).toContain("ページ 1/1");
  });

  it("rejects from before today", async () => {
    const config = createTestConfig(createMockKv());
    const reply = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-01",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 1,
      todayJst: "2026-08-05"
    });
    expect(replyText(reply)).toContain("今日以降");
  });
});

describe("buildAbsenceCalendarModalView", () => {
  it("includes guidance and initial dates", () => {
    const view = buildAbsenceCalendarModalView({
      userId: "U1",
      responseUrl: "https://hooks.example",
      deliverChannelId: "C012RUN",
      todayJst: "2026-08-05",
      initialChannelId: "CNOTIFY"
    });
    expect(view.callback_id).toBe(ABSENCE_CALENDAR_MODAL_CALLBACK_ID);
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const context = blocks[0]?.elements as Array<{ text?: string }>;
    expect(context[0]?.text).toContain("予定");
    const startBlock = blocks.find((block) => block.block_id === START_BLOCK_ID) as {
      element?: { initial_date?: string; min_date?: string };
    };
    expect(startBlock.element?.initial_date).toBe("2026-08-05");
    expect(startBlock.element?.min_date).toBeUndefined();
    const endBlock = blocks.find((block) => block.block_id === END_BLOCK_ID) as {
      element?: { min_date?: string };
    };
    expect(endBlock.element?.min_date).toBeUndefined();
    const channelBlock = blocks.find((block) => block.block_id === CHANNEL_BLOCK_ID) as {
      element?: { filter?: { include?: string[] } };
    };
    expect(channelBlock.element?.filter?.include).toEqual(["public", "private"]);
  });
});

describe("handleAbsenceCalendarInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:30:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("rejects submission from another user", async () => {
    const config = createTestConfig(createMockKv());
    const result = await handleAbsenceCalendarInteraction(config, {
      type: "view_submission",
      user: { id: "U_OTHER" },
      view: {
        callback_id: ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          userId: "U1",
          responseUrl: "https://hooks.example",
          deliverChannelId: "C_RUN"
        }),
        state: {
          values: {
            [START_BLOCK_ID]: { start_date: { selected_date: "2026-08-10" } },
            [END_BLOCK_ID]: { end_date: { selected_date: "2026-08-10" } },
            [CHANNEL_BLOCK_ID]: { notify_channel_select: { selected_conversation: "CNOTIFY" } }
          }
        }
      }
    });
    expect(result.ok).toBe(false);
  });

  it("rejects from before today on submission", async () => {
    const config = createTestConfig(createMockKv());
    const result = await handleAbsenceCalendarInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          userId: "U1",
          responseUrl: "https://hooks.example",
          deliverChannelId: "C_RUN"
        }),
        state: {
          values: {
            [START_BLOCK_ID]: { start_date: { selected_date: "2026-08-01" } },
            [END_BLOCK_ID]: { end_date: { selected_date: "2026-08-31" } },
            [CHANNEL_BLOCK_ID]: { notify_channel_select: { selected_conversation: "CNOTIFY" } }
          }
        }
      }
    });
    expect(result.ok).toBe(false);
    expect(result.error).toContain("今日以降");
    expect(result.errorBlockId).toBe(START_BLOCK_ID);
  });

  it("maps end-date validation errors to end block", async () => {
    const config = createTestConfig(createMockKv());
    const result = await handleAbsenceCalendarInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          userId: "U1",
          responseUrl: "https://hooks.example",
          deliverChannelId: "C_RUN"
        }),
        state: {
          values: {
            [START_BLOCK_ID]: { start_date: { selected_date: "2026-08-10" } },
            [END_BLOCK_ID]: { end_date: { selected_date: "2026-08-05" } },
            [CHANNEL_BLOCK_ID]: { notify_channel_select: { selected_conversation: "CNOTIFY" } }
          }
        }
      }
    });
    expect(result.ok).toBe(false);
    expect(result.errorBlockId).toBe(END_BLOCK_ID);
  });
});

describe("handleAbsenceCalendarPageInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:30:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("reports an error on invalid page value", async () => {
    const config = createTestConfig(createMockKv());
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleAbsenceCalendarPageInteraction(config, {
      actionId: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      userId: "U1",
      pageValue: "not-json",
      responseUrl: "https://hooks.slack.com/actions/T/1/2"
    });
    expect(result.handled).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("allows page turns even when from is before today", async () => {
    const config = createTestConfig(createMockKv());
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleAbsenceCalendarPageInteraction(config, {
      actionId: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      userId: "U1",
      pageValue: JSON.stringify({
        userId: "U1",
        from: "2026-08-01",
        to: "2026-08-31",
        channelId: "CNOTIFY",
        page: 2
      }),
      responseUrl: "https://hooks.slack.com/actions/T/1/2"
    });
    expect(result.handled).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("replaces ephemeral on next page click", async () => {
    const config = createTestConfig(createMockKv());
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `A${index}`,
        targetUser: `U${index}`,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `B${index}`,
        targetUser: `V${index}`,
        startDate: "2026-08-11",
        endDate: "2026-08-11",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }

    const page1 = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-05",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      page: 1,
      todayJst: "2026-08-05"
    });
    const actions =
      typeof page1 !== "string" && page1.blocks
        ? page1.blocks.find((block) => block.type === "actions")
        : undefined;
    const nextButton = (actions?.elements as Array<Record<string, unknown>>)?.find((element) =>
      String((element.text as { text?: string })?.text).includes("次ページ")
    );
    expect(nextButton?.value).toBeTypeOf("string");

    postUserFacingMessageMock.mockClear();
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleAbsenceCalendarPageInteraction(config, {
      actionId: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      userId: "U1",
      pageValue: String(nextButton?.value),
      responseUrl: "https://hooks.slack.com/actions/T/1/2",
      channelId: "C012RUN"
    });
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();
    expect(postUserFacingMessageMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T/1/2",
      expect.objectContaining({
        body: expect.stringContaining("replace_original")
      })
    );
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T/1/2",
      expect.objectContaining({
        body: expect.stringContaining("ページ 2/2")
      })
    );
    vi.unstubAllGlobals();
  });

  it("encodes deliver channel in page button value", async () => {
    const config = createTestConfig(createMockKv());
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `A${index}`,
        targetUser: `U${index}`,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `B${index}`,
        targetUser: `V${index}`,
        startDate: "2026-08-11",
        endDate: "2026-08-11",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }

    const reply = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-05",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      deliverChannelId: "C012RUN",
      page: 1,
      todayJst: "2026-08-05"
    });
    const actions =
      typeof reply !== "string" && reply.blocks
        ? reply.blocks.find((block) => block.type === "actions")
        : undefined;
    const nextButton = (actions?.elements as Array<Record<string, unknown>>)?.find((element) =>
      String((element.text as { text?: string })?.text).includes("次ページ")
    );
    expect(String(nextButton?.value)).toContain("C012RUN");
  });

  it("reports an error when page value userId does not match actor", async () => {
    const config = createTestConfig(createMockKv());
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleAbsenceCalendarPageInteraction(config, {
      actionId: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      userId: "U1",
      pageValue: JSON.stringify({
        userId: "U_OTHER",
        from: "2026-08-05",
        to: "2026-08-31",
        channelId: "CNOTIFY",
        page: 2
      }),
      responseUrl: "https://hooks.slack.com/actions/T/1/2"
    });
    expect(result.handled).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();
    expect(fetchMock).toHaveBeenCalled();
    vi.unstubAllGlobals();
  });

  it("uses replace_original for DM deliver channels", async () => {
    const config = createTestConfig(createMockKv());
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `A${index}`,
        targetUser: `U${index}`,
        startDate: "2026-08-10",
        endDate: "2026-08-10",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }
    for (let index = 0; index < 15; index += 1) {
      await createAbsence(config, {
        itemId: `B${index}`,
        targetUser: `V${index}`,
        startDate: "2026-08-11",
        endDate: "2026-08-11",
        notifyChannels: ["CNOTIFY"],
        notifyUsers: []
      });
    }

    const page1 = await buildAbsenceCalendarReply(config, {
      userId: "U1",
      from: "2026-08-05",
      to: "2026-08-31",
      channelId: "CNOTIFY",
      deliverChannelId: "D01234567",
      page: 1,
      todayJst: "2026-08-05"
    });
    const actions =
      typeof page1 !== "string" && page1.blocks
        ? page1.blocks.find((block) => block.type === "actions")
        : undefined;
    const nextButton = (actions?.elements as Array<Record<string, unknown>>)?.find((element) =>
      String((element.text as { text?: string })?.text).includes("次ページ")
    );

    postUserFacingMessageMock.mockClear();
    const fetchMock = vi.fn(async () => ({ ok: true }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const result = await handleAbsenceCalendarPageInteraction(config, {
      actionId: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      userId: "U1",
      pageValue: String(nextButton?.value),
      responseUrl: "https://hooks.slack.com/actions/T/1/2",
      channelId: "D01234567"
    });
    await result.followUp?.();
    expect(postUserFacingMessageMock).not.toHaveBeenCalled();
    expect(fetchMock).toHaveBeenCalledWith(
      "https://hooks.slack.com/actions/T/1/2",
      expect.objectContaining({
        body: expect.stringContaining("replace_original")
      })
    );
    vi.unstubAllGlobals();
  });
});
