const OAUTH_STATE_TTL_SEC = 60 * 5;
const OAUTH_STATE_PREFIX = "slack:oauth:state:";

export type OAuthStatePayload = {
  userId: string;
};

const oauthStateKey = (nonce: string): string => `${OAUTH_STATE_PREFIX}${nonce}`;

export const issueOAuthState = async (stateKv: KVNamespace, userId: string): Promise<string> => {
  const nonce = crypto.randomUUID();
  const payload: OAuthStatePayload = { userId };
  await stateKv.put(oauthStateKey(nonce), JSON.stringify(payload), {
    expirationTtl: OAUTH_STATE_TTL_SEC
  });
  return nonce;
};

export const readOAuthState = async (
  stateKv: KVNamespace,
  nonce: string
): Promise<OAuthStatePayload | null> => {
  if (!nonce || nonce.trim().length === 0) return null;
  const raw = await stateKv.get(oauthStateKey(nonce));
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw) as Partial<OAuthStatePayload>;
    if (typeof parsed.userId !== "string" || parsed.userId.length === 0) return null;
    return { userId: parsed.userId };
  } catch {
    return null;
  }
};

export const consumeOAuthState = async (
  stateKv: KVNamespace,
  nonce: string
): Promise<OAuthStatePayload | null> => {
  const payload = await readOAuthState(stateKv, nonce);
  if (!payload) return null;
  await stateKv.delete(oauthStateKey(nonce));
  return payload;
};

export const buildOAuthStartUrl = (publicBaseUrl: string, nonce: string): string => {
  const base = publicBaseUrl.replace(/\/$/, "");
  return `${base}/slack/oauth/start?state=${encodeURIComponent(nonce)}`;
};
