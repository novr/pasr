import type { AppConfig } from "../config";
import { handleAppMentionWithText, type MentionRequestEnvelope } from "./absence-mention";
import { slackApi } from "./api";

const THREAD_MENTION_GUIDANCE =
  "スレッド内では利用できません。チャンネル直下で @PASR をメンションしてください。";

type AppMentionEvent = {
  type?: string;
  user?: string;
  channel?: string;
  thread_ts?: string;
  text?: string;
};

type DirectMessageEvent = {
  type?: string;
  subtype?: string;
  user?: string;
  bot_id?: string;
  channel?: string;
  channel_type?: string;
  text?: string;
};

type AppHomeOpenedEvent = {
  type?: string;
  user?: string;
  channel?: string;
  tab?: string;
};

export type SlackEventEnvelope = {
  event_id?: string;
  team_id?: string;
  event?: AppMentionEvent | DirectMessageEvent | AppHomeOpenedEvent;
};

const isDirectMessageEvent = (event: AppMentionEvent | DirectMessageEvent | undefined): event is DirectMessageEvent =>
  event?.type === "message" && (event as DirectMessageEvent).channel_type === "im";

export const shouldProcessDirectMessage = (event: DirectMessageEvent): boolean => {
  if (event.subtype) return false;
  if (event.bot_id) return false;
  if (!event.user || !event.channel) return false;
  return true;
};

export const handleAppMentionEvent = async (
  config: AppConfig,
  envelope: SlackEventEnvelope
): Promise<void> => {
  const event = envelope.event;
  if (event?.type !== "app_mention") return;

  const mentionEvent = event as AppMentionEvent;
  const userId = mentionEvent.user ?? "";
  const channelId = mentionEvent.channel ?? "";
  const hasThreadTs = Boolean(mentionEvent.thread_ts);

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
        thread_ts: mentionEvent.thread_ts ?? ""
      })
    );
    await slackApi.postEphemeral(config, channelId, userId, THREAD_MENTION_GUIDANCE);
    return;
  }

  await handleAppMentionWithText(config, envelope as MentionRequestEnvelope);
};

export const handleDirectMessageEvent = async (
  config: AppConfig,
  envelope: SlackEventEnvelope
): Promise<void> => {
  const event = envelope.event;
  if (!isDirectMessageEvent(event)) return;

  const userId = event.user ?? "";
  const channelId = event.channel ?? "";

  if (!shouldProcessDirectMessage(event)) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "dm_message_skipped",
        event_id: envelope.event_id ?? "",
        team_id: envelope.team_id ?? "",
        user_id: userId,
        channel_id: channelId,
        subtype: event.subtype ?? "",
        has_bot_id: Boolean(event.bot_id)
      })
    );
    return;
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "dm_message_received",
      event_id: envelope.event_id ?? "",
      team_id: envelope.team_id ?? "",
      user_id: userId,
      channel_id: channelId
    })
  );

  await handleAppMentionWithText(config, envelope as MentionRequestEnvelope);
};
