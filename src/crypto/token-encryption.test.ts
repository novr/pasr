import { describe, expect, it } from "vitest";
import { encryptToken, decryptToken } from "./token-encryption";

const TEST_KEY_B64 = btoa(String.fromCharCode(...new Uint8Array(32).fill(7)));

describe("token-encryption", () => {
  it("round-trips token", async () => {
    const plain = "xoxp-test-token-value";
    const enc = await encryptToken(plain, TEST_KEY_B64);
    const dec = await decryptToken(enc, TEST_KEY_B64);
    expect(dec).toBe(plain);
    expect(enc).not.toContain(plain);
  });

  it("rejects invalid key length", async () => {
    const shortKey = btoa("short");
    await expect(encryptToken("xoxp-test", shortKey)).rejects.toThrow("encryption_key_invalid_length");
  });
});
