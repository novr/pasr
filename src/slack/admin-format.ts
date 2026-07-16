import type { AppConfig } from "../config";
import { slackApi } from "./api";
import { replaceInteractionEphemeral } from "./interaction-message";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";

export const ADMIN_EPHEMERAL_TEXT_MAX = 2800;

export const computeAdminTotalPages = (totalCount: number): number =>
  Math.max(1, Math.ceil(totalCount / ADMIN_EPHEMERAL_LIST_MAX));

export const normalizeAdminPage = (page: number, totalPages: number): number =>
  Math.min(Math.max(1, page), totalPages);

const buildAdminPaginationActions = (
  actionId: string,
  blockId: string,
  page: number,
  totalPages: number,
  totalCount: number
): Array<Record<string, unknown>> | undefined => {
  if (totalPages <= 1) return undefined;
  const elements: Array<Record<string, unknown>> = [];
  if (page > 1) {
    elements.push({
      type: "button",
      action_id: actionId,
      text: { type: "plain_text", text: `← ${page - 1}` },
      value: String(page - 1)
    });
  }
  const shownThrough = page * ADMIN_EPHEMERAL_LIST_MAX;
  const remaining = Math.max(0, totalCount - shownThrough);
  if (page < totalPages && remaining > 0) {
    elements.push({
      type: "button",
      action_id: actionId,
      text: { type: "plain_text", text: `他 ${remaining} 件 →` },
      value: String(page + 1)
    });
  }
  if (elements.length === 0) return undefined;
  return [{ type: "actions", block_id: blockId, elements }];
};

export const buildAdminEphemeralBlocks = (
  text: string,
  actionId: string,
  blockId: string,
  page: number,
  totalPages: number,
  totalCount: number
): Array<Record<string, unknown>> | undefined => {
  const pagination = buildAdminPaginationActions(actionId, blockId, page, totalPages, totalCount);
  if (!pagination) return undefined;
  return [{ type: "section", text: { type: "mrkdwn", text } }, ...pagination];
};

export type AdminEphemeralReply = {
  text: string;
  blocks?: Array<Record<string, unknown>>;
};

export const deliverAdminEphemeralReply = async (
  config: AppConfig,
  params: {
    userId: string;
    responseUrl?: string;
    channelId?: string;
  },
  reply: AdminEphemeralReply | string
): Promise<void> => {
  if (typeof reply === "string") {
    if (params.responseUrl) {
      await replaceInteractionEphemeral(params.responseUrl, { text: reply });
      return;
    }
    if (params.channelId) {
      await slackApi.postEphemeral(config, params.channelId, params.userId, reply);
    }
    return;
  }
  if (params.responseUrl) {
    await replaceInteractionEphemeral(params.responseUrl, reply);
    return;
  }
  if (params.channelId) {
    await slackApi.postEphemeral(config, params.channelId, params.userId, reply.text, reply.blocks);
  }
};

export const formatEntityList = (entities: string[], emptyLabel: string, maxVisible = 2): string => {
  if (entities.length === 0) return emptyLabel;
  const visible = entities.slice(0, maxVisible);
  const rest = entities.length - visible.length;
  const base = visible.join(" ");
  return rest > 0 ? `${base} 他 ${rest}` : base;
};

export const formatAdminEphemeralMessage = (
  header: string,
  lines: string[],
  hiddenBeyondLines: number
): string => {
  let visibleLines: string[] = [];
  for (const line of lines) {
    const trialLines = [...visibleLines, line];
    const hidden = hiddenBeyondLines + (lines.length - trialLines.length);
    const suffix = hidden > 0 ? `\n… 他 ${hidden} 件` : "";
    const trial = `${header}\n${trialLines.join("\n")}${suffix}`;
    if (trial.length > ADMIN_EPHEMERAL_TEXT_MAX) {
      break;
    }
    visibleLines = trialLines;
  }

  while (visibleLines.length > 0) {
    const hidden = hiddenBeyondLines + (lines.length - visibleLines.length);
    const parts = [header, ...visibleLines];
    if (hidden > 0) {
      parts.push(`… 他 ${hidden} 件`);
    }
    const text = parts.join("\n");
    if (text.length <= ADMIN_EPHEMERAL_TEXT_MAX) {
      return text;
    }
    visibleLines = visibleLines.slice(0, -1);
  }

  const hidden = hiddenBeyondLines + lines.length;
  const suffix = hidden > 0 ? `\n… 他 ${hidden} 件` : "";
  const fallback = `${header}${suffix}`;
  if (fallback.length <= ADMIN_EPHEMERAL_TEXT_MAX) {
    return fallback;
  }
  return header.slice(0, ADMIN_EPHEMERAL_TEXT_MAX);
};
