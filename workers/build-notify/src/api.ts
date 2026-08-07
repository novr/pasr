import type {
  BuildDetailsResponse,
  CloudflareEvent,
  Env,
  LogsResponse,
  SubdomainResponse
} from "./types";

const MAX_LOG_PAGES = 50;

export const fetchBuildUrls = async (
  event: CloudflareEvent,
  env: Env
): Promise<{ previewUrl: string | null; liveUrl: string | null }> => {
  const workerName = event.source?.workerName;
  const accountId = event.metadata.accountId;
  if (!workerName || !accountId || !env.CLOUDFLARE_API_TOKEN) {
    return { previewUrl: null, liveUrl: null };
  }

  try {
    const buildRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${event.payload.buildUuid}`,
      { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
    );
    if (!buildRes.ok) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "build_notify_fetch_build_failed",
          status: buildRes.status,
          build_uuid: event.payload.buildUuid
        })
      );
      return { previewUrl: null, liveUrl: null };
    }
    const buildData = (await buildRes.json()) as BuildDetailsResponse;
    if (buildData.result?.preview_url) {
      return { previewUrl: buildData.result.preview_url, liveUrl: null };
    }

    const subRes = await fetch(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/workers/subdomain`,
      { headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` } }
    );
    const subData = (await subRes.json()) as SubdomainResponse;
    if (subData.result?.subdomain) {
      return {
        previewUrl: null,
        liveUrl: `https://${workerName}.${subData.result.subdomain}.workers.dev`
      };
    }
  } catch (error) {
    console.error("Failed to fetch URLs:", error);
  }

  return { previewUrl: null, liveUrl: null };
};

export const fetchBuildLogs = async (event: CloudflareEvent, env: Env): Promise<string[]> => {
  const accountId = event.metadata.accountId;
  if (!accountId || !env.CLOUDFLARE_API_TOKEN) return [];

  const logs: string[] = [];
  try {
    let cursor: string | null = null;
    let pageCount = 0;
    do {
      const endpoint = `https://api.cloudflare.com/client/v4/accounts/${accountId}/builds/builds/${event.payload.buildUuid}/logs${cursor ? `?cursor=${cursor}` : ""}`;
      const res = await fetch(endpoint, {
        headers: { Authorization: `Bearer ${env.CLOUDFLARE_API_TOKEN}` }
      });
      if (!res.ok) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "build_notify_fetch_logs_failed",
            status: res.status,
            build_uuid: event.payload.buildUuid
          })
        );
        break;
      }
      const data = (await res.json()) as LogsResponse;
      if (data.result?.lines?.length) {
        logs.push(...data.result.lines.map((line) => line[1]));
      }
      cursor = data.result?.truncated ? (data.result.cursor ?? null) : null;
      pageCount += 1;
    } while (cursor && pageCount < MAX_LOG_PAGES);
  } catch (error) {
    console.error("Failed to fetch logs:", error);
  }

  return logs;
};
