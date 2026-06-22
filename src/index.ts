import { getConfig, type Env } from "./config";
import { runDailyNotify } from "./jobs/daily-notify";
import {
  COMMAND_ACK_ACCEPTED,
  COMMAND_ACK_UNAUTHORIZED,
  isSlackAdminUser,
  parseSlackCommandPayload,
  runSlackCommandAsync
} from "./slack/command";
import { verifySlackSignature } from "./slack/signature";
import { SLACK_EVENT_DEDUPE_TTL_SEC, isDuplicateSlackEvent } from "./state/event-dedupe";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

const text = (body: string, status = 200): Response =>
  new Response(body, {
    status,
    headers: { "content-type": "text/plain; charset=utf-8" }
  });

const isWeekdayInJst = (): boolean => {
  const weekDayName = new Intl.DateTimeFormat("en-US", {
    timeZone: "Asia/Tokyo",
    weekday: "short"
  }).format(new Date());
  return weekDayName !== "Sat" && weekDayName !== "Sun";
};

const newRunId = (): string => crypto.randomUUID();

const hasValidRunToken = (request: Request, expectedToken: string): boolean => {
  if (!expectedToken) return false;
  const auth = request.headers.get("authorization");
  if (!auth) return false;
  const [scheme, token] = auth.split(" ");
  return scheme === "Bearer" && token === expectedToken;
};

type SlackEventEnvelope = {
  type: string;
  challenge?: string;
  event_id?: string;
  team_id?: string;
  event?: {
    type?: string;
  };
};

const parseSlackEnvelope = (rawBody: string): SlackEventEnvelope | undefined => {
  try {
    return JSON.parse(rawBody) as SlackEventEnvelope;
  } catch {
    return undefined;
  }
};

const handleSlackEventCallback = async (
  config: ReturnType<typeof getConfig>,
  envelope: SlackEventEnvelope
): Promise<void> => {
  const eventId = envelope.event_id ?? "";
  if (eventId) {
    const duplicate = await isDuplicateSlackEvent(config, eventId);
    if (duplicate) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "duplicate_event_dropped",
          event_id: eventId,
          team_id: envelope.team_id ?? "",
          dedupe_ttl_sec: SLACK_EVENT_DEDUPE_TTL_SEC
        })
      );
      return;
    }
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "slack_event_callback_received",
      event_id: envelope.event_id ?? "",
      team_id: envelope.team_id ?? "",
      slack_event_type: envelope.event?.type ?? ""
    })
  );
};

export default {
  async fetch(request: Request, env: Env, ctx: ExecutionContext): Promise<Response> {
    const config = getConfig(env);
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/health" && request.method === "GET") {
      return json({ ok: true });
    }

    if (pathname === "/run" && request.method === "POST") {
      const runId = newRunId();
      if (!hasValidRunToken(request, config.runEndpointToken)) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "run_auth_failed",
            run_id: runId,
            reason: "invalid_or_missing_bearer_token"
          })
        );
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      const result = await runDailyNotify(config, { runId, trigger: "manual" });
      return json({ ok: true, runId: result.runId });
    }

    if (pathname === "/slack/events" && request.method === "POST") {
      const rawBody = await request.text();
      const signatureOk = await verifySlackSignature({
        signingSecret: config.slackSigningSecret,
        rawBody,
        timestampHeader: request.headers.get("x-slack-request-timestamp"),
        signatureHeader: request.headers.get("x-slack-signature")
      });
      if (!signatureOk) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const envelope = parseSlackEnvelope(rawBody);
      if (!envelope?.type) {
        return json({ ok: false, error: "Bad Request" }, 400);
      }
      if (envelope.type === "url_verification" && envelope.challenge) {
        return json({ challenge: envelope.challenge });
      }
      if (envelope.type === "event_callback") {
        ctx.waitUntil(handleSlackEventCallback(config, envelope));
        return json({ ok: true });
      }
      return json({ ok: true });
    }

    if (pathname === "/slack/command" && request.method === "POST") {
      const rawBody = await request.text();
      const signatureOk = await verifySlackSignature({
        signingSecret: config.slackSigningSecret,
        rawBody,
        timestampHeader: request.headers.get("x-slack-request-timestamp"),
        signatureHeader: request.headers.get("x-slack-signature")
      });
      if (!signatureOk) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }

      const payload = parseSlackCommandPayload(rawBody);
      if (!payload) {
        return json({ ok: false, error: "Bad Request" }, 400);
      }
      if (!isSlackAdminUser(config, payload.userId)) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "slash_command_unauthorized_user",
            command: payload.command,
            trigger_id: payload.triggerId,
            user_id: payload.userId,
            team_id: payload.teamId
          })
        );
        return text(COMMAND_ACK_UNAUTHORIZED);
      }

      ctx.waitUntil(runSlackCommandAsync(config, payload));
      return text(COMMAND_ACK_ACCEPTED);
    }

    if (pathname === "/run" || pathname === "/health" || pathname === "/slack/events" || pathname === "/slack/command") {
      return json({ ok: false, error: "Method Not Allowed" }, 405);
    }
    return json({ ok: false, error: "Not Found" }, 404);
  },

  async scheduled(_: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = getConfig(env);
    const runId = newRunId();
    if (!isWeekdayInJst()) {
      console.log(
        JSON.stringify({ level: "info", event: "skip_weekend_scheduled", run_id: runId, trigger: "scheduled" })
      );
      return;
    }
    ctx.waitUntil(runDailyNotify(config, { runId, trigger: "scheduled" }));
  }
};
