import { describe, expect, it } from "vitest";
import { createTestConfig, createMockKv } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import {
  decryptSlackUserAccessToken,
  getSlackUserOAuth,
  listSlackUserOAuthForUserIds,
  upsertSlackUserOAuth
} from "./slack-user-oauth-repository";

const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(9)));

describe("slack-user-oauth-repository", () => {
  const config = createTestConfig(createMockKv(), {
    db: createMockD1(),
    slackOauthEncryptionKey: TEST_KEY_B64
  });

  it("upserts and reads encrypted token", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U1",
      accessToken: "xoxp-secret",
      scope: "users.profile:write"
    });
    const row = await getSlackUserOAuth(config, "U1");
    expect(row?.userId).toBe("U1");
    expect(row?.scope).toBe("users.profile:write");
    const plain = await decryptSlackUserAccessToken(config, row!);
    expect(plain).toBe("xoxp-secret");
  });

  it("lists tokens for user ids", async () => {
    await upsertSlackUserOAuth(config, {
      userId: "U2",
      accessToken: "xoxp-2",
      scope: "users.profile:write"
    });
    const map = await listSlackUserOAuthForUserIds(config, ["U2", "U_MISSING"]);
    expect(map.size).toBe(1);
    expect(map.has("U2")).toBe(true);
  });
});
