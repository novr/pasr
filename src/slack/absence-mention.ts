import type { AppConfig } from "../config";
import {
  buildMentionConfirmPayload,
  describeAiRunForLog,
  parseMentionConfirmPayload,
  stripAppMentionText,
  tryInferMentionDraftWithoutAi,
  type AbsenceMentionDraft
} from "../domain/absence-mention-parse";
import {
  formatAttendancePeriod,
  formatRegistrationNotifyModeLabel,
  validateAbsenceRegistration
} from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { resolveActiveListIds } from "../jobs/setup";
import {
  ABSENCE_REGISTER_OPEN_ACTION_ID,
  type AbsenceRegisterInteractionResult
} from "./absence-register";
import {
  commitAbsenceRegistration,
  formatAbsenceRegistrationValidationError
} from "./absence-register-commit";
import { slackApi } from "./api";
import { resolveMasterContext } from "./member-master-context";
import { consumeInteractionMessage } from "./interaction-message";
import { runAbsenceMentionAi } from "./absence-mention-ai";

export const ABSENCE_MENTION_CONFIRM_ACTION_ID = "pasr_mention_confirm";
export const ABSENCE_MENTION_CANCEL_ACTION_ID = "pasr_mention_cancel";

type AppMentionEnvelope = {
  event_id?: string;
  team_id?: string;
  event?: {
    type?: string;
    user?: string;
    channel?: string;
    text?: string;
  };
};

type SlackInteractionPayload = {
  type: string;
  response_url?: string;
  user?: { id?: string };
  channel?: { id?: string };
  actions?: Array<{ action_id?: string; value?: string }>;
};

const mentionRegisterBlocks = (): Array<Record<string, unknown>> => [
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
];

export const postMentionRegisterButton = async (
  config: AppConfig,
  channelId: string,
  userId: string,
  text = "不在を登録する場合は下のボタンを押してください。"
): Promise<void> => {
  await slackApi.postEphemeral(config, channelId, userId, text, mentionRegisterBlocks());
};

const postMentionFallback = async (
  config: AppConfig,
  channelId: string,
  userId: string,
  text: string
): Promise<void> => {
  await postMentionRegisterButton(config, channelId, userId, text);
};

const formatAiFailureUserMessage = (error?: Error): string => {
  const message = error?.message ?? "";
  if (message.includes("deprecated")) {
    return "AI 解釈は一時的に利用できません。下のボタンから Modal で登録してください。";
  }
  return "不在内容を解釈できませんでした。下のボタンから Modal で登録してください。";
};

const buildConfirmBlocks = (params: {
  draft: AbsenceMentionDraft;
  notifyLabel: string;
  confirmValue: string;
}): Array<Record<string, unknown>> => {
  const period = formatAttendancePeriod(params.draft.startDate, params.draft.endDate);
  const noteLine =
    params.draft.note && params.draft.note.length > 0 ? `• 詳細: ${params.draft.note}` : "• 詳細: （なし）";
  const truncateNote =
    params.draft.noteTruncated === true ? "\n_※ 詳細は長いため先頭 500 文字のみ登録されます_" : "";
  const lines = [
    "解釈結果:",
    `• 期間: ${period}`,
    noteLine,
    `• 通知: ${params.notifyLabel}（既定）`,
    truncateNote
  ].join("\n");

  return [
    { type: "section", text: { type: "mrkdwn", text: lines } },
    {
      type: "actions",
      block_id: "pasr_mention_confirm_actions",
      elements: [
        {
          type: "button",
          action_id: ABSENCE_MENTION_CONFIRM_ACTION_ID,
          text: { type: "plain_text", text: "登録する" },
          style: "primary",
          value: params.confirmValue
        },
        {
          type: "button",
          action_id: ABSENCE_MENTION_CANCEL_ACTION_ID,
          text: { type: "plain_text", text: "キャンセル" }
        },
        {
          type: "button",
          action_id: ABSENCE_REGISTER_OPEN_ACTION_ID,
          text: { type: "plain_text", text: "Modalで編集" },
          value: params.confirmValue
        }
      ]
    }
  ];
};

export const isMentionAction = (payload: SlackInteractionPayload): boolean => {
  const actionId = payload.actions?.[0]?.action_id ?? "";
  return actionId === ABSENCE_MENTION_CONFIRM_ACTION_ID || actionId === ABSENCE_MENTION_CANCEL_ACTION_ID;
};

export const handleAppMentionWithText = async (
  config: AppConfig,
  envelope: AppMentionEnvelope
): Promise<void> => {
  const event = envelope.event;
  const userId = event?.user ?? "";
  const channelId = event?.channel ?? "";
  if (!userId || !channelId) return;

  const userText = stripAppMentionText(event?.text ?? "");
  if (userText.length === 0) {
    await postMentionRegisterButton(config, channelId, userId);
    return;
  }

  const { day: todayJst } = getJstDateParts();
  const inferDraft = tryInferMentionDraftWithoutAi(userText, todayJst);
  if (!config.ai && !inferDraft) {
    await postMentionFallback(
      config,
      channelId,
      userId,
      "AI 解釈は利用できません。下のボタンから Modal で登録してください。"
    );
    return;
  }

  if (!inferDraft) {
    console.log(
      JSON.stringify({
        level: "info",
        event: "absence_mention_ai_started",
        event_id: envelope.event_id ?? "",
        team_id: envelope.team_id ?? "",
        user_id: userId,
        channel_id: channelId
      })
    );
    await slackApi.postEphemeral(config, channelId, userId, "不在内容を解釈しています…");
  } else {
    console.log(
      JSON.stringify({
        level: "info",
        event: "absence_mention_infer_skipped",
        event_id: envelope.event_id ?? "",
        team_id: envelope.team_id ?? "",
        user_id: userId,
        channel_id: channelId,
        start_date: inferDraft.startDate,
        end_date: inferDraft.endDate
      })
    );
  }

  const aiResult = await runAbsenceMentionAi(config, todayJst, userText, { inferredDraft: inferDraft });
  if (aiResult.error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "absence_mention_ai_failed",
        event_id: envelope.event_id ?? "",
        user_id: userId,
        channel_id: channelId,
        message: aiResult.error.message
      })
    );
    await postMentionFallback(config, channelId, userId, formatAiFailureUserMessage(aiResult.error));
    return;
  }

  const draft = aiResult.draft;
  if (!draft) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "absence_mention_ai_failed",
        event_id: envelope.event_id ?? "",
        user_id: userId,
        channel_id: channelId,
        reason: "invalid_ai_output",
        ...describeAiRunForLog(aiResult.lastResponse)
      })
    );
    await postMentionFallback(
      config,
      channelId,
      userId,
      "不在内容を解釈できませんでした。下のボタンから Modal で登録してください。"
    );
    return;
  }

  const master = await resolveMasterContext(config, userId);
  const validationError = validateAbsenceRegistration({
    startDate: draft.startDate,
    endDate: draft.endDate,
    todayJst,
    notifyMode: master.defaultRegistrationNotify,
    channels: master.defaultNotifyChannels,
    users: master.defaultNotifyUsers,
    active: master.active
  });
  if (validationError) {
    await postMentionFallback(
      config,
      channelId,
      userId,
      `${formatAbsenceRegistrationValidationError(validationError)}\n下のボタンから Modal で登録してください。`
    );
    return;
  }

  const confirmPayload = buildMentionConfirmPayload({ userId, channelId, draft });
  const confirmValue = JSON.stringify(confirmPayload);
  if (confirmValue.length > 2000) {
    await postMentionFallback(
      config,
      channelId,
      userId,
      "確認データが長すぎます。下のボタンから Modal で登録してください。"
    );
    return;
  }

  const notifyLabel = formatRegistrationNotifyModeLabel(master.defaultRegistrationNotify);
  await slackApi.postEphemeral(
    config,
    channelId,
    userId,
    "不在登録の確認",
    buildConfirmBlocks({ draft, notifyLabel, confirmValue })
  );

  console.log(
    JSON.stringify({
      level: "info",
      event: "absence_mention_confirm_shown",
      event_id: envelope.event_id ?? "",
      user_id: userId,
      channel_id: channelId,
      start_date: draft.startDate,
      end_date: draft.endDate
    })
  );
};

export const handleAbsenceMentionInteraction = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceRegisterInteractionResult> => {
  if (payload.type !== "block_actions") return { ok: true };

  const action = payload.actions?.[0];
  const actionId = action?.action_id ?? "";
  if (actionId !== ABSENCE_MENTION_CONFIRM_ACTION_ID && actionId !== ABSENCE_MENTION_CANCEL_ACTION_ID) {
    return { ok: true };
  }

  const actorUserId = payload.user?.id ?? "";
  const channelId = payload.channel?.id ?? "";
  if (!actorUserId || !channelId) return { ok: true };

  if (actionId === ABSENCE_MENTION_CANCEL_ACTION_ID) {
    await consumeInteractionMessage(payload.response_url);
    console.log(
      JSON.stringify({
        level: "info",
        event: "absence_mention_cancelled",
        user_id: actorUserId,
        channel_id: channelId
      })
    );
    return { ok: true };
  }

  const confirmPayload = parseMentionConfirmPayload(action?.value ?? "");
  if (!confirmPayload) {
    await slackApi.postEphemeral(
      config,
      channelId,
      actorUserId,
      "確認情報の読み取りに失敗しました。もう一度 @PASR で登録してください。"
    );
    return { ok: true };
  }

  if (actorUserId !== confirmPayload.userId) {
    await slackApi.postEphemeral(config, channelId, actorUserId, "本人以外は登録できません。");
    return { ok: true };
  }

  if (confirmPayload.channelId !== channelId) {
    await slackApi.postEphemeral(
      config,
      channelId,
      actorUserId,
      "確認情報が無効です。もう一度 @PASR で登録してください。"
    );
    return { ok: true };
  }

  await consumeInteractionMessage(payload.response_url);

  const { userId, startDate, endDate, note } = confirmPayload;

  return {
    ok: true,
    followUp: async () => {
      const { absenceListId } = await resolveActiveListIds(config);
      const master = await resolveMasterContext(config, userId);
      const result = await commitAbsenceRegistration(config, {
        userId,
        channelId,
        absenceListId,
        startDate,
        endDate,
        note,
        notifyChannels: master.defaultNotifyChannels,
        notifyUsers: master.defaultNotifyUsers,
        selectedMode: master.defaultRegistrationNotify,
        active: master.active
      });

      if (!result.ok) {
        await slackApi.postEphemeral(config, channelId, actorUserId, result.error);
        return;
      }

      console.log(
        JSON.stringify({
          level: "info",
          event: "absence_mention_confirmed",
          user_id: userId,
          channel_id: channelId,
          list_id: absenceListId,
          start_date: startDate,
          end_date: endDate
        })
      );

      await result.followUp();
    }
  };
};
