import type { AppConfig } from "../config";
import {
  filterOwnFutureAbsences,
  parseAbsence,
  type AbsenceRecord
} from "../domain/absence";
import { formatAbsenceListLine } from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { resolveActiveListIds } from "../jobs/setup";
import { slackApi } from "./api";
import type { SlackCommandPayload } from "./command";

export const ABSENCE_LIST_MAX_ROWS = 25;
export const ABSENCE_DELETE_ACTION_ID = "pasr_absence_delete";
export const ABSENCE_EDIT_OPEN_ACTION_ID = "pasr_absence_edit_open";

type ListInteractionPayload = {
  type: string;
  user?: { id?: string };
  channel?: { id?: string };
  response_url?: string;
  actions?: Array<{ action_id?: string; value?: string }>;
};

export type AbsenceListInteractionResult = {
  ok: boolean;
  followUp?: () => Promise<void>;
};

const postResponseUrlEphemeral = async (
  responseUrl: string,
  text: string,
  blocks?: Array<Record<string, unknown>>
): Promise<void> => {
  const body: Record<string, unknown> = { response_type: "ephemeral", text };
  if (blocks) body.blocks = blocks;
  const response = await fetch(responseUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json; charset=utf-8" },
    body: JSON.stringify(body)
  });
  if (!response.ok) {
    throw new Error(`response_url post failed: ${response.status}`);
  }
};

export const buildOwnAbsenceListBlocks = (
  records: AbsenceRecord[],
  options?: { includeEdit?: boolean }
): { blocks: Array<Record<string, unknown>>; omitted: number } => {
  const includeEdit = options?.includeEdit ?? true;
  const omitted = Math.max(0, records.length - ABSENCE_LIST_MAX_ROWS);
  const visible = records.slice(0, ABSENCE_LIST_MAX_ROWS);
  const blocks: Array<Record<string, unknown>> = [];
  for (const record of visible) {
    blocks.push({
      type: "section",
      text: {
        type: "mrkdwn",
        text: `${formatAbsenceListLine(record)}\n\`${record.itemId}\``
      }
    });
    const elements: Array<Record<string, unknown>> = [];
    if (includeEdit) {
      elements.push({
        type: "button",
        action_id: ABSENCE_EDIT_OPEN_ACTION_ID,
        text: { type: "plain_text", text: "編集" },
        value: record.itemId
      });
    }
    elements.push({
      type: "button",
      action_id: ABSENCE_DELETE_ACTION_ID,
      text: { type: "plain_text", text: "削除" },
      style: "danger",
      value: record.itemId
    });
    blocks.push({ type: "actions", elements });
  }
  return { blocks, omitted };
};

export const showOwnAbsenceList = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  options?: { prefixMessage?: string; includeEdit?: boolean }
): Promise<void> => {
  try {
    const { absenceListId } = await resolveActiveListIds(config);
    const { day: todayJst } = getJstDateParts();
    const listResponse = await slackApi.listItems(config, absenceListId, { fetchContext: "absence_list" });
    const records: AbsenceRecord[] = [];
    for (const item of listResponse.items ?? []) {
      const parsed = parseAbsence(item);
      if (parsed.ok) records.push(parsed.record);
    }
    const own = filterOwnFutureAbsences(records, payload.userId, todayJst);
    const prefixParts: string[] = [];
    if (options?.prefixMessage) prefixParts.push(options.prefixMessage);
    if (own.length === 0) {
      prefixParts.push("表示できる不在はありません。");
    }
    const { blocks, omitted } = buildOwnAbsenceListBlocks(own, { includeEdit: options?.includeEdit });
    if (omitted > 0) {
      prefixParts.push(`他 ${omitted} 件は省略しました。Slack List で確認してください。`);
    }
    const text = prefixParts.length > 0 ? prefixParts.join("\n") : "あなたの不在一覧です。";
    if (payload.responseUrl) {
      await postResponseUrlEphemeral(payload.responseUrl, text, blocks.length > 0 ? blocks : undefined);
    } else if (payload.channelId) {
      await slackApi.postEphemeral(
        config,
        payload.channelId,
        payload.userId,
        text,
        blocks.length > 0 ? blocks : undefined
      );
    }
    console.log(
      JSON.stringify({
        level: "info",
        event: "absence_list_done",
        user_id: payload.userId,
        row_count: own.length,
        omitted
      })
    );
  } catch (error) {
    console.error(
      JSON.stringify({
        level: "error",
        event: "absence_list_failed",
        user_id: payload.userId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    throw error;
  }
};

const reloadListAfterDelete = async (
  config: AppConfig,
  actorUserId: string,
  responseUrl: string,
  channelId: string
): Promise<void> => {
  const commandPayload: SlackCommandPayload = {
    command: "/pasr",
    text: "list",
    userId: actorUserId,
    teamId: "",
    channelId,
    triggerId: "",
    responseUrl
  };
  await showOwnAbsenceList(config, commandPayload, { prefixMessage: "削除しました。" });
};

export const handleAbsenceListInteraction = async (
  config: AppConfig,
  payload: ListInteractionPayload
): Promise<AbsenceListInteractionResult> => {
  if (payload.type !== "block_actions") return { ok: true };
  const action = payload.actions?.[0];
  if (!action || action.action_id !== ABSENCE_DELETE_ACTION_ID) return { ok: true };
  const itemId = action.value ?? "";
  const actorUserId = payload.user?.id ?? "";
  const responseUrl = payload.response_url ?? "";
  if (!itemId || !actorUserId || !responseUrl) return { ok: true };

  return {
    ok: true,
    followUp: async () => {
      try {
        const { absenceListId } = await resolveActiveListIds(config);
        const listResponse = await slackApi.listItems(config, absenceListId, { fetchContext: "absence_delete" });
        const item = (listResponse.items ?? []).find((entry) => entry.id === itemId);
        if (!item) {
          await postResponseUrlEphemeral(responseUrl, "対象の不在が見つかりませんでした。");
          return;
        }
        const parsed = parseAbsence(item);
        if (!parsed.ok || parsed.record.targetUser !== actorUserId) {
          await postResponseUrlEphemeral(responseUrl, "本人の不在のみ削除できます。");
          return;
        }
        await slackApi.deleteAbsenceItem(config, absenceListId, itemId);
        await reloadListAfterDelete(
          config,
          actorUserId,
          responseUrl,
          payload.channel?.id ?? ""
        );
      } catch (error) {
        console.error(
          JSON.stringify({
            level: "error",
            event: "absence_delete_failed",
            user_id: actorUserId,
            itemId,
            message: error instanceof Error ? error.message : String(error)
          })
        );
        await postResponseUrlEphemeral(
          responseUrl,
          `削除に失敗しました: ${error instanceof Error ? error.message : String(error)}`
        );
      }
    }
  };
};
