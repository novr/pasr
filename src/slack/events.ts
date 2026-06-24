import type { AppConfig } from "../config";
import { stripAppMentionText } from "../domain/absence-mention-parse";
import { handleAppMentionWithText, postMentionRegisterButton } from "./absence-mention";
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
    await slackApi.postEphemeral(config, channelId, userId, THREAD_MENTION_GUIDANCE);
    return;
  }

  const userText = stripAppMentionText(event.text ?? "");
  if (userText.length === 0) {
    await postMentionRegisterButton(config, channelId, userId);
    return;
  }

  await handleAppMentionWithText(config, envelope);
};
