import type { AppConfig } from "../config";
import {
  APP_HOME_LIST_OPEN_ACTION_ID,
  APP_HOME_SETTINGS_OPEN_ACTION_ID
} from "./action-ids";
import { showOwnAbsenceList } from "./absence-list";
import { resolveAppHomeDmChannelId } from "./app-home-channel";
import { publishAppHome } from "./app-home-publish";
import { openMemberMasterSettingsModal } from "./member-master-modal";
import { postUserFacingMessage } from "./user-message";
import type { SlackEventEnvelope } from "./events";

export { isAppHomeBlockActions } from "./app-home-context";
export { buildAppHomeBlocks, buildAppHomeStaticFallbackBlocks } from "./app-home-blocks";
export {
  APP_HOME_LIST_OPEN_ACTION_ID,
  APP_HOME_SETTINGS_OPEN_ACTION_ID
} from "./action-ids";

type AppHomeInteractionPayload = {
  type: string;
  trigger_id?: string;
  user?: { id?: string };
  channel?: { id?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
};

export type AppHomeInteractionResult = {
  handled: boolean;
  ok: boolean;
  followUp?: () => Promise<void>;
};

const isAppHomeManagedAction = (payload: AppHomeInteractionPayload): boolean => {
  const actionId = payload.actions?.[0]?.action_id ?? "";
  return (
    actionId === APP_HOME_SETTINGS_OPEN_ACTION_ID || actionId === APP_HOME_LIST_OPEN_ACTION_ID
  );
};

const notifyAppHomeUser = async (
  config: AppConfig,
  params: { channelId?: string; userId: string; text: string }
): Promise<void> => {
  try {
    const channelId = await resolveAppHomeDmChannelId(config, params.userId, params.channelId);
    await postUserFacingMessage(config, {
      channelId,
      userId: params.userId,
      text: params.text
    });
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "app_home_notify_failed",
        user_id: params.userId,
        channel_id: params.channelId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }
};

export const handleAppHomeOpened = async (
  config: AppConfig,
  envelope: SlackEventEnvelope
): Promise<void> => {
  const event = envelope.event;
  if (event?.type !== "app_home_opened") return;

  const homeEvent = event as { type?: string; user?: string; tab?: string; channel?: string };
  if (homeEvent.tab !== "home") return;

  const userId = homeEvent.user ?? "";
  if (!userId) return;

  console.log(
    JSON.stringify({
      level: "info",
      event: "app_home_opened",
      event_id: envelope.event_id ?? "",
      team_id: envelope.team_id ?? "",
      user_id: userId,
      channel_id: homeEvent.channel ?? "",
      tab: homeEvent.tab ?? ""
    })
  );

  try {
    await publishAppHome(config, userId);
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "app_home_publish_failed",
        event_id: envelope.event_id ?? "",
        user_id: userId,
        channel_id: homeEvent.channel ?? "",
        message: error instanceof Error ? error.message : String(error)
      })
    );
    await notifyAppHomeUser(config, {
      channelId: homeEvent.channel,
      userId,
      text: "ホーム画面を表示できませんでした。しばらく待ってから再度お試しください。"
    });
  }
};

export const handleAppHomeInteraction = async (
  config: AppConfig,
  payload: AppHomeInteractionPayload
): Promise<AppHomeInteractionResult> => {
  if (!isAppHomeManagedAction(payload)) {
    return { handled: false, ok: true };
  }

  const actionId = payload.actions?.[0]?.action_id ?? "";
  const userId = payload.user?.id ?? "";
  const channelId = payload.channel?.id ?? "";
  const triggerId = payload.trigger_id ?? "";
  const responseUrl = payload.response_url ?? "";

  if (!userId) {
    return { handled: true, ok: true };
  }

  if (actionId === APP_HOME_SETTINGS_OPEN_ACTION_ID) {
    if (!triggerId) {
      await notifyAppHomeUser(config, {
        channelId,
        userId,
        text: "設定フォームを開けませんでした。もう一度お試しください。"
      });
      return { handled: true, ok: true };
    }
    try {
      await openMemberMasterSettingsModal(config, { triggerId, userId });
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "app_home_settings_modal_open_failed",
          user_id: userId,
          channel_id: channelId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
      await notifyAppHomeUser(config, {
        channelId,
        userId,
        text: "設定フォームを開けませんでした。しばらく待ってから再度お試しください。"
      });
    }
    return { handled: true, ok: true };
  }

  if (actionId === APP_HOME_LIST_OPEN_ACTION_ID) {
    return {
      handled: true,
      ok: true,
      followUp: async () => {
        try {
          const resolvedChannelId = await resolveAppHomeDmChannelId(config, userId, channelId);
          await showOwnAbsenceList(
            config,
            {
              command: "/pasr",
              text: "list",
              userId,
              teamId: "",
              channelId: resolvedChannelId,
              triggerId: "",
              responseUrl: responseUrl
            },
            { includeEdit: true }
          );
          console.log(
            JSON.stringify({
              level: "info",
              event: "app_home_list_shown",
              user_id: userId,
              channel_id: channelId
            })
          );
        } catch (error) {
          console.warn(
            JSON.stringify({
              level: "warn",
              event: "app_home_list_failed",
              user_id: userId,
              channel_id: channelId,
              message: error instanceof Error ? error.message : String(error)
            })
          );
          await notifyAppHomeUser(config, {
            channelId,
            userId,
            text: "不在予定一覧を表示できませんでした。しばらく待ってから再度お試しください。"
          });
        }
      }
    };
  }

  return { handled: false, ok: true };
};
