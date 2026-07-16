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
  computeAdminTotalPages,
  deliverAdminEphemeralReply,
  formatAdminEphemeralMessage,
  formatEntityList,
  normalizeAdminPage,
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

  const totalPages = computeAdminTotalPages(totalCount);
  const currentPage = normalizeAdminPage(page, totalPages);
  const offset = (currentPage - 1) * ADMIN_EPHEMERAL_LIST_MAX;
  const records = await listAbsencesActiveOnDate(config, todayJst, {
    limit: ADMIN_EPHEMERAL_LIST_MAX,
    offset
  });
  const header = `${headerBase} — ページ ${currentPage}/${totalPages}`;
  const lines = records.map((record) => formatAbsenceLine(record));
  const text = formatAdminEphemeralMessage(header, lines, 0);
  const blocks = buildAdminEphemeralBlocks(
    text,
    ADMIN_ABSENCES_PAGE_ACTION_ID,
    "pasr_admin_absences_pagination",
    currentPage,
    totalPages,
    totalCount
  );
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
      await deliverAdminEphemeralReply(config, params, reply);
    }
  };
};
