import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";

const { postEphemeralMock } = vi.hoisted(() => ({
  postEphemeralMock: vi.fn(async () => ({}))
}));

vi.mock("./api", () => ({
  slackApi: {
    postEphemeral: postEphemeralMock
  }
}));

import { handleAppMentionEvent, shouldProcessDirectMessage } from "./events";

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
