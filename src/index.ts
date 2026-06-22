import { getConfig, type Env } from "./config";
import { runDailyNotify } from "./jobs/daily-notify";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
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
      return json({ ok: true, ...result });
    }
    if (pathname === "/run" || pathname === "/health") {
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
