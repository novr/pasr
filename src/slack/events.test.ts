import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { postEphemeralMock } = vi.hoisted(() => ({
  postEphemeralMock: vi.fn(async () => ({}))
}));

vi.mock("./api", () => ({
  slackApi: {
    postEphemeral: postEphemeralMock
  }
}));

import { handleAppMentionEvent, shouldProcessDirectMessage } from "./events";

const baseConfig = createTestConfig(createMockKv(), { adminUserIds: [] });

describe("shouldProcessDirectMessage", () => {
  const baseEvent = {
    type: "message",
    channel_type: "im",
    user: "U1",
    channel: "D1"
  } as const;

  it("accepts user messages and rejects bot or subtype messages", () => {
    expect(shouldProcessDirectMessage({ ...baseEvent, text: "明日 通院" })).toBe(true);
    expect(shouldProcessDirectMessage({ ...baseEvent, subtype: "message_changed", text: "x" })).toBe(
      false
    );
    expect(shouldProcessDirectMessage({ ...baseEvent, bot_id: "B1", text: "x" })).toBe(false);
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
