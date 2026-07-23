import type { AppConfig } from "../config";
import { postUserFacingMessage } from "./user-message";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";

export const ADMIN_EPHEMERAL_TEXT_MAX = 2800;

export const computeAdminTotalPages = (totalCount: number): number =>
  Math.max(1, Math.ceil(totalCount / ADMIN_EPHEMERAL_LIST_MAX));

export const normalizeAdminPage = (page: number, totalPages: number): number =>
  Math.min(Math.max(1, page), totalPages);

const adminEphemeralSectionBlock = (text: string): Record<string, unknown> => ({
  type: "section",
  text: { type: "mrkdwn", text }
});

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
      text: { type: "plain_text", text: `次ページ（${remaining} 件）→` },
      value: String(page + 1)
    });
  }
  if (elements.length === 0) return undefined;
  return [{ type: "actions", block_id: blockId, elements }];
};

export type AdminEphemeralPagination = {
  actionId: string;
  blockId: string;
  page: number;
  totalPages: number;
  totalCount: number;
};

export const buildAdminEphemeralBlocks = (
  text: string,
  pagination: AdminEphemeralPagination
): Array<Record<string, unknown>> | undefined => {
  const actions = buildAdminPaginationActions(
    pagination.actionId,
    pagination.blockId,
    pagination.page,
    pagination.totalPages,
    pagination.totalCount
  );
  if (!actions) return undefined;
  return [adminEphemeralSectionBlock(text), ...actions];
};

export type AdminEphemeralReply = {
  text: string;
  blocks?: Array<Record<string, unknown>>;
};

export const normalizeAdminEphemeralReply = (
  reply: AdminEphemeralReply | string
): AdminEphemeralReply => {
  if (typeof reply === "string") return { text: reply };
  if (!reply.blocks || reply.blocks.length === 0) return reply;
  const hasActions = reply.blocks.some((block) => block.type === "actions");
  if (!hasActions) return reply;
  const hasSection = reply.blocks.some((block) => block.type === "section");
  if (hasSection) return reply;
  return {
    text: reply.text,
    blocks: [adminEphemeralSectionBlock(reply.text), ...reply.blocks]
  };
};

export type AdminEphemeralPostOptions = {
  replaceOriginal?: boolean;
};

export const buildAdminEphemeralPostBody = (
  reply: AdminEphemeralReply | string,
  options?: AdminEphemeralPostOptions
): Record<string, unknown> => {
  const normalized = normalizeAdminEphemeralReply(reply);
  const body: Record<string, unknown> = {
    response_type: "ephemeral",
    text: normalized.text
  };
  if (options?.replaceOriginal) {
    body.replace_original = true;
  }
  if (normalized.blocks) {
    body.blocks = normalized.blocks;
  }
  return body;
};

export const postAdminEphemeralToResponseUrl = async (
  responseUrl: string,
  reply: AdminEphemeralReply | string,
  options?: AdminEphemeralPostOptions
): Promise<boolean> => {
  try {
    const response = await fetch(responseUrl, {
      method: "POST",
      headers: { "Content-Type": "application/json; charset=utf-8" },
      body: JSON.stringify(buildAdminEphemeralPostBody(reply, options))
    });
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: options?.replaceOriginal
            ? "admin_ephemeral_replace_failed"
            : "admin_ephemeral_post_failed",
          status: response.status
        })
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: options?.replaceOriginal
          ? "admin_ephemeral_replace_failed"
          : "admin_ephemeral_post_failed",
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return false;
  }
};

export const deliverAdminEphemeralReply = async (
  config: AppConfig,
  params: {
    userId: string;
    responseUrl?: string;
    channelId?: string;
    replaceOriginal?: boolean;
  },
  reply: AdminEphemeralReply | string
): Promise<void> => {
  const normalized = normalizeAdminEphemeralReply(reply);
  if (params.responseUrl) {
    const posted = await postAdminEphemeralToResponseUrl(params.responseUrl, normalized, {
      replaceOriginal: params.replaceOriginal
    });
    if (posted) return;
    if (params.replaceOriginal) return;
  }
  if (params.channelId) {
    try {
      await postUserFacingMessage(config, {
        channelId: params.channelId,
        userId: params.userId,
        text: normalized.text,
        blocks: normalized.blocks
      });
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "admin_ephemeral_post_failed",
          channel_id: params.channelId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
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
  const overflowSuffix = (hidden: number): string =>
    hiddenBeyondLines > 0 && hidden > hiddenBeyondLines
      ? `\n… 表示省略 ${hidden - hiddenBeyondLines} 件\n… 他 ${hiddenBeyondLines} 件`
      : hiddenBeyondLines > 0
        ? `\n… 他 ${hiddenBeyondLines} 件`
        : hidden > 0
          ? `\n… 表示省略 ${hidden} 件`
          : "";

  let visibleLines: string[] = [];
  for (const line of lines) {
    const trialLines = [...visibleLines, line];
    const hidden = hiddenBeyondLines + (lines.length - trialLines.length);
    const trial = `${header}\n${trialLines.join("\n")}${overflowSuffix(hidden)}`;
    if (trial.length > ADMIN_EPHEMERAL_TEXT_MAX) {
      break;
    }
    visibleLines = trialLines;
  }

  while (visibleLines.length > 0) {
    const hidden = hiddenBeyondLines + (lines.length - visibleLines.length);
    const parts = [header, ...visibleLines];
    const suffix = overflowSuffix(hidden);
    if (suffix.length > 0) {
      parts.push(suffix.trimStart());
    }
    const text = parts.join("\n");
    if (text.length <= ADMIN_EPHEMERAL_TEXT_MAX) {
      return text;
    }
    visibleLines = visibleLines.slice(0, -1);
  }

  const hidden = hiddenBeyondLines + lines.length;
  const fallback = `${header}${overflowSuffix(hidden)}`;
  if (fallback.length <= ADMIN_EPHEMERAL_TEXT_MAX) {
    return fallback;
  }
  return header.slice(0, ADMIN_EPHEMERAL_TEXT_MAX);
};
