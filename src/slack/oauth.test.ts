import { describe, expect, it, vi, beforeEach, afterEach } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import { handleOAuthCallback, handleOAuthStart } from "./oauth";
import { issueOAuthState } from "./oauth-state";

const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(3)));

describe("oauth handlers", () => {
  const config = createTestConfig(createMockKv(), {
    db: createMockD1(),
    slackClientId: "C123",
    slackClientSecret: "secret",
    slackOauthEncryptionKey: TEST_KEY_B64
  });

  beforeEach(() => {
    vi.stubGlobal("fetch", vi.fn());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("rejects start without state", async () => {
    const res = await handleOAuthStart(
      new Request("https://worker.example/slack/oauth/start"),
      config
    );
    expect(res.status).toBe(400);
  });

  it("redirects start with valid state", async () => {
    const nonce = await issueOAuthState(config.stateKv, "U1");
    const res = await handleOAuthStart(
      new Request(`https://worker.example/slack/oauth/start?state=${nonce}`),
      config
    );
    expect(res.status).toBe(302);
    const location = res.headers.get("location") ?? "";
    expect(location.startsWith("https://slack.com/oauth/v2/authorize")).toBe(true);
    expect(location).toContain("user_scope=users.profile%3Awrite");
  });

  it("rejects callback when authed user mismatches", async () => {
    const nonce = await issueOAuthState(config.stateKv, "U_EXPECTED");
    vi.mocked(fetch).mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          ok: true,
          authed_user: {
            id: "U_OTHER",
            access_token: "xoxp-test",
            scope: "users.profile:write"
          }
        }),
        { status: 200 }
      )
    );
    const res = await handleOAuthCallback(
      new Request(
        `https://worker.example/slack/oauth/callback?code=abc&state=${nonce}`
      ),
      config
    );
    expect(res.status).toBe(400);
    expect(res.headers.get("cache-control")).toBe("no-store");
  });
});
