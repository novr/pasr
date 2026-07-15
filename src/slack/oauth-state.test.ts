import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { consumeOAuthState, issueOAuthState, readOAuthState } from "./oauth-state";

describe("oauth-state", () => {
  it("issues and consumes state once", async () => {
    const kv = createMockKv();
    const nonce = await issueOAuthState(kv, "U1");
    const payload = await consumeOAuthState(kv, nonce);
    expect(payload).toEqual({ userId: "U1" });
    const again = await readOAuthState(kv, nonce);
    expect(again).toBeNull();
  });

  it("returns null for missing state", async () => {
    const kv = createMockKv();
    expect(await consumeOAuthState(kv, "missing")).toBeNull();
  });
});
