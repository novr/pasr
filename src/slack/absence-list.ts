import type { AppConfig } from "../config";
import { getJstDateParts } from "../domain/jst-date";
import { deleteAbsenceById, getAbsenceById, listAbsencesByUserFuture } from "../db/absence-repository";
import { reconcileStatusIfRecordsAffectToday } from "../jobs/status-sync";
import {
  ABSENCE_DELETE_ACTION_ID,
  ABSENCE_EDIT_OPEN_ACTION_ID,
  ABSENCE_LIST_MAX_ROWS,
  buildOwnAbsenceListBlocks
} from "./absence-list-blocks";
import { refreshAppHomeAfterMutation } from "./app-home-publish";
import { isAppHomeBlockActions } from "./app-home-context";
import type { SlackCommandPayload } from "./command";
import { postUserFacingMessage } from "./user-message";

export {
  ABSENCE_DELETE_ACTION_ID,
  ABSENCE_EDIT_OPEN_ACTION_ID,
  ABSENCE_LIST_MAX_ROWS,
  buildOwnAbsenceListBlocks
} from "./absence-list-blocks";

type ListInteractionPayload = {
  type: string;
  user?: { id?: string };
  channel?: { id?: string };
  response_url?: string;
  container?: { type?: string };
  view?: { type?: string };
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

export const showOwnAbsenceList = async (
  config: AppConfig,
  payload: SlackCommandPayload,
  options?: { prefixMessage?: string; includeEdit?: boolean }
): Promise<void> => {
  try {
    const { day: todayJst } = getJstDateParts();
    const own = await listAbsencesByUserFuture(config, payload.userId, todayJst);
    const prefixParts: string[] = [];
    if (options?.prefixMessage) prefixParts.push(options.prefixMessage);
    if (own.length === 0) {
      prefixParts.push("表示できる不在予定はありません。");
    }
    const { blocks, omitted } = buildOwnAbsenceListBlocks(own, { includeEdit: options?.includeEdit });
    if (omitted > 0) {
      prefixParts.push(`他 ${omitted} 件は省略しました。`);
    }
    const text = prefixParts.length > 0 ? prefixParts.join("\n") : "あなたの不在予定一覧です。";
    if (payload.responseUrl) {
      await postResponseUrlEphemeral(payload.responseUrl, text, blocks.length > 0 ? blocks : undefined);
    } else if (payload.channelId) {
      await postUserFacingMessage(config, {
        channelId: payload.channelId,
        userId: payload.userId,
        text,
        blocks: blocks.length > 0 ? blocks : undefined
      });
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
  const fromAppHome = isAppHomeBlockActions(payload);
  if (!itemId || !actorUserId) return { ok: true };
  if (!fromAppHome && !responseUrl) return { ok: true };

  return {
    ok: true,
    followUp: async () => {
      let deletedRecord: Awaited<ReturnType<typeof getAbsenceById>> | undefined;
      let deleteSucceeded = false;
      try {
        const record = await getAbsenceById(config, itemId);
        if (!record) {
          if (responseUrl) {
            await postResponseUrlEphemeral(responseUrl, "対象の不在予定が見つかりませんでした。");
          }
          return;
        }
        if (record.targetUser !== actorUserId) {
          if (responseUrl) {
            await postResponseUrlEphemeral(responseUrl, "本人の不在予定のみ削除できます。");
          }
          return;
        }
        await deleteAbsenceById(config, itemId);
        deleteSucceeded = true;
        deletedRecord = record;
        if (fromAppHome) {
          await refreshAppHomeAfterMutation(config, actorUserId);
        } else {
          await reloadListAfterDelete(
            config,
            actorUserId,
            responseUrl,
            payload.channel?.id ?? ""
          );
        }
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
        if (responseUrl) {
          await postResponseUrlEphemeral(
            responseUrl,
            `削除に失敗しました: ${error instanceof Error ? error.message : String(error)}`
          );
        }
      } finally {
        if (deleteSucceeded && deletedRecord) {
          await reconcileStatusIfRecordsAffectToday(config, {
            userId: actorUserId,
            records: [deletedRecord],
            runId: crypto.randomUUID()
          });
        }
      }
    }
  };
};
