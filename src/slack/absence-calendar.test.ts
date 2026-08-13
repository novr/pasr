import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createAbsence } from "../db/absence-repository";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { openDirectMessageMock, postChannelMessageMock } = vi.hoisted(() => ({
  openDirectMessageMock: vi.fn(async () => "D_DM"),
  postChannelMessageMock: vi.fn(async () => ({ ts: "123.456" }))
}));

vi.mock("./api", async () => {
  const actual = await vi.importActual<typeof import("./api")>("./api");
  return {
    ...actual,
    slackApi: {
      ...actual.slackApi,
      openDirectMessage: openDirectMessageMock,
      postChannelMessage: postChannelMessageMock,
      openModal: vi.fn(async () => ({ view: { id: "V1" } }))
    }
  };
});

const { deliverAdminEphemeralReplyMock } = vi.hoisted(() => ({
  deliverAdminEphemeralReplyMock: vi.fn(async () => undefined)
}));

vi.mock("./admin-format", async () => {
  const actual = await vi.importActual<typeof import("./admin-format")>("./admin-format");
  return {
    ...actual,
    deliverAdminEphemeralReply: deliverAdminEphemeralReplyMock
  };
});

import * as messageTextSplit from "./message-text-split";
import {
  ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
  buildAbsenceCalendarDmDelivery,
  buildAbsenceCalendarModalView,
  buildCalendarDmAckMessage,
  CALENDAR_DM_MAX_THREAD_MESSAGES,
  CALENDAR_DM_TEXT_MAX,
  CHANNEL_BLOCK_ID,
  deliverAbsenceCalendarToDm,
  END_BLOCK_ID,
  handleAbsenceCalendarInteraction,
  START_BLOCK_ID
} from "./absence-calendar";

describe("buildAbsenceCalendarDmDelivery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:30:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns parent-only message for empty results", async () => {
    const config = createTestConfig(createMockKv());
    const delivery = await buildAbsenceCalendarDmDelivery(config, {
      channelId: "CNOTIFY",
      from: "2026-08-05",
      to: "2026-08-31",
      todayJst: "2026-08-05"
    });
    expect(delivery).toEqual({
      parentText: "<#CNOTIFY> の不在カレンダー (2026-08-05 〜 2026-08-31 JST): 0件\n（該当なし）",
      threadTexts: [],
      totalCount: 0,
      truncated: false
    });
  });

  it("builds parent and thread texts grouped by day", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: [],
      note: "通院"
    });
    await createAbsence(config, {
      itemId: "A2",
      targetUser: "U2",
      startDate: "2026-08-11",
      endDate: "2026-08-11",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: []
    });

    const delivery = await buildAbsenceCalendarDmDelivery(config, {
      channelId: "CNOTIFY",
      from: "2026-08-05",
      to: "2026-08-31",
      todayJst: "2026-08-05"
    });
    expect(typeof delivery).not.toBe("string");
    if (typeof delivery === "string") return;
    expect(delivery.parentText).toContain("2件 / 2日");
    expect(delivery.truncated).toBe(false);
    expect(delivery.threadTexts).toHaveLength(1);
    expect(delivery.threadTexts[0]).toContain("*2026-08-10 (月)*");
    expect(delivery.threadTexts[0]).toContain("<@U1> 通院");
    expect(delivery.threadTexts[0]).toContain("*2026-08-11 (火)*");
  });

  it("truncates thread messages when exceeding max count", async () => {
    const splitSpy = vi
      .spyOn(messageTextSplit, "splitLinesByTextMax")
      .mockReturnValue(Array.from({ length: CALENDAR_DM_MAX_THREAD_MESSAGES + 5 }, (_, index) => `part-${index}`));
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: []
    });

    const delivery = await buildAbsenceCalendarDmDelivery(config, {
      channelId: "CNOTIFY",
      from: "2026-08-05",
      to: "2026-08-31",
      todayJst: "2026-08-05"
    });
    splitSpy.mockRestore();
    expect(typeof delivery).not.toBe("string");
    if (typeof delivery === "string") return;
    expect(delivery.threadTexts).toHaveLength(CALENDAR_DM_MAX_THREAD_MESSAGES);
    expect(delivery.truncated).toBe(true);
    expect(delivery.threadTexts.at(-1)).toContain("以降は表示を省略しました");
    for (const threadText of delivery.threadTexts) {
      expect(threadText.length).toBeLessThanOrEqual(CALENDAR_DM_TEXT_MAX);
    }
  });

  it("keeps labeled thread texts within max length", async () => {
    const config = createTestConfig(createMockKv());
    const longNote = "x".repeat(11_900);
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: [],
      note: longNote
    });
    await createAbsence(config, {
      itemId: "A2",
      targetUser: "U2",
      startDate: "2026-08-11",
      endDate: "2026-08-11",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: [],
      note: longNote
    });

    const delivery = await buildAbsenceCalendarDmDelivery(config, {
      channelId: "CNOTIFY",
      from: "2026-08-05",
      to: "2026-08-31",
      todayJst: "2026-08-05"
    });
    expect(typeof delivery).not.toBe("string");
    if (typeof delivery === "string") return;
    expect(delivery.threadTexts.length).toBeGreaterThan(1);
    for (const threadText of delivery.threadTexts) {
      expect(threadText.length).toBeLessThanOrEqual(CALENDAR_DM_TEXT_MAX);
    }
  });
});

describe("deliverAbsenceCalendarToDm", () => {
  beforeEach(() => {
    openDirectMessageMock.mockClear();
    postChannelMessageMock.mockClear();
  });

  it("posts parent and thread replies with thread_ts", async () => {
    const config = createTestConfig(createMockKv());
    const result = await deliverAbsenceCalendarToDm(config, {
      userId: "U1",
      parentText: "parent",
      threadTexts: ["thread-1", "thread-2"],
      truncated: false
    });
    expect(openDirectMessageMock).toHaveBeenCalledWith(config, "U1");
    expect(postChannelMessageMock).toHaveBeenNthCalledWith(1, config, "D_DM", "parent");
    expect(postChannelMessageMock).toHaveBeenNthCalledWith(
      2,
      config,
      "D_DM",
      "thread-1",
      undefined,
      "123.456"
    );
    expect(postChannelMessageMock).toHaveBeenNthCalledWith(
      3,
      config,
      "D_DM",
      "thread-2",
      undefined,
      "123.456"
    );
    expect(result).toEqual({
      parentOk: true,
      threadSent: 2,
      threadFailed: 0,
      truncated: false,
      emptyResult: false
    });
  });

  it("continues after a thread post failure", async () => {
    postChannelMessageMock
      .mockResolvedValueOnce({ ts: "123.456" })
      .mockRejectedValueOnce(new Error("invalid_blocks"))
      .mockResolvedValueOnce({ ts: "123.457" });
    const config = createTestConfig(createMockKv());
    const result = await deliverAbsenceCalendarToDm(config, {
      userId: "U1",
      parentText: "parent",
      threadTexts: ["thread-1", "thread-2"],
      truncated: false
    });
    expect(result.parentOk).toBe(true);
    expect(result.threadSent).toBe(1);
    expect(result.threadFailed).toBe(1);
  });
});

describe("buildCalendarDmAckMessage", () => {
  it("returns result-specific ack text", () => {
    expect(
      buildCalendarDmAckMessage({
        parentOk: false,
        threadSent: 0,
        threadFailed: 0,
        truncated: false,
        emptyResult: false
      })
    ).toContain("失敗");
    expect(
      buildCalendarDmAckMessage({
        parentOk: true,
        threadSent: 0,
        threadFailed: 0,
        truncated: false,
        emptyResult: true
      })
    ).toContain("該当なし");
    expect(
      buildCalendarDmAckMessage({
        parentOk: true,
        threadSent: 2,
        threadFailed: 1,
        truncated: false,
        emptyResult: false
      })
    ).toContain("一部の表示に失敗");
    expect(
      buildCalendarDmAckMessage({
        parentOk: true,
        threadSent: 40,
        threadFailed: 0,
        truncated: true,
        emptyResult: false
      })
    ).toContain("省略あり");
  });
});

describe("buildAbsenceCalendarModalView", () => {
  it("stores user and response url in metadata", () => {
    const view = buildAbsenceCalendarModalView({
      userId: "U1",
      responseUrl: "https://hooks.slack.com/commands/1/2/3",
      todayJst: "2026-08-05",
      initialChannelId: "CNOTIFY"
    });
    expect(view.private_metadata).toBe(
      JSON.stringify({
        userId: "U1",
        responseUrl: "https://hooks.slack.com/commands/1/2/3"
      })
    );
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const contextText = (blocks[0]?.elements as Array<Record<string, unknown>> | undefined)?.[0]?.text;
    expect(contextText).toContain("DM");
  });
});

describe("handleAbsenceCalendarInteraction", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-08-05T00:30:00+09:00"));
    openDirectMessageMock.mockClear();
    postChannelMessageMock.mockClear();
    deliverAdminEphemeralReplyMock.mockClear();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("delivers DM calendar and ack ephemeral on submission", async () => {
    const config = createTestConfig(createMockKv());
    await createAbsence(config, {
      itemId: "A1",
      targetUser: "U1",
      startDate: "2026-08-10",
      endDate: "2026-08-10",
      notifyChannels: ["CNOTIFY"],
      notifyUsers: []
    });

    const result = await handleAbsenceCalendarInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({
          userId: "U1",
          responseUrl: "https://hooks.slack.com/commands/1/2/3"
        }),
        state: {
          values: {
            [START_BLOCK_ID]: { start_date: { selected_date: "2026-08-05" } },
            [END_BLOCK_ID]: { end_date: { selected_date: "2026-08-31" } },
            [CHANNEL_BLOCK_ID]: { notify_channel_select: { selected_conversation: "CNOTIFY" } }
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    await result.followUp?.();
    expect(openDirectMessageMock).toHaveBeenCalled();
    expect(postChannelMessageMock).toHaveBeenCalled();
    expect(deliverAdminEphemeralReplyMock).toHaveBeenCalledWith(
      config,
      {
        userId: "U1",
        responseUrl: "https://hooks.slack.com/commands/1/2/3"
      },
      "Bot DM に不在カレンダーを送りました。"
    );
  });
});
