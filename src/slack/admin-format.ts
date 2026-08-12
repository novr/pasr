import type { AppConfig } from "../config";
import { postUserFacingMessage } from "./user-message";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";

export const ADMIN_EPHEMERAL_TEXT_MAX = 2800;

export const computeAdminTotalPages = (totalCount: number): number =>
  Math.max(1, Math.ceil(totalCount / ADMIN_EPHEMERAL_LIST_MAX));

export const normalizeAdminPage = (page: number, totalPages: number): number =>
  Math.min(Math.max(1, page), totalPages);

export const computeAdminRemainingEntryCount = (page: number, totalCount: number): number =>
  Math.max(0, totalCount - page * ADMIN_EPHEMERAL_LIST_MAX);

export const ephemeralPaginationBlockId = (blockIdPrefix: string, page: number): string =>
  `${blockIdPrefix}_p${page}`;

const adminEphemeralSectionBlock = (text: string): Record<string, unknown> => ({
  type: "section",
  text: { type: "mrkdwn", text }
});

const defaultEphemeralPageValue = (page: number): string => String(page);

export type EphemeralPaginationSpec = {
  actionId: string;
  blockIdPrefix: string;
  page: number;
  totalPages: number;
  remainingEntryCount: number;
  pageValue?: (page: number) => string;
};

export const adminListPagination = (
  params: Omit<EphemeralPaginationSpec, "remainingEntryCount" | "pageValue"> & {
    totalCount: number;
  }
): EphemeralPaginationSpec => ({
  actionId: params.actionId,
  blockIdPrefix: params.blockIdPrefix,
  page: params.page,
  totalPages: params.totalPages,
  remainingEntryCount: computeAdminRemainingEntryCount(params.page, params.totalCount)
});

export const buildEphemeralPaginationActions = (
  spec: EphemeralPaginationSpec
): Array<Record<string, unknown>> | undefined => {
  const pageValue = spec.pageValue ?? defaultEphemeralPageValue;
  if (spec.totalPages <= 1) return undefined;
  const elements: Array<Record<string, unknown>> = [];
  if (spec.page > 1) {
    elements.push({
      type: "button",
      action_id: spec.actionId,
      text: { type: "plain_text", text: `← ${spec.page - 1}` },
      value: pageValue(spec.page - 1)
    });
  }
  if (spec.page < spec.totalPages && spec.remainingEntryCount > 0) {
    elements.push({
      type: "button",
      action_id: spec.actionId,
      text: { type: "plain_text", text: `次ページ（${spec.remainingEntryCount} 件）→` },
      value: pageValue(spec.page + 1)
    });
  }
  if (elements.length === 0) return undefined;
  return [
    {
      type: "actions",
      block_id: ephemeralPaginationBlockId(spec.blockIdPrefix, spec.page),
      elements
    }
  ];
};

export type AdminEphemeralPagination = EphemeralPaginationSpec;

export const buildAdminEphemeralBlocks = (
  text: string,
  pagination: EphemeralPaginationSpec
): Array<Record<string, unknown>> | undefined => {
  const actions = buildEphemeralPaginationActions(pagination);
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
  deleteOriginal?: boolean;
};

const adminEphemeralFailureEvent = (options?: AdminEphemeralPostOptions): string => {
  if (options?.deleteOriginal) return "admin_ephemeral_delete_failed";
  if (options?.replaceOriginal) return "admin_ephemeral_replace_failed";
  return "admin_ephemeral_post_failed";
};

export const buildAdminEphemeralPostBody = (
  reply: AdminEphemeralReply | string,
  options?: AdminEphemeralPostOptions
): Record<string, unknown> => {
  if (options?.deleteOriginal) {
    return {
      response_type: "ephemeral",
      delete_original: true
    };
  }
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
    const body = await response.text();
    if (!response.ok) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: adminEphemeralFailureEvent(options),
          status: response.status,
          body: body.slice(0, 500)
        })
      );
      return false;
    }
    if (body.trim() === "ok") return true;
    try {
      const parsed = JSON.parse(body) as { ok?: boolean; error?: string };
      if (parsed.ok === false) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: adminEphemeralFailureEvent(options),
            slack_error: parsed.error,
            body: body.slice(0, 500)
          })
        );
        return false;
      }
    } catch {
      // Non-JSON success bodies are treated as ok when HTTP status is 2xx.
    }
    return true;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: adminEphemeralFailureEvent(options),
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

export const deliverEphemeralPageReply = async (
  config: AppConfig,
  params: {
    userId: string;
    responseUrl?: string;
    channelId?: string;
  },
  reply: AdminEphemeralReply | string
): Promise<void> => {
  const normalized = normalizeAdminEphemeralReply(reply);
  if (params.responseUrl) {
    const replaced = await postAdminEphemeralToResponseUrl(params.responseUrl, normalized, {
      replaceOriginal: true
    });
    if (replaced) return;
  }
  await deliverAdminEphemeralReply(config, params, reply);
};

export const formatEntityList = (entities: string[], emptyLabel: string, maxVisible = 2): string => {
  if (entities.length === 0) return emptyLabel;
  const visible = entities.slice(0, maxVisible);
  const rest = entities.length - visible.length;
  const base = visible.join(" ");
  return rest > 0 ? `${base} 他 ${rest}` : base;
};

const ephemeralOverflowSuffix = (hidden: number, hiddenBeyondLines: number): string =>
  hiddenBeyondLines > 0 && hidden > hiddenBeyondLines
    ? `\n… 表示省略 ${hidden - hiddenBeyondLines} 件\n… 他 ${hiddenBeyondLines} 件`
    : hiddenBeyondLines > 0
      ? `\n… 他 ${hiddenBeyondLines} 件`
      : hidden > 0
        ? `\n… 表示省略 ${hidden} 件`
        : "";

export const fitEphemeralVisibleLines = (
  header: string,
  lines: string[],
  hiddenBeyondLines: number
): { visibleLines: string[]; omittedCount: number } => {
  let visibleLines: string[] = [];
  for (const line of lines) {
    const trialLines = [...visibleLines, line];
    const hidden = hiddenBeyondLines + (lines.length - trialLines.length);
    const trial = `${header}\n${trialLines.join("\n")}${ephemeralOverflowSuffix(hidden, hiddenBeyondLines)}`;
    if (trial.length > ADMIN_EPHEMERAL_TEXT_MAX) {
      break;
    }
    visibleLines = trialLines;
  }

  while (visibleLines.length > 0) {
    const hidden = hiddenBeyondLines + (lines.length - visibleLines.length);
    const parts = [header, ...visibleLines];
    const suffix = ephemeralOverflowSuffix(hidden, hiddenBeyondLines);
    if (suffix.length > 0) {
      parts.push(suffix.trimStart());
    }
    const text = parts.join("\n");
    if (text.length <= ADMIN_EPHEMERAL_TEXT_MAX) {
      return { visibleLines, omittedCount: lines.length - visibleLines.length };
    }
    visibleLines = visibleLines.slice(0, -1);
  }

  return { visibleLines: [], omittedCount: lines.length };
};

export const countEphemeralEntryLines = (lines: string[]): number =>
  lines.filter((line) => line.startsWith("•")).length;

const prependEphemeralDayHeaderIfNeeded = (
  previousLines: string[],
  nextLines: string[]
): string[] => {
  if (nextLines.length === 0 || nextLines[0]?.startsWith("*")) {
    return nextLines;
  }
  if (!nextLines[0]?.startsWith("•")) {
    return nextLines;
  }
  const lastHeader = [...previousLines].reverse().find((line) => line.startsWith("*"));
  if (!lastHeader) {
    return nextLines;
  }
  return [lastHeader, ...nextLines];
};

export const ephemeralPaginationFitHeader = (summaryHeader: string): string =>
  `${summaryHeader} — ページ 999/999`;

export const splitEphemeralLinesByTextFit = (header: string, lines: string[]): string[][] => {
  if (lines.length === 0) {
    return [];
  }
  const pages: string[][] = [];
  let remaining = lines;
  while (remaining.length > 0) {
    const { visibleLines, omittedCount } = fitEphemeralVisibleLines(header, remaining, 0);
    if (visibleLines.length === 0) {
      pages.push([remaining[0]!]);
      remaining = remaining.slice(1);
      continue;
    }
    pages.push(visibleLines);
    if (omittedCount === 0) {
      break;
    }
    let nextRemaining = remaining.slice(visibleLines.length);
    const showedEntryOnPage = visibleLines.some((line) => line.startsWith("•"));
    if (showedEntryOnPage) {
      nextRemaining = prependEphemeralDayHeaderIfNeeded(visibleLines, nextRemaining);
    }
    remaining = nextRemaining;
  }
  return pages;
};

const expandEphemeralPreliminaryPagesByTextFit = (
  header: string,
  preliminaryPages: string[][]
): string[][] => {
  const displayPages: string[][] = [];
  for (const preliminary of preliminaryPages) {
    displayPages.push(...splitEphemeralLinesByTextFit(header, preliminary));
  }
  return displayPages.length > 0 ? displayPages : [[]];
};

export type EphemeralDisplayPaginationResult = {
  currentPage: number;
  totalPages: number;
  pageLines: string[];
  remainingEntryCount: number;
};

export const paginateEphemeralDisplayPages = (
  summaryHeader: string,
  preliminaryPages: string[][],
  requestedPage: number
): EphemeralDisplayPaginationResult => {
  const fitHeader = ephemeralPaginationFitHeader(summaryHeader);
  const displayPages = expandEphemeralPreliminaryPagesByTextFit(fitHeader, preliminaryPages);
  const totalPages = Math.max(1, displayPages.length);
  const currentPage = normalizeAdminPage(requestedPage, totalPages);
  const pageLines = displayPages[currentPage - 1] ?? [];
  const remainingEntryCount = countEphemeralEntryLines(displayPages.slice(currentPage).flat());
  return { currentPage, totalPages, pageLines, remainingEntryCount };
};

export const formatAdminEphemeralMessage = (
  header: string,
  lines: string[],
  hiddenBeyondLines: number
): string => {
  const { visibleLines, omittedCount } = fitEphemeralVisibleLines(header, lines, hiddenBeyondLines);
  if (visibleLines.length === 0 && omittedCount > 0) {
    const hidden = hiddenBeyondLines + omittedCount;
    const fallback = `${header}${ephemeralOverflowSuffix(hidden, hiddenBeyondLines)}`;
    if (fallback.length <= ADMIN_EPHEMERAL_TEXT_MAX) {
      return fallback;
    }
    return header.slice(0, ADMIN_EPHEMERAL_TEXT_MAX);
  }
  const hidden = hiddenBeyondLines + omittedCount;
  const parts = [header, ...visibleLines];
  const suffix = ephemeralOverflowSuffix(hidden, hiddenBeyondLines);
  if (suffix.length > 0) {
    parts.push(suffix.trimStart());
  }
  return parts.join("\n");
};
