import { getConfig, type Env } from "./config";
import { runDailyNotify } from "./jobs/daily-notify";
import { runSetup } from "./jobs/setup";

const json = (body: unknown, status = 200): Response =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8" }
  });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = getConfig(env);
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/setup") {
      const setup = await runSetup(config);
      return json({ ok: true, ...setup });
    }
    if (pathname === "/run-daily") {
      const forceRun = url.searchParams.get("force") === "true";
      const result = await runDailyNotify(config, { forceRun });
      return json({ ok: true, ...result });
    }
    return json({ ok: false, error: "Not Found" }, 404);
  },

  async scheduled(_: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = getConfig(env);
    ctx.waitUntil(runDailyNotify(config));
  }
};
