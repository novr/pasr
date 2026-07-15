import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import { upsertSlackUserOAuth } from "../db/slack-user-oauth-repository";
import {
  buildAppHomeStatusOAuthBlock,
  handleStatusOAuthDisconnectAction,
  STATUS_OAUTH_DISCONNECT_ACTION_ID,
  STATUS_OAUTH_DISCONNECT_CONFIRM_ACTION_ID
} from "./status-oauth-ui";

const { postUserFacingMessageMock, refreshAppHomeAfterMutationMock } = vi.hoisted(() => ({
  postUserFacingMessageMock: vi.fn(async () => undefined),
  refreshAppHomeAfterMutationMock: vi.fn(async () => undefined)
}));

vi.mock("./user-message", () => ({
  postUserFacingMessage: postUserFacingMessageMock
}));

vi.mock("./app-home-publish", () => ({
  refreshAppHomeAfterMutation: refreshAppHomeAfterMutationMock
}));

vi.mock("./app-home-channel", () => ({
  resolveAppHomeDmChannelId: vi.fn(async (_config, _userId, channelId?: string) => channelId ?? "D_OPENED")
}));

const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(5)));

describe("status oauth disconnect", () => {
  const config = createTestConfig(createMockKv(), {
    db: createMockD1(),
    slackOauthEncryptionKey: TEST_KEY_B64
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("{}", { status: 200 })));
    postUserFacingMessageMock.mockClear();
    refreshAppHomeAfterMutationMock.mockClear();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("deletes only interaction user token on confirm", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U_OWNER",
      accessToken: "xoxp-owner",
      scope: "users.profile:write"
    });
    await upsertSlackUserOAuth(config, {
      userId: "U_OTHER",
      accessToken: "xoxp-other",
      scope: "users.profile:write"
    });

    const result = await handleStatusOAuthDisconnectAction(config, {
      actionId: STATUS_OAUTH_DISCONNECT_CONFIRM_ACTION_ID,
      userId: "U_OWNER",
      channelId: "C1"
    });
    expect(result.handled).toBe(true);
    await result.followUp?.();

    const { getSlackUserOAuth } = await import("../db/slack-user-oauth-repository");
    expect(await getSlackUserOAuth(config, "U_OWNER")).toBeNull();
    expect(await getSlackUserOAuth(config, "U_OTHER")).not.toBeNull();
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(config, "U_OWNER");
  });

  it("shows confirm UI via DM when App Home has no channel", async () => {
    const result = await handleStatusOAuthDisconnectAction(config, {
      actionId: STATUS_OAUTH_DISCONNECT_ACTION_ID,
      userId: "U_OWNER"
    });
    expect(result.handled).toBe(true);
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      config,
      expect.objectContaining({
        channelId: "D_OPENED",
        userId: "U_OWNER",
        blocks: expect.arrayContaining([
          expect.objectContaining({
            elements: expect.arrayContaining([
              expect.objectContaining({ action_id: STATUS_OAUTH_DISCONNECT_CONFIRM_ACTION_ID })
            ])
          })
        ])
      })
    );
  });

  it("linked App Home block keeps status text with disconnect accessory", () => {
    const block = buildAppHomeStatusOAuthBlock({ linked: true });
    expect(block).toEqual(
      expect.objectContaining({
        type: "section",
        text: expect.objectContaining({
          text: expect.stringContaining("連携済み")
        }),
        accessory: expect.objectContaining({
          action_id: STATUS_OAUTH_DISCONNECT_ACTION_ID
        })
      })
    );
  });
});
