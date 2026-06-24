import type { DebugMentionAiResult } from "../slack/absence-mention-ai";

export type MentionAiIntegrationEnv = {
  baseUrl: string;
  token: string;
  todayJst?: string;
};

export const readMentionAiIntegrationEnv = (): MentionAiIntegrationEnv => ({
  baseUrl: (process.env.PASR_DEV_URL ?? "http://localhost:8787").replace(/\/$/, ""),
  token: process.env.RUN_ENDPOINT_TOKEN ?? "",
  todayJst: process.env.PASR_TODAY_JST
});

export const isMentionAiIntegrationEnabled = (): boolean => process.env.PASR_RUN_INTEGRATION === "1";

export const isMentionAiIntegrationReady = async (): Promise<{ ready: boolean; reason?: string }> => {
  if (!isMentionAiIntegrationEnabled()) {
    return { ready: false, reason: "PASR_RUN_INTEGRATION is not set to 1" };
  }
  const { baseUrl, token } = readMentionAiIntegrationEnv();
  if (!token) {
    return { ready: false, reason: "RUN_ENDPOINT_TOKEN is not set" };
  }
  try {
    const response = await fetch(`${baseUrl}/health`);
    if (!response.ok) {
      return {
        ready: false,
        reason: `health returned ${response.status} at ${baseUrl} (start npm run dev and ensure port is free)`
      };
    }
    return { ready: true };
  } catch {
    return { ready: false, reason: `dev server not reachable at ${baseUrl} (run: npm run dev)` };
  }
};

export type MentionAiDebugCallResult = {
  status: number;
  body: DebugMentionAiResult;
};

export const callDebugMentionAi = async (params: {
  text: string;
  todayJst?: string;
}): Promise<MentionAiDebugCallResult> => {
  const { baseUrl, token, todayJst: envTodayJst } = readMentionAiIntegrationEnv();
  const todayJst = params.todayJst ?? envTodayJst;
  const response = await fetch(`${baseUrl}/debug/mention-ai`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${token}`,
      "content-type": "application/json"
    },
    body: JSON.stringify({
      text: params.text,
      ...(todayJst ? { todayJst } : {})
    })
  });
  const body = (await response.json()) as DebugMentionAiResult;
  return { status: response.status, body };
};
