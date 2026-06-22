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

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const config = getConfig(env);
    const url = new URL(request.url);
    const { pathname } = url;
    if (pathname === "/run") {
      const result = await runDailyNotify(config);
      return json({ ok: true, ...result });
    }
    return json({ ok: false, error: "Not Found" }, 404);
  },

  async scheduled(_: ScheduledController, env: Env, ctx: ExecutionContext): Promise<void> {
    const config = getConfig(env);
    if (!isWeekdayInJst()) {
      console.log(JSON.stringify({ level: "info", event: "skip_weekend_scheduled" }));
      return;
    }
    ctx.waitUntil(runDailyNotify(config));
  }
};
