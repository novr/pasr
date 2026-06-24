import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";

const { postEphemeralMock } = vi.hoisted(() => ({
  postEphemeralMock: vi.fn(async () => ({}))
}));

const { handleAppMentionWithTextMock, postMentionRegisterButtonMock } = vi.hoisted(() => ({
  handleAppMentionWithTextMock: vi.fn(async () => undefined),
  postMentionRegisterButtonMock: vi.fn(async () => undefined)
}));

vi.mock("./api", () => ({
  slackApi: {
    postEphemeral: postEphemeralMock
  }
}));

vi.mock("./absence-mention", () => ({
  handleAppMentionWithText: handleAppMentionWithTextMock,
  postMentionRegisterButton: postMentionRegisterButtonMock
}));

import {
  handleAppMentionEvent,
  handleDirectMessageEvent,
  shouldProcessDirectMessage
} from "./events";

const baseConfig = {
  stateKv: {} as KVNamespace,
  runEndpointToken: "",
  debugEndpointsEnabled: false,
  slackBotToken: "xoxb-test",
  slackSigningSecret: "secret",
  timezone: "Asia/Tokyo",
  adminUserIds: [],
  listAccessChannelIds: []
} satisfies AppConfig;

describe("shouldProcessDirectMessage", () => {
  it("accepts user messages without subtype or bot_id", () => {
    expect(
      shouldProcessDirectMessage({
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        text: "明日 通院"
      })
    ).toBe(true);
  });

  it("rejects bot and subtype messages", () => {
    expect(
      shouldProcessDirectMessage({
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        subtype: "message_changed",
        text: "x"
      })
    ).toBe(false);
    expect(
      shouldProcessDirectMessage({
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        bot_id: "B1",
        text: "x"
      })
    ).toBe(false);
  });
});

describe("handleAppMentionEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("posts guidance ephemeral for thread mentions", async () => {
    await handleAppMentionEvent(baseConfig, {
      event_id: "E1",
      event: {
        type: "app_mention",
        user: "U1",
        channel: "C1",
        thread_ts: "123.456",
        text: "<@UBOT> 明日 通院"
      }
    });

    expect(postEphemeralMock).toHaveBeenCalledWith(
      baseConfig,
      "C1",
      "U1",
      "スレッド内では利用できません。チャンネル直下で @PASR をメンションしてください。"
    );
  });
});

const parseStructuredLogs = (spy: ReturnType<typeof vi.spyOn>): Array<Record<string, unknown>> =>
  spy.mock.calls
    .map((call) => {
      try {
        return JSON.parse(String(call[0])) as Record<string, unknown>;
      } catch {
        return null;
      }
    })
    .filter((entry): entry is Record<string, unknown> => entry !== null);

describe("handleDirectMessageEvent", () => {
  let logSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    vi.clearAllMocks();
    logSpy = vi.spyOn(console, "log").mockImplementation(() => undefined);
  });

  afterEach(() => {
    logSpy.mockRestore();
  });

  it("logs dm_message_received for user text DM", async () => {
    await handleDirectMessageEvent(baseConfig, {
      event_id: "E2",
      team_id: "T1",
      event: {
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        text: "明日 通院"
      }
    });

    expect(parseStructuredLogs(logSpy)).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "dm_message_received",
        event_id: "E2",
        team_id: "T1",
        user_id: "U1",
        channel_id: "D1"
      })
    );
  });

  it("logs dm_message_skipped for bot messages", async () => {
    await handleDirectMessageEvent(baseConfig, {
      event_id: "E3",
      team_id: "T1",
      event: {
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        bot_id: "B1",
        text: "reply"
      }
    });

    expect(parseStructuredLogs(logSpy)).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "dm_message_skipped",
        event_id: "E3",
        team_id: "T1",
        user_id: "U1",
        channel_id: "D1",
        subtype: "",
        has_bot_id: true
      })
    );
  });

  it("logs dm_message_skipped for subtype messages", async () => {
    await handleDirectMessageEvent(baseConfig, {
      event_id: "E4",
      event: {
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        subtype: "message_changed",
        text: "x"
      }
    });

    expect(parseStructuredLogs(logSpy)).toContainEqual(
      expect.objectContaining({
        level: "info",
        event: "dm_message_skipped",
        event_id: "E4",
        subtype: "message_changed",
        has_bot_id: false
      })
    );
  });

  it("delegates text DM to handleAppMentionWithText", async () => {
    await handleDirectMessageEvent(baseConfig, {
      event_id: "E2",
      event: {
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        text: "明日 通院"
      }
    });

    expect(handleAppMentionWithTextMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        event_id: "E2",
        event: expect.objectContaining({ channel: "D1", text: "明日 通院" })
      })
    );
  });

  it("shows register button for empty DM text", async () => {
    await handleDirectMessageEvent(baseConfig, {
      event: {
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        text: "   "
      }
    });

    expect(postMentionRegisterButtonMock).toHaveBeenCalledWith(baseConfig, "D1", "U1");
    expect(handleAppMentionWithTextMock).not.toHaveBeenCalled();
  });

  it("skips bot messages", async () => {
    await handleDirectMessageEvent(baseConfig, {
      event: {
        type: "message",
        channel_type: "im",
        user: "U1",
        channel: "D1",
        bot_id: "B1",
        text: "reply"
      }
    });

    expect(handleAppMentionWithTextMock).not.toHaveBeenCalled();
    expect(postMentionRegisterButtonMock).not.toHaveBeenCalled();
  });
});
