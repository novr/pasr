import { getConfig, type Env } from "./config";
import { runDailyNotify } from "./jobs/daily-notify";
import { enqueueAdminTask, processAdminTaskBatch, type AdminTaskMessage } from "./queue/admin-task";
import {
  buildQueuedAdminAck,
  buildQueuedSelfAck,
  COMMAND_ACK_DUPLICATE,
  COMMAND_ACK_ENQUEUE_FAILED,
  COMMAND_ACK_UNAUTHORIZED,
  getCommandKind,
  handleSlackInteraction,
  isSlackAdminUser,
  notifySlashCommandEphemeral,
  parseSlackCommandAction,
  parseSlackCommandPayload,
  resolveSlashCommandDispatch,
  slashCommandLogFields
} from "./slack/command";
import { handleAppMentionEvent } from "./slack/events";
import { debugAbsenceMentionAi } from "./slack/absence-mention-ai";
import { verifySlackSignature } from "./slack/signature";
import { SLACK_EVENT_DEDUPE_TTL_SEC, isDuplicateSlackCommandTrigger, isDuplicateSlackEvent } from "./state/event-dedupe";

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
    user?: string;
    channel?: string;
    thread_ts?: string;
    text?: string;
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

  if (envelope.event?.type === "app_mention") {
    await handleAppMentionEvent(config, envelope);
  }
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

    if (pathname === "/debug/mention-ai" && request.method === "POST") {
      if (!config.debugEndpointsEnabled) {
        return json({ ok: false, error: "Not Found" }, 404);
      }
      if (!hasValidRunToken(request, config.runEndpointToken)) {
        return json({ ok: false, error: "Unauthorized" }, 401);
      }
      let body: { text?: string; todayJst?: string };
      try {
        body = (await request.json()) as { text?: string; todayJst?: string };
      } catch {
        return json({ ok: false, error: "Bad Request" }, 400);
      }
      if (!body.text || body.text.trim().length === 0) {
        return json({ ok: false, error: "text is required" }, 400);
      }
      const result = await debugAbsenceMentionAi(config, {
        text: body.text,
        todayJst: body.todayJst
      });
      return json(result, result.ok ? 200 : 422);
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
      const requiresAdmin = payload.command === "/pasr-admin";
      if (requiresAdmin && !isSlackAdminUser(config, payload.userId)) {
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
      const commandLog = slashCommandLogFields(payload);
      const dispatch = await resolveSlashCommandDispatch(config, payload);
      if (dispatch.mode === "text") {
        console.log(
          JSON.stringify({
            level: "info",
            event: "slash_command_received",
            ...commandLog,
            dispatch: "immediate"
          })
        );
        return text(dispatch.text);
      }

      if (dispatch.mode === "deferred") {
        console.log(
          JSON.stringify({
            level: "info",
            event: "slash_command_received",
            ...commandLog,
            dispatch: "deferred"
          })
        );
        ctx.waitUntil(
          dispatch.run().catch(async (error) => {
            const message = error instanceof Error ? error.message : String(error);
            console.error(
              JSON.stringify({
                level: "error",
                event: "slash_command_deferred_failed",
                ...commandLog,
                message
              })
            );
            await notifySlashCommandEphemeral(
              config,
              payload,
              `処理に失敗しました: ${message}`
            );
          })
        );
        return text(dispatch.ackText);
      }

      console.log(
        JSON.stringify({
          level: "info",
          event: "slash_command_received",
          ...commandLog,
          dispatch: "queue"
        })
      );
      const action = parseSlackCommandAction(payload.text);
      const ack =
        getCommandKind(payload.command) === "self" ? buildQueuedSelfAck() : buildQueuedAdminAck(action);
      ctx.waitUntil(
        (async () => {
          const duplicate = await isDuplicateSlackCommandTrigger(config, payload.triggerId);
          if (duplicate) {
            console.warn(
              JSON.stringify({
                level: "warn",
                event: "duplicate_command_dropped",
                trigger_id: payload.triggerId,
                user_id: payload.userId,
                team_id: payload.teamId,
                dedupe_ttl_sec: SLACK_EVENT_DEDUPE_TTL_SEC
              })
            );
            await notifySlashCommandEphemeral(config, payload, COMMAND_ACK_DUPLICATE);
            return;
          }
          try {
            await enqueueAdminTask(env.ADMIN_TASK_QUEUE, payload, { listPrefix: dispatch.listPrefix });
          } catch (error) {
            console.error(
              JSON.stringify({
                level: "error",
                event: "slash_command_enqueue_failed",
                ...commandLog,
                message: error instanceof Error ? error.message : String(error)
              })
            );
            await notifySlashCommandEphemeral(config, payload, COMMAND_ACK_ENQUEUE_FAILED);
          }
        })()
      );
      return text(ack);
    }

    if (pathname === "/slack/interactions" && request.method === "POST") {
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
      const params = new URLSearchParams(rawBody);
      const payloadRaw = params.get("payload");
      if (!payloadRaw) {
        return json({ ok: false, error: "Bad Request" }, 400);
      }
      let payload: unknown;
      try {
        payload = JSON.parse(payloadRaw);
      } catch {
        return json({ ok: false, error: "Bad Request" }, 400);
      }
      const handled = await handleSlackInteraction(config, payload as Parameters<typeof handleSlackInteraction>[1]);
      if (!handled.ok) {
        return json({
          response_action: "errors",
          errors: {
            [handled.errorBlockId ?? "start_block"]: handled.error ?? "更新に失敗しました。"
          }
        });
      }
      if (handled.followUp) {
        ctx.waitUntil(handled.followUp());
      }
      if (payload && typeof payload === "object" && (payload as { type?: string }).type === "block_actions") {
        return new Response("", { status: 200 });
      }
      return json({ response_action: "clear" });
    }

    if (
      pathname === "/run" ||
      pathname === "/health" ||
      pathname === "/debug/mention-ai" ||
      pathname === "/slack/events" ||
      pathname === "/slack/command" ||
      pathname === "/slack/interactions"
    ) {
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
  },

  async queue(batch: MessageBatch<AdminTaskMessage>, env: Env): Promise<void> {
    await processAdminTaskBatch(getConfig(env), batch);
  }
};
