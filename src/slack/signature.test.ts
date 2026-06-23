import { describe, expect, it } from "vitest";
import { verifySlackSignature } from "./signature";

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

const sign = async (secret: string, timestamp: string, body: string): Promise<string> => {
  const basestring = `v0:${timestamp}:${body}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring));
  return `v0=${toHex(new Uint8Array(digest))}`;
};

describe("verifySlackSignature", () => {
  const secret = "test-signing-secret";
  const body = "command=%2Fpasr&text=help";
  const nowSec = 1_700_000_000;

  it("accepts valid signature", async () => {
    const timestamp = String(nowSec);
    const signature = await sign(secret, timestamp, body);
    await expect(
      verifySlackSignature({
        signingSecret: secret,
        rawBody: body,
        timestampHeader: timestamp,
        signatureHeader: signature,
        nowSec
      })
    ).resolves.toBe(true);
  });

  it("rejects missing headers", async () => {
    await expect(
      verifySlackSignature({
        signingSecret: secret,
        rawBody: body,
        timestampHeader: null,
        signatureHeader: null,
        nowSec
      })
    ).resolves.toBe(false);
  });

  it("rejects expired timestamp", async () => {
    const timestamp = String(nowSec - 60 * 6);
    const signature = await sign(secret, timestamp, body);
    await expect(
      verifySlackSignature({
        signingSecret: secret,
        rawBody: body,
        timestampHeader: timestamp,
        signatureHeader: signature,
        nowSec
      })
    ).resolves.toBe(false);
  });

  it("rejects invalid signature", async () => {
    await expect(
      verifySlackSignature({
        signingSecret: secret,
        rawBody: body,
        timestampHeader: String(nowSec),
        signatureHeader: "v0=deadbeef",
        nowSec
      })
    ).resolves.toBe(false);
  });
});
