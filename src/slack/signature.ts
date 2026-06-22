const SIGNATURE_VERSION = "v0";
const TIMESTAMP_TOLERANCE_SEC = 60 * 5;

const toHex = (bytes: Uint8Array): string =>
  Array.from(bytes)
    .map((b) => b.toString(16).padStart(2, "0"))
    .join("");

type VerifySlackSignatureInput = {
  signingSecret: string;
  rawBody: string;
  timestampHeader: string | null;
  signatureHeader: string | null;
  nowSec?: number;
};

export const verifySlackSignature = async ({
  signingSecret,
  rawBody,
  timestampHeader,
  signatureHeader,
  nowSec
}: VerifySlackSignatureInput): Promise<boolean> => {
  if (!signingSecret || !timestampHeader || !signatureHeader) return false;
  if (!signatureHeader.startsWith(`${SIGNATURE_VERSION}=`)) return false;

  const ts = Number(timestampHeader);
  if (!Number.isFinite(ts)) return false;

  const now = nowSec ?? Math.floor(Date.now() / 1000);
  if (Math.abs(now - ts) > TIMESTAMP_TOLERANCE_SEC) return false;

  const basestring = `${SIGNATURE_VERSION}:${timestampHeader}:${rawBody}`;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(signingSecret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const digest = await crypto.subtle.sign("HMAC", key, new TextEncoder().encode(basestring));
  const expected = `${SIGNATURE_VERSION}=${toHex(new Uint8Array(digest))}`;
  return expected === signatureHeader;
};
