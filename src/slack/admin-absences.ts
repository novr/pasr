import type { AppConfig } from "../config";
import {
  countAbsencesActiveOnDate,
  listAbsencesActiveOnDate
} from "../db/absence-repository";
import { checkDbSchema } from "../db/schema-check";
import { formatAbsenceListLine } from "../domain/absence-registration";
import { getJstDateParts } from "../domain/jst-date";
import { ADMIN_ABSENCES_PAGE_ACTION_ID } from "./action-ids";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";
import {
  buildAdminEphemeralBlocks,
  deliverEphemeralPageReply,
  formatAdminEphemeralMessage,
  formatEntityList,
  paginateEphemeralDisplayPages,
  type AdminEphemeralReply
} from "./admin-format";
import type { SlackCommandPayload } from "./command";

const formatAbsenceLine = (record: {
  targetUser: string;
  startDate: string;
  endDate: string;
  note?: string;
  notifyChannels: string[];
  notifyUsers: string[];
}): string => {
  const periodNote = formatAbsenceListLine(record);
  const ch = formatEntityList(record.notifyChannels.map((id) => `<#${id}>`), "なし");
  const dm = formatEntityList(record.notifyUsers.map((id) => `<@${id}>`), "なし");
  return `• <@${record.targetUser}> ${periodNote} | CH: ${ch} | DM: ${dm}`;
};

export const buildAbsencesTodayReply = async (
  config: AppConfig,
  page: number
): Promise<AdminEphemeralReply | string> => {
  const dbSchema = await checkDbSchema(config);
  if (dbSchema !== "ok") {
    return "db: schema_missing。`npx wrangler d1 migrations apply` を実行してください。";
  }

  const { day: todayJst } = getJstDateParts();
  const totalCount = await countAbsencesActiveOnDate(config, todayJst);
  const headerBase = `本日の不在 (${todayJst} JST): ${totalCount}件`;
  if (totalCount === 0) {
    return headerBase;
  }

  const preliminaryPages: string[][] = [];
  for (let offset = 0; offset < totalCount; offset += ADMIN_EPHEMERAL_LIST_MAX) {
    const records = await listAbsencesActiveOnDate(config, todayJst, {
      limit: ADMIN_EPHEMERAL_LIST_MAX,
      offset
    });
    preliminaryPages.push(records.map((record) => formatAbsenceLine(record)));
  }
  const display = paginateEphemeralDisplayPages(headerBase, preliminaryPages, page);
  const header = `${headerBase} — ページ ${display.currentPage}/${display.totalPages}`;
  const text = formatAdminEphemeralMessage(header, display.pageLines, 0);
  const blocks = buildAdminEphemeralBlocks(text, {
    actionId: ADMIN_ABSENCES_PAGE_ACTION_ID,
    blockIdPrefix: "pasr_admin_absences_pagination",
    page: display.currentPage,
    totalPages: display.totalPages,
    remainingEntryCount: display.remainingEntryCount
  });
  return blocks ? { text, blocks } : { text };
};

export const handleAbsencesCommand = async (
  config: AppConfig,
  _payload: SlackCommandPayload,
  page: number
): Promise<AdminEphemeralReply | string> => buildAbsencesTodayReply(config, page);

export const handleAdminAbsencesPageInteraction = async (
  config: AppConfig,
  params: {
    actionId: string;
    userId: string;
    pageValue: string;
    responseUrl?: string;
    channelId?: string;
  }
): Promise<{ handled: boolean; followUp?: () => Promise<void> }> => {
  if (params.actionId !== ADMIN_ABSENCES_PAGE_ACTION_ID) {
    return { handled: false };
  }
  if (!config.adminUserIds.includes(params.userId)) {
    return { handled: true };
  }
  const page = Number.parseInt(params.pageValue, 10);
  if (!Number.isFinite(page) || page < 1) {
    return { handled: true };
  }
  return {
    handled: true,
    followUp: async () => {
      const reply = await buildAbsencesTodayReply(config, page);
      await deliverEphemeralPageReply(config, params, reply);
    }
  };
};
