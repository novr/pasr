import type { AppConfig } from "../config";
import { listAbsencesOverlappingRangeForChannel } from "../db/absence-repository";
import { checkDbSchema } from "../db/schema-check";
import {
  flattenAbsenceCalendarDayGroups,
  groupAbsencesByJstDay,
  paginateAbsenceCalendarDayGroups
} from "../domain/absence-calendar-view";
import {
  decodeAbsenceCalendarPageValue,
  encodeAbsenceCalendarPageValue,
  formatAbsenceRangeValidationError,
  isSlackChannelId,
  validateAbsenceRange,
  type AbsenceCalendarPageQuery,
  type AbsenceRangeValidationError
} from "../domain/absence-range";
import { getJstDateParts } from "../domain/jst-date";
import { ABSENCE_CALENDAR_PAGE_ACTION_ID } from "./action-ids";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";
import {
  deliverAdminEphemeralReply,
  formatAdminEphemeralMessage,
  type AdminEphemeralReply
} from "./admin-format";
import { slackApi } from "./api";

export const ABSENCE_CALENDAR_MODAL_CALLBACK_ID = "pasr_absence_calendar";

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
  deliverChannelId: string;
};

type SlackInteractionPayload = {
  type: string;
  trigger_id?: string;
  response_url?: string;
  user?: { id?: string };
  channel?: { id?: string };
  view?: {
    callback_id?: string;
    private_metadata?: string;
    state?: {
      values?: Record<string, Record<string, unknown>>;
    };
  };
  actions?: Array<{ action_id?: string; value?: string }>;
};

export type AbsenceCalendarInteractionResult = {
  ok: boolean;
  error?: string;
  errorBlockId?: string;
  followUp?: () => Promise<void>;
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
      responseUrl: parsed.responseUrl ?? "",
      deliverChannelId: parsed.deliverChannelId ?? ""
    };
  } catch {
    return undefined;
  }
};

const calendarPaginationValue = (
  query: Omit<AbsenceCalendarPageQuery, "page">,
  page: number
): string => encodeAbsenceCalendarPageValue({ ...query, page });

const buildCalendarPaginationBlocks = (
  text: string,
  query: Omit<AbsenceCalendarPageQuery, "page">,
  page: number,
  totalPages: number,
  remainingEntryCount: number
): Array<Record<string, unknown>> | undefined => {
  if (totalPages <= 1) return undefined;
  const elements: Array<Record<string, unknown>> = [];
  if (page > 1) {
    elements.push({
      type: "button",
      action_id: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      text: { type: "plain_text", text: `← ${page - 1}` },
      value: calendarPaginationValue(query, page - 1)
    });
  }
  if (page < totalPages && remainingEntryCount > 0) {
    elements.push({
      type: "button",
      action_id: ABSENCE_CALENDAR_PAGE_ACTION_ID,
      text: { type: "plain_text", text: `次ページ（${remainingEntryCount} 件）→` },
      value: calendarPaginationValue(query, page + 1)
    });
  }
  if (elements.length === 0) return undefined;
  return [
    { type: "section", text: { type: "mrkdwn", text } },
    { type: "actions", block_id: "pasr_calendar_pagination", elements }
  ];
};

export const buildAbsenceCalendarReply = async (
  config: AppConfig,
  params: {
    userId: string;
    from: string;
    to: string;
    channelId: string;
    page: number;
    todayJst: string;
  }
): Promise<AdminEphemeralReply | string> => {
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
    return `${headerBase}: 0件\n（該当なし）`;
  }

  const groups = groupAbsencesByJstDay(records, params.from, params.to);
  const totalDays = groups.length;
  const pagination = paginateAbsenceCalendarDayGroups(groups, params.page, ADMIN_EPHEMERAL_LIST_MAX);
  const header = `${headerBase}: ${totalCount}件 / ${totalDays}日 — ページ ${pagination.currentPage}/${pagination.totalPages}`;
  const lines = flattenAbsenceCalendarDayGroups(pagination.pageGroups);
  const text = formatAdminEphemeralMessage(header, lines, 0);
  const blocks = buildCalendarPaginationBlocks(
    text,
    {
      userId: params.userId,
      from: params.from,
      to: params.to,
      channelId: params.channelId
    },
    pagination.currentPage,
    pagination.totalPages,
    pagination.remainingEntryCount
  );
  return blocks ? { text, blocks } : { text };
};

export const buildAbsenceCalendarModalView = (params: {
  userId: string;
  responseUrl: string;
  deliverChannelId: string;
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
      responseUrl: params.responseUrl,
      deliverChannelId: params.deliverChannelId
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
            text: "通知チャンネルに届け先指定された*予定*のみ表示します。終了済みの予定は日次削除のため一覧に出ません。開始日は今日以降、最大 92 日です。"
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
    deliverChannelId: string;
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
      deliverChannelId: params.deliverChannelId,
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
  const deliverChannelId = metadata.deliverChannelId || payload.channel?.id || "";

  return {
    ok: true,
    followUp: async () => {
      const reply = await buildAbsenceCalendarReply(config, {
        userId: metadata.userId,
        from,
        to,
        channelId,
        page: 1,
        todayJst
      });
      await deliverAdminEphemeralReply(
        config,
        {
          userId: metadata.userId,
          responseUrl,
          channelId: deliverChannelId
        },
        reply
      );
    }
  };
};

export const handleAbsenceCalendarPageInteraction = async (
  config: AppConfig,
  params: {
    actionId: string;
    userId: string;
    pageValue: string;
    responseUrl?: string;
    channelId?: string;
  }
): Promise<{ handled: boolean; followUp?: () => Promise<void> }> => {
  if (params.actionId !== ABSENCE_CALENDAR_PAGE_ACTION_ID) {
    return { handled: false };
  }

  const decoded = decodeAbsenceCalendarPageValue(params.pageValue);
  if (!decoded || decoded.userId !== params.userId) {
    return { handled: true };
  }

  const { day: todayJst } = getJstDateParts();
  const validation = validateAbsenceRange(decoded.from, decoded.to, todayJst);
  if (!validation.ok || !isSlackChannelId(decoded.channelId)) {
    return { handled: true };
  }

  return {
    handled: true,
    followUp: async () => {
      const reply = await buildAbsenceCalendarReply(config, {
        userId: decoded.userId,
        from: decoded.from,
        to: decoded.to,
        channelId: decoded.channelId,
        page: decoded.page,
        todayJst
      });
      await deliverAdminEphemeralReply(
        config,
        {
          userId: params.userId,
          responseUrl: params.responseUrl,
          channelId: params.channelId,
          replaceOriginal: true
        },
        reply
      );
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
