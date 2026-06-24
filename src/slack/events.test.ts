import { beforeEach, describe, expect, it, vi } from "vitest";
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

describe("handleDirectMessageEvent", () => {
  beforeEach(() => {
    vi.clearAllMocks();
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
