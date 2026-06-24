import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { postChannelMessageMock, postEphemeralMock } = vi.hoisted(() => ({
  postChannelMessageMock: vi.fn(async () => ({ ts: "1.0" })),
  postEphemeralMock: vi.fn(async () => ({}))
}));

vi.mock("./api", () => ({
  slackApi: {
    postChannelMessage: postChannelMessageMock,
    postEphemeral: postEphemeralMock
  }
}));

import { isImChannelId, postUserFacingMessage } from "./user-message";

const baseConfig = createTestConfig(createMockKv(), { adminUserIds: [] });

describe("user-message", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isImChannelId detects DM channel ids", () => {
    expect(isImChannelId("D01234567")).toBe(true);
    expect(isImChannelId("C01234567")).toBe(false);
  });

  it("postUserFacingMessage uses postChannelMessage in IM", async () => {
    const blocks = [{ type: "section", text: { type: "plain_text", text: "hi" } }];
    await postUserFacingMessage(baseConfig, {
      channelId: "D1",
      userId: "U1",
      text: "hello",
      blocks
    });

    expect(postChannelMessageMock).toHaveBeenCalledWith(baseConfig, "D1", "hello", blocks);
    expect(postEphemeralMock).not.toHaveBeenCalled();
  });

  it("postUserFacingMessage uses postEphemeral in channels", async () => {
    await postUserFacingMessage(baseConfig, {
      channelId: "C1",
      userId: "U1",
      text: "hello"
    });

    expect(postEphemeralMock).toHaveBeenCalledWith(baseConfig, "C1", "U1", "hello", undefined);
    expect(postChannelMessageMock).not.toHaveBeenCalled();
  });
});
