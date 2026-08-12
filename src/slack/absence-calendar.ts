import type { AppConfig } from "../config";
import { listAbsencesOverlappingRangeForChannel } from "../db/absence-repository";
import { checkDbSchema } from "../db/schema-check";
import {
  flattenAbsenceCalendarDayGroups,
  groupAbsencesByJstDay
} from "../domain/absence-calendar-view";
import {
  formatAbsenceRangeValidationError,
  isSlackChannelId,
  validateAbsenceRange,
  type AbsenceRangeValidationError
} from "../domain/absence-range";
import { getJstDateParts } from "../domain/jst-date";
import { deliverAdminEphemeralReply } from "./admin-format";
import { splitLinesByTextMax } from "./message-text-split";
import { slackApi } from "./api";

export const ABSENCE_CALENDAR_MODAL_CALLBACK_ID = "pasr_absence_calendar";

export const CALENDAR_DM_TEXT_MAX = 12_000;
export const CALENDAR_DM_MAX_THREAD_MESSAGES = 40;
const CALENDAR_DM_TRUNCATION_NOTICE = "… 以降は表示を省略しました";
const CALENDAR_DM_PART_LABEL_FIT_PREFIX = "_999/999_\n";

export const START_BLOCK_ID = "start_block";
export const END_BLOCK_ID = "end_block";
export const CHANNEL_BLOCK_ID = "channel_block";

const absenceRangeErrorBlockId = (error: AbsenceRangeValidationError): string => {
  switch (error) {
    case "from_after_to":
    case "invalid_to":
    case "range_too_long":
      return END_BLOCK_ID;
    default:
      return START_BLOCK_ID;
  }
};

type AbsenceCalendarMetadata = {
  userId: string;
  responseUrl: string;
};

type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  response_url?: string;
  user?: { id?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
};

export type AbsenceCalendarInteractionResult = {
  ok: boolean;
  error?: string;
  errorBlockId?: string;
  followUp?: () => Promise<void>;
};

export type AbsenceCalendarDmDelivery = {
  parentText: string;
  threadTexts: string[];
  totalCount: number;
  truncated: boolean;
};

export type AbsenceCalendarDmDeliveryResult = {
  parentOk: boolean;
  threadSent: number;
  threadFailed: number;
  truncated: boolean;
  emptyResult: boolean;
};

const parseDateValue = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_date;
  return typeof selected === "string" ? selected : "";
};

const parseSelectedChannel = (value: unknown): string => {
  const record = value && typeof value === "object" ? (value as Record<string, unknown>) : null;
  const selected = record?.selected_conversation;
  return typeof selected === "string" ? selected : "";
};

const parseAbsenceCalendarMetadata = (raw: string): AbsenceCalendarMetadata | undefined => {
  try {
    const parsed = JSON.parse(raw) as Partial<AbsenceCalendarMetadata>;
    if (!parsed?.userId) return undefined;
    return {
      userId: parsed.userId,
      responseUrl: parsed.responseUrl ?? ""
    };
  } catch {
    return undefined;
  }
};

const buildPartLabel = (index: number, total: number): string =>
  total <= 1 ? "" : `_${index + 1}/${total}_\n`;

const fitThreadTextForDelivery = (body: string, label: string, suffix = ""): string => {
  const budget = CALENDAR_DM_TEXT_MAX - label.length - suffix.length;
  if (body.length <= budget) {
    return `${label}${body}${suffix}`;
  }
  return `${label}${body.slice(0, Math.max(0, budget - 1))}…${suffix}`;
};

const buildCalendarThreadTexts = (lines: string[]): { threadTexts: string[]; truncated: boolean } => {
  const splitMax = CALENDAR_DM_TEXT_MAX - CALENDAR_DM_PART_LABEL_FIT_PREFIX.length;
  const chunks = splitLinesByTextMax(lines, splitMax);
  if (chunks.length <= CALENDAR_DM_MAX_THREAD_MESSAGES) {
    return {
      threadTexts: chunks.map((chunk, index) =>
        fitThreadTextForDelivery(chunk, buildPartLabel(index, chunks.length))
      ),
      truncated: false
    };
  }

  const limited = chunks.slice(0, CALENDAR_DM_MAX_THREAD_MESSAGES);
  const total = limited.length;
  return {
    threadTexts: limited.map((chunk, index) => {
      const label = buildPartLabel(index, total);
      const suffix = index === total - 1 ? `\n${CALENDAR_DM_TRUNCATION_NOTICE}` : "";
      return fitThreadTextForDelivery(chunk, label, suffix);
    }),
    truncated: true
  };
};

export const buildAbsenceCalendarDmDelivery = async (
  config: AppConfig,
  params: {
    channelId: string;
    from: string;
    to: string;
    todayJst: string;
  }
): Promise<AbsenceCalendarDmDelivery | string> => {
  const validation = validateAbsenceRange(params.from, params.to, params.todayJst);
  if (!validation.ok) {
    return formatAbsenceRangeValidationError(validation.error);
  }
  if (!isSlackChannelId(params.channelId)) {
    return "チャンネルの指定が正しくありません。";
  }

  const dbSchema = await checkDbSchema(config);
  if (dbSchema !== "ok") {
    return "データベースの準備が完了していません。";
  }

  const records = await listAbsencesOverlappingRangeForChannel(
    config,
    params.from,
    params.to,
    params.channelId
  );
  const totalCount = records.length;
  const headerBase = `<#${params.channelId}> の不在カレンダー (${params.from} 〜 ${params.to} JST)`;
  if (totalCount === 0) {
    return {
      parentText: `${headerBase}: 0件\n（該当なし）`,
      threadTexts: [],
      totalCount,
      truncated: false
    };
  }

  const groups = groupAbsencesByJstDay(records, params.from, params.to);
  const totalDays = groups.length;
  const parentText = `${headerBase}: ${totalCount}件 / ${totalDays}日`;
  const { threadTexts, truncated } = buildCalendarThreadTexts(flattenAbsenceCalendarDayGroups(groups));
  return { parentText, threadTexts, totalCount, truncated };
};

export const buildCalendarDmAckMessage = (result: AbsenceCalendarDmDeliveryResult): string => {
  if (!result.parentOk) {
    return "Bot DM への送信に失敗しました。Bot をブロックしていないか確認してください。";
  }
  if (result.emptyResult) {
    return "Bot DM に送りました（該当なし）。";
  }
  if (result.threadFailed > 0) {
    return "Bot DM に送りましたが、一部の表示に失敗しました。DM を確認してください。";
  }
  if (result.truncated) {
    return "Bot DM に送りました（表示件数の上限により省略あり）。";
  }
  return "Bot DM に不在カレンダーを送りました。";
};

export const deliverAbsenceCalendarToDm = async (
  config: AppConfig,
  params: {
    userId: string;
    parentText: string;
    threadTexts: string[];
    truncated: boolean;
  }
): Promise<AbsenceCalendarDmDeliveryResult> => {
  const emptyResult = params.threadTexts.length === 0;
  let parentOk = false;
  let threadSent = 0;
  let threadFailed = 0;
  const truncated = params.truncated;

  try {
    const dmChannelId = await slackApi.openDirectMessage(config, params.userId);
    const parentPosted = await slackApi.postChannelMessage(config, dmChannelId, params.parentText);
    const parentTs = parentPosted.ts;
    if (!parentTs) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "calendar_dm_delivery",
          parent_ok: false,
          thread_sent: 0,
          thread_failed: params.threadTexts.length,
          truncated
        })
      );
      return { parentOk: false, threadSent: 0, threadFailed: params.threadTexts.length, truncated, emptyResult };
    }
    parentOk = true;

    for (const threadText of params.threadTexts) {
      try {
        await slackApi.postChannelMessage(config, dmChannelId, threadText, undefined, parentTs);
        threadSent += 1;
      } catch (error) {
        threadFailed += 1;
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "calendar_dm_delivery_thread_failed",
            user_id: params.userId,
            message: error instanceof Error ? error.message : String(error)
          })
        );
      }
    }
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "calendar_dm_delivery",
        parent_ok: false,
        thread_sent: threadSent,
        thread_failed: threadFailed + Math.max(0, params.threadTexts.length - threadSent),
        truncated,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return {
      parentOk: false,
      threadSent,
      threadFailed: threadFailed + Math.max(0, params.threadTexts.length - threadSent),
      truncated,
      emptyResult
    };
  }

  console.log(
    JSON.stringify({
      level: "info",
      event: "calendar_dm_delivery",
      parent_ok: parentOk,
      thread_sent: threadSent,
      thread_failed: threadFailed,
      truncated
    })
  );
  return { parentOk, threadSent, threadFailed, truncated, emptyResult };
};

export const buildAbsenceCalendarModalView = (params: {
  userId: string;
  responseUrl: string;
  todayJst: string;
  initialChannelId?: string;
}): Record<string, unknown> => {
  const channelElement: Record<string, unknown> = {
    type: "conversations_select",
    action_id: "notify_channel_select",
    placeholder: { type: "plain_text", text: "通知チャンネルを選択" },
    filter: { include: ["public", "private"] }
  };
  if (params.initialChannelId && isSlackChannelId(params.initialChannelId)) {
    channelElement.initial_conversation = params.initialChannelId;
  }

  return {
    type: "modal",
    callback_id: ABSENCE_CALENDAR_MODAL_CALLBACK_ID,
    private_metadata: JSON.stringify({
      userId: params.userId,
      responseUrl: params.responseUrl
    }),
    title: { type: "plain_text", text: "不在カレンダー" },
    submit: { type: "plain_text", text: "表示" },
    close: { type: "plain_text", text: "キャンセル" },
    blocks: [
      {
        type: "context",
        elements: [
          {
            type: "mrkdwn",
            text: "通知チャンネルに届け先指定された*予定*のみ表示します。終了済みの予定は日次削除のため一覧に出ません。開始日は今日以降、最大 92 日です。結果は PASR Bot の DM に送られます（本人のみ・後から見返せます）。"
          }
        ]
      },
      {
        type: "input",
        block_id: START_BLOCK_ID,
        label: { type: "plain_text", text: "開始日" },
        element: {
          type: "datepicker",
          action_id: "start_date",
          initial_date: params.todayJst,
          placeholder: { type: "plain_text", text: "開始日を選択" }
        }
      },
      {
        type: "input",
        block_id: END_BLOCK_ID,
        label: { type: "plain_text", text: "終了日" },
        element: {
          type: "datepicker",
          action_id: "end_date",
          initial_date: params.todayJst,
          placeholder: { type: "plain_text", text: "終了日を選択" }
        }
      },
      {
        type: "input",
        block_id: CHANNEL_BLOCK_ID,
        label: { type: "plain_text", text: "通知チャンネル" },
        element: channelElement
      }
    ]
  };
};

export const openAbsenceCalendarModal = async (
  config: AppConfig,
  params: {
    triggerId: string;
    userId: string;
    responseUrl: string;
    initialChannelId?: string;
  }
): Promise<void> => {
  const { day: todayJst } = getJstDateParts();
  await slackApi.openModal(
    config,
    params.triggerId,
    buildAbsenceCalendarModalView({
      userId: params.userId,
      responseUrl: params.responseUrl,
      todayJst,
      initialChannelId: params.initialChannelId
    })
  );
};

const handleAbsenceCalendarSubmission = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceCalendarInteractionResult> => {
  const metadata = parseAbsenceCalendarMetadata(payload.view?.private_metadata ?? "");
  if (!metadata) {
    return {
      ok: false,
      error: "フォーム情報の読み取りに失敗しました。もう一度 /pasr calendar を実行してください。",
      errorBlockId: START_BLOCK_ID
    };
  }
  const actorUserId = payload.user?.id ?? "";
  if (actorUserId !== metadata.userId) {
    return { ok: false, error: "本人以外は実行できません。", errorBlockId: START_BLOCK_ID };
  }

  const values = payload.view?.state?.values ?? {};
  const from = parseDateValue(values[START_BLOCK_ID]?.start_date);
  const to = parseDateValue(values[END_BLOCK_ID]?.end_date);
  const channelId = parseSelectedChannel(values[CHANNEL_BLOCK_ID]?.notify_channel_select);
  const { day: todayJst } = getJstDateParts();

  const rangeValidation = validateAbsenceRange(from, to, todayJst);
  if (!rangeValidation.ok) {
    return {
      ok: false,
      error: formatAbsenceRangeValidationError(rangeValidation.error),
      errorBlockId: absenceRangeErrorBlockId(rangeValidation.error)
    };
  }
  if (!isSlackChannelId(channelId)) {
    return {
      ok: false,
      error: "通知チャンネルを選択してください。",
      errorBlockId: CHANNEL_BLOCK_ID
    };
  }

  const responseUrl = metadata.responseUrl || payload.response_url || "";

  return {
    ok: true,
    followUp: async () => {
      try {
        const delivery = await buildAbsenceCalendarDmDelivery(config, {
          channelId,
          from,
          to,
          todayJst
        });
        if (typeof delivery === "string") {
          await deliverAdminEphemeralReply(
            config,
            { userId: metadata.userId, responseUrl },
            delivery
          );
          return;
        }
        const result = await deliverAbsenceCalendarToDm(config, {
          userId: metadata.userId,
          parentText: delivery.parentText,
          threadTexts: delivery.threadTexts,
          truncated: delivery.truncated
        });
        await deliverAdminEphemeralReply(
          config,
          { userId: metadata.userId, responseUrl },
          buildCalendarDmAckMessage({
            ...result,
            emptyResult: delivery.totalCount === 0
          })
        );
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "calendar_dm_delivery_failed",
            user_id: metadata.userId,
            message: error instanceof Error ? error.message : String(error)
          })
        );
        await deliverAdminEphemeralReply(
          config,
          { userId: metadata.userId, responseUrl },
          "Bot DM への送信に失敗しました。Bot をブロックしていないか確認してください。"
        );
      }
    }
  };
};

export const handleAbsenceCalendarInteraction = async (
  config: AppConfig,
  payload: SlackInteractionPayload
): Promise<AbsenceCalendarInteractionResult> => {
  if (payload.type === "view_submission" && payload.view?.callback_id === ABSENCE_CALENDAR_MODAL_CALLBACK_ID) {
    return handleAbsenceCalendarSubmission(config, payload);
  }
  return { ok: true };
};
