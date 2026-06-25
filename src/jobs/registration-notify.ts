import type { AppConfig } from "../config";
import type { AbsenceRecord } from "../domain/absence";
import {
  buildRegistrationNotifyMessage,
  buildRegistrationSuccessEphemeral,
  resolveNotifyTargets,
  type RegistrationNotifyMode
} from "../domain/absence-registration";
import { slackApi } from "../slack/api";

export type RegistrationNotifyParams = {
  userId: string;
  channelId: string;
  itemId: string;
  record: AbsenceRecord;
  selectedMode: RegistrationNotifyMode;
  resolvedMode: RegistrationNotifyMode;
};

export type RegistrationNotifyResult = {
  channelsSent: number;
  channelsFailed: number;
  dmsSent: number;
  dmsFailed: number;
  skippedNoTargets: boolean;
};

export const runRegistrationNotifyAndAck = async (
  config: AppConfig,
  params: RegistrationNotifyParams
): Promise<RegistrationNotifyResult> => {
  const result: RegistrationNotifyResult = {
    channelsSent: 0,
    channelsFailed: 0,
    dmsSent: 0,
    dmsFailed: 0,
    skippedNoTargets: false
  };

  const { sendChannels, sendUsers } = resolveNotifyTargets(
    params.resolvedMode,
    params.record.notifyChannels,
    params.record.notifyUsers
  );

  if (params.resolvedMode !== "none" && !sendChannels && !sendUsers) {
    result.skippedNoTargets = true;
    console.log(
      JSON.stringify({
        level: "info",
        event: "registration_notify_skipped_no_targets",
        user_id: params.userId,
        item_id: params.itemId,
        resolved_notify_mode: params.resolvedMode
      })
    );
  } else {
    const text = buildRegistrationNotifyMessage({
      targetUser: params.record.targetUser,
      startDate: params.record.startDate,
      endDate: params.record.endDate,
      note: params.record.note
    });

    if (sendChannels) {
      for (const channel of params.record.notifyChannels) {
        try {
          await slackApi.postChannelMessage(config, channel, text);
          result.channelsSent += 1;
        } catch (error) {
          result.channelsFailed += 1;
          console.error(
            JSON.stringify({
              level: "error",
              event: "registration_notify_channel_failed",
              user_id: params.userId,
              item_id: params.itemId,
              channel_id: channel,
              message: error instanceof Error ? error.message : String(error)
            })
          );
        }
      }
    }

    if (sendUsers) {
      for (const notifyUser of params.record.notifyUsers) {
        try {
          const dmChannelId = await slackApi.openDirectMessage(config, notifyUser);
          await slackApi.postChannelMessage(config, dmChannelId, text);
          result.dmsSent += 1;
        } catch (error) {
          result.dmsFailed += 1;
          console.error(
            JSON.stringify({
              level: "error",
              event: "registration_notify_dm_failed",
              user_id: params.userId,
              item_id: params.itemId,
              notify_user_id: notifyUser,
              message: error instanceof Error ? error.message : String(error)
            })
          );
        }
      }
    }

    console.log(
      JSON.stringify({
        level: "info",
        event: "registration_notify_done",
        user_id: params.userId,
        item_id: params.itemId,
        registration_notify_mode: params.selectedMode,
        resolved_notify_mode: params.resolvedMode,
        channels_sent: result.channelsSent,
        channels_failed: result.channelsFailed,
        dms_sent: result.dmsSent,
        dms_failed: result.dmsFailed
      })
    );
  }

  if (params.channelId) {
    const ackText = buildRegistrationSuccessEphemeral({
      startDate: params.record.startDate,
      endDate: params.record.endDate,
      selectedMode: params.selectedMode,
      resolvedMode: params.resolvedMode
    });
    try {
      await slackApi.postEphemeral(config, params.channelId, params.userId, ackText);
      console.log(
        JSON.stringify({
          level: "info",
          event: "absence_register_ack_ephemeral_sent",
          user_id: params.userId,
          channel_id: params.channelId,
          item_id: params.itemId
        })
      );
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "absence_register_ack_ephemeral_failed",
          user_id: params.userId,
          channel_id: params.channelId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  return result;
};
