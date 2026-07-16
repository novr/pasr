import type { AppConfig } from "../config";
import { isStatusOAuthEnabled } from "../config";
import {
  listMemberMasterRecords,
  type MemberMasterRecord
} from "../db/member-master-repository";
import { checkDbSchema, checkSlackUserOAuthSchema } from "../db/schema-check";
import { listSlackUserOAuthForUserIds } from "../db/slack-user-oauth-repository";
import { countMemberMasterActive, countMemberMasterTotal } from "../db/stats-repository";
import { formatRegistrationNotifyModeLabel } from "../domain/absence-registration";
import { ADMIN_USERS_PAGE_ACTION_ID } from "./action-ids";
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

const formatUserLine = (master: MemberMasterRecord, statusLabel: string): string => {
  const activeLabel = master.active ? "active" : "inactive";
  const ch = formatEntityList(
    master.defaultNotifyChannels.map((id) => `<#${id}>`),
    "なし"
  );
  const dm = formatEntityList(
    master.defaultNotifyUsers.map((id) => `<@${id}>`),
    "なし"
  );
  const regNotify = formatRegistrationNotifyModeLabel(master.defaultRegistrationNotify);
  return `• <@${master.targetUser}> ${activeLabel} | Status: ${statusLabel} | 登録通知: ${regNotify} | CH: ${ch} | DM: ${dm}`;
};

const resolveStatusLabel = async (
  config: AppConfig,
  records: MemberMasterRecord[]
): Promise<Map<string, string>> => {
  const labels = new Map<string, string>();
  if (!isStatusOAuthEnabled(config)) {
    for (const record of records) labels.set(record.targetUser, "n/a");
    return labels;
  }
  const oauthSchema = await checkSlackUserOAuthSchema(config);
  if (oauthSchema !== "ok") {
    for (const record of records) labels.set(record.targetUser, "n/a");
    return labels;
  }
  const oauthMap = await listSlackUserOAuthForUserIds(
    config,
    records.map((record) => record.targetUser)
  );
  for (const record of records) {
    labels.set(record.targetUser, oauthMap.has(record.targetUser) ? "連携済み" : "未連携");
  }
  return labels;
};

export const buildUsersListReply = async (
  config: AppConfig,
  page: number
): Promise<AdminEphemeralReply | string> => {
  const dbSchema = await checkDbSchema(config);
  if (dbSchema !== "ok") {
    return "db: schema_missing。`npx wrangler d1 migrations apply` を実行してください。";
  }

  const [activeCount, totalCount] = await Promise.all([
    countMemberMasterActive(config),
    countMemberMasterTotal(config)
  ]);
  if (totalCount === 0) {
    return "PASR 登録ユーザーは 0 件です。";
  }

  const totalPages = computeAdminTotalPages(totalCount);
  const currentPage = normalizeAdminPage(page, totalPages);
  const offset = (currentPage - 1) * ADMIN_EPHEMERAL_LIST_MAX;
  const records = await listMemberMasterRecords(config, {
    limit: ADMIN_EPHEMERAL_LIST_MAX,
    offset
  });
  const statusLabels = await resolveStatusLabel(config, records);
  const lines = records.map((master) =>
    formatUserLine(master, statusLabels.get(master.targetUser) ?? "n/a")
  );
  const header = `PASR 登録ユーザー (active ${activeCount} / 全 ${totalCount}) — ページ ${currentPage}/${totalPages}`;
  const text = formatAdminEphemeralMessage(header, lines, 0);
  const blocks = buildAdminEphemeralBlocks(text, {
    actionId: ADMIN_USERS_PAGE_ACTION_ID,
    blockId: "pasr_admin_users_pagination",
    page: currentPage,
    totalPages,
    totalCount
  });
  return blocks ? { text, blocks } : { text };
};

export const handleUsersCommand = async (
  config: AppConfig,
  _payload: SlackCommandPayload,
  page: number
): Promise<AdminEphemeralReply | string> => buildUsersListReply(config, page);

export const handleAdminUsersPageInteraction = async (
  config: AppConfig,
  params: {
    actionId: string;
    userId: string;
    pageValue: string;
    responseUrl?: string;
    channelId?: string;
  }
): Promise<{ handled: boolean; followUp?: () => Promise<void> }> => {
  if (params.actionId !== ADMIN_USERS_PAGE_ACTION_ID) {
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
      const reply = await buildUsersListReply(config, page);
      await deliverAdminEphemeralReply(config, { ...params, replaceOriginal: true }, reply);
    }
  };
};
