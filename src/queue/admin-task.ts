import type { AppConfig } from "../config";
import { isTransientError } from "../errors/transient";
import { runSlackCommandAsync, slashCommandLogFields, notifySlashCommandEphemeral, type SlackCommandPayload } from "../slack/command";

export type AdminTaskMessage = {
  payload: SlackCommandPayload;
};

export const enqueueAdminTask = async (
  queue: Queue<AdminTaskMessage>,
  payload: SlackCommandPayload
): Promise<void> => {
  await queue.send({ payload });
};

export const processAdminTaskBatch = async (
  config: AppConfig,
  batch: MessageBatch<AdminTaskMessage>
): Promise<void> => {
  for (const message of batch.messages) {
    const fields = slashCommandLogFields(message.body.payload);
    console.log(
      JSON.stringify({
        level: "info",
        event: "slash_command_queue_consumer_started",
        ...fields
      })
    );
    try {
      await runSlackCommandAsync(config, message.body.payload);
      message.ack();
      console.log(
        JSON.stringify({
          level: "info",
          event: "slash_command_queue_consumer_done",
          ...fields
        })
      );
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      if (isTransientError(error)) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "slash_command_queue_retry",
            ...fields,
            message: errorMessage
          })
        );
        message.retry();
        continue;
      }
      console.error(
        JSON.stringify({
          level: "error",
          event: "slash_command_queue_failed",
          ...fields,
          message: errorMessage
        })
      );
      await notifySlashCommandEphemeral(
        config,
        message.body.payload,
        `処理に失敗しました: ${errorMessage}`
      );
      message.ack();
    }
  }
};
