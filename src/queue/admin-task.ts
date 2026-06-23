import type { AppConfig } from "../config";
import { runSlackCommandAsync, slashCommandLogFields, type SlackCommandPayload } from "../slack/command";

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
    await runSlackCommandAsync(config, message.body.payload);
    message.ack();
    console.log(
      JSON.stringify({
        level: "info",
        event: "slash_command_queue_consumer_done",
        ...fields
      })
    );
  }
};
