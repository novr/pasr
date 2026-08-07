import { fetchBuildLogs, fetchBuildUrls } from "./api";
import { getBuildStatus, isPasrBuildEvent } from "./helpers";
import { buildSlackPayload, sendSlackNotification } from "./slack";
import { PASR_WORKER_NAME, type CloudflareEvent, type Env } from "./types";

const logDelivery = (event: CloudflareEvent, method: string): void => {
  console.log(
    JSON.stringify({
      level: "info",
      event: "build_notify_sent",
      worker_name: PASR_WORKER_NAME,
      build_uuid: event.payload.buildUuid,
      build_type: event.type,
      method
    })
  );
};

export default {
  async queue(batch: MessageBatch<CloudflareEvent>, env: Env): Promise<void> {
    if (!env.SLACK_WEBHOOK_URL) {
      console.warn(JSON.stringify({ level: "warn", event: "build_notify_missing_webhook" }));
      for (const message of batch.messages) {
        message.retry();
      }
      return;
    }

    for (const message of batch.messages) {
      try {
        const event = message.body;
        if (!event?.type || !event?.payload || !event?.metadata) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "build_notify_invalid_event",
              body: JSON.stringify(event).slice(0, 500)
            })
          );
          message.ack();
          continue;
        }

        if (!isPasrBuildEvent(event)) {
          message.ack();
          continue;
        }

        if (event.type.includes("started") || event.type.includes("queued")) {
          message.ack();
          continue;
        }

        const status = getBuildStatus(event);
        let previewUrl: string | null = null;
        let liveUrl: string | null = null;
        let logs: string[] = [];

        if (status.isSucceeded) {
          ({ previewUrl, liveUrl } = await fetchBuildUrls(event, env));
        } else if (status.isFailed && !status.isCancelled) {
          logs = await fetchBuildLogs(event, env);
        }

        const payload = buildSlackPayload(event, previewUrl, liveUrl, logs);
        const sent = await sendSlackNotification(env.SLACK_WEBHOOK_URL, payload);
        if (!sent) {
          message.retry();
          continue;
        }

        logDelivery(event, "slack_webhook");
        message.ack();
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "build_notify_process_failed",
            message: error instanceof Error ? error.message : String(error)
          })
        );
        message.retry();
      }
    }
  }
} satisfies ExportedHandler<Env, CloudflareEvent>;
