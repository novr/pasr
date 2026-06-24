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
    const health = await fetch(`${baseUrl}/health`);
    if (!health.ok) {
      return {
        ready: false,
        reason: `health returned ${health.status} at ${baseUrl} (start npm run dev and ensure port is free)`
      };
    }

    const debug = await fetch(`${baseUrl}/debug/mention-ai`, {
      method: "POST",
      headers: {
        authorization: `Bearer ${token}`,
        "content-type": "application/json"
      },
      body: JSON.stringify({ text: "integration probe", todayJst: "2099-01-01" })
    });
    if (debug.status === 404) {
      return {
        ready: false,
        reason: [
          `POST /debug/mention-ai returned 404 at ${baseUrl}.`,
          "1) Add DEBUG_ENDPOINTS_ENABLED=true to .dev.vars and restart npm run dev",
          "2) Stop stale wrangler on port 8787 (integration tests default to http://localhost:8787)",
          "3) If dev runs on another port, set PASR_DEV_URL (e.g. PASR_DEV_URL=http://localhost:8788)"
        ].join(" ")
      };
    }
    if (debug.status === 401) {
      return {
        ready: false,
        reason: "POST /debug/mention-ai returned 401. RUN_ENDPOINT_TOKEN must match between .dev.vars and wrangler dev"
      };
    }
    if (debug.status !== 200 && debug.status !== 422) {
      return {
        ready: false,
        reason: `POST /debug/mention-ai returned ${debug.status} at ${baseUrl}`
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
