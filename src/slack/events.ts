import type { AppConfig } from "../config";
import { ABSENCE_REGISTER_OPEN_ACTION_ID } from "./absence-register";
import { slackApi } from "./api";

type AppMentionEvent = {
  type?: string;
  user?: string;
  channel?: string;
  thread_ts?: string;
};

type SlackEventEnvelope = {
  event_id?: string;
  team_id?: string;
  event?: AppMentionEvent;
};

export const handleAppMentionEvent = async (
  config: AppConfig,
  envelope: SlackEventEnvelope
): Promise<void> => {
  const event = envelope.event;
  if (event?.type !== "app_mention") return;

  const userId = event.user ?? "";
  const channelId = event.channel ?? "";
  const hasThreadTs = Boolean(event.thread_ts);

  console.log(
    JSON.stringify({
      level: "info",
      event: "app_mention_received",
      event_id: envelope.event_id ?? "",
      team_id: envelope.team_id ?? "",
      user_id: userId,
      channel_id: channelId,
      has_thread_ts: hasThreadTs
    })
  );

  if (!userId || !channelId) return;

  if (hasThreadTs) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "app_mention_thread_skipped",
        event_id: envelope.event_id ?? "",
        user_id: userId,
        channel_id: channelId,
        thread_ts: event.thread_ts ?? ""
      })
    );
    return;
  }

  await slackApi.postEphemeral(
    config,
    channelId,
    userId,
    "不在を登録する場合は下のボタンを押してください。",
    [
      {
        type: "actions",
        block_id: "pasr_register_actions",
        elements: [
          {
            type: "button",
            action_id: ABSENCE_REGISTER_OPEN_ACTION_ID,
            text: { type: "plain_text", text: "不在を登録" },
            style: "primary"
          }
        ]
      }
    ]
  );
};
