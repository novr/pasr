import type { AppConfig } from "../config";
import { ABSENCE_LIST_NAME, absenceSchema, type AbsenceRecord } from "../domain/absence";
import { parseRegistrationNotifyMode, type RegistrationNotifyMode } from "../domain/absence-registration";
import {
  MEMBER_MASTER_LIST_NAME,
  memberMasterSchema,
  type MemberMasterRow,
  type ResolveMemberMasterRecordResult
} from "../domain/member-master";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "../domain/slack-list-value";
import { slackApiPost } from "./client";
import { createListDiscovery } from "./list-discovery";
import {
  cacheListSchema,
  readListSchemaColumns,
  readSchemaFromCreateResponse,
  resolveAbsenceColumnIds,
  resolveMemberMasterColumnIds,
  richTextField
} from "./list-columns";

type SlackListItem = {
  id: string;
  fields?: Record<string, unknown>;
  values?: Record<string, unknown>;
  updated_timestamp?: string;
};

type SlackListItemsListResponse = {
  items?: SlackListItem[];
  response_metadata?: {
    next_cursor?: string;
  };
};

type SlackListCreateResponse = {
  list_id?: string;
  list?: { id?: string };
  list_metadata?: {
    schema?: Array<{ key?: string; id?: string; name?: string; type?: string }>;
  };
};

type SlackListItemCreateResponse = {
  id?: string;
  item?: { id?: string };
};

type SlackViewOpenResponse = {
  view?: { id?: string };
};

type SlackConversationOpenResponse = {
  channel?: {
    id?: string;
  };
};

const parseMemberMasterRow = (item: SlackListItem): MemberMasterRow | undefined => {
  const targetUser = toStringValue(pickListField(item, "target_user")) || toStringValue(pickListField(item, "member_key"));
  if (!targetUser) return undefined;
  const active = toBooleanValue(pickListField(item, "active")) ?? true;
  const defaultNotifyChannels = [...new Set(toStringArray(pickListField(item, "default_notify_channels")))];
  const defaultNotifyUsers = [...new Set(toStringArray(pickListField(item, "default_notify_users")))];
  const defaultRegistrationNotify = parseRegistrationNotifyMode(
    toStringValue(pickListField(item, "default_registration_notify"))
  );
  const updatedTimestamp = Number(item.updated_timestamp ?? "") || 0;
  return {
    itemId: item.id,
    targetUser,
    active,
    defaultNotifyChannels,
    defaultNotifyUsers,
    defaultRegistrationNotify,
    updatedTimestamp
  };
};

const fetchListItems = async (config: AppConfig, listId: string): Promise<{ items: SlackListItem[] }> => {
  const items: SlackListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await slackApiPost<SlackListItemsListResponse>(config, "slackLists.items.list", {
      list_id: listId,
      limit: 200,
      cursor
    });
    items.push(...(page.items ?? []));
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return { items };
};

const findListIdsByName = async (config: AppConfig, listName: string): Promise<string[]> => {
  const discovery = await createListDiscovery(config, { userId: await getAuthedUserId(config) });
  return discovery.findByExactName(listName);
};

let authedUserIdByToken = new Map<string, string>();

const getAuthedUserId = async (config: AppConfig): Promise<string> => {
  const cached = authedUserIdByToken.get(config.slackBotToken);
  if (cached) return cached;
  const result = await slackApiPost<{ user_id?: string }>(config, "auth.test", {});
  const userId = result.user_id;
  if (!userId) throw new Error("auth.test response missing user_id");
  authedUserIdByToken.set(config.slackBotToken, userId);
  return userId;
};

const createList = async (
  config: AppConfig,
  name: string,
  schema: typeof absenceSchema | typeof memberMasterSchema
): Promise<SlackListCreateResponse> => {
  const created = await slackApiPost<SlackListCreateResponse>(config, "slackLists.create", {
    name,
    schema
  });
  const listId = created.list_id ?? created.list?.id;
  if (listId) {
    cacheListSchema(listId, readSchemaFromCreateResponse(created));
  }
  return created;
};

const buildMemberMasterInitialFields = (
  columnIds: NonNullable<Awaited<ReturnType<typeof resolveMemberMasterColumnIds>>>,
  targetUser: string,
  defaultChannels: string[],
  defaultUsers: string[],
  active = true,
  defaultRegistrationNotify: RegistrationNotifyMode = "none"
): Array<Record<string, unknown>> => {
  const initialFields: Array<Record<string, unknown>> = [
    richTextField(columnIds.primaryText, targetUser),
    { column_id: columnIds.targetUser, user: [targetUser] },
    { column_id: columnIds.active, checkbox: active }
  ];
  if (columnIds.defaultNotifyChannels && defaultChannels.length > 0) {
    initialFields.push({ column_id: columnIds.defaultNotifyChannels, channel: defaultChannels });
  }
  if (columnIds.defaultNotifyUsers && defaultUsers.length > 0) {
    initialFields.push({ column_id: columnIds.defaultNotifyUsers, user: defaultUsers });
  }
  if (columnIds.defaultRegistrationNotify) {
    initialFields.push({
      column_id: columnIds.defaultRegistrationNotify,
      select: [defaultRegistrationNotify]
    });
  }
  return initialFields;
};

const buildAbsenceInitialFields = (
  columnIds: NonNullable<Awaited<ReturnType<typeof resolveAbsenceColumnIds>>>,
  record: AbsenceRecord
): Array<Record<string, unknown>> => {
  const title = record.note?.trim() || record.targetUser;
  const initialFields: Array<Record<string, unknown>> = [
    richTextField(columnIds.absenceTitle, title),
    { column_id: columnIds.targetUser, user: [record.targetUser] },
    { column_id: columnIds.startDate, date: [record.startDate] },
    { column_id: columnIds.endDate, date: [record.endDate] }
  ];
  if (columnIds.type && record.absenceType) {
    initialFields.push({ column_id: columnIds.type, select: [record.absenceType] });
  }
  if (columnIds.notifyChannels && record.notifyChannels.length > 0) {
    initialFields.push({ column_id: columnIds.notifyChannels, channel: record.notifyChannels });
  }
  if (columnIds.notifyUsers && record.notifyUsers.length > 0) {
    initialFields.push({ column_id: columnIds.notifyUsers, user: record.notifyUsers });
  }
  if (columnIds.note && record.note) {
    initialFields.push(richTextField(columnIds.note, record.note));
  }
  return initialFields;
};

export const slackApi = {
  createAbsenceList: async (config: AppConfig) => createList(config, ABSENCE_LIST_NAME, absenceSchema),

  readAbsenceSchemaColumns: async (config: AppConfig, listId: string) => readListSchemaColumns(config, listId),

  createMemberMasterList: async (config: AppConfig) => createList(config, MEMBER_MASTER_LIST_NAME, memberMasterSchema),

  readMemberMasterSchemaColumns: async (config: AppConfig, listId: string) => readListSchemaColumns(config, listId),

  findListIdsByName: async (config: AppConfig, listName: string): Promise<string[]> =>
    findListIdsByName(config, listName),

  getAuthedUserId: async (config: AppConfig): Promise<string> => getAuthedUserId(config),

  listItems: async (config: AppConfig, listId: string) => fetchListItems(config, listId),

  createMemberMasterItem: async (
    config: AppConfig,
    listId: string,
    targetUser: string,
    defaultChannels: string[],
    defaultUsers: string[] = [],
    active = true,
    defaultRegistrationNotify: RegistrationNotifyMode = "none"
  ) => {
    const columnIds = await resolveMemberMasterColumnIds(config, listId);
    if (!columnIds) {
      throw new Error("member_master column resolution failed");
    }
    return slackApiPost<Record<string, unknown>>(config, "slackLists.items.create", {
      list_id: listId,
      initial_fields: buildMemberMasterInitialFields(
        columnIds,
        targetUser,
        defaultChannels,
        defaultUsers,
        active,
        defaultRegistrationNotify
      )
    });
  },

  openModal: async (config: AppConfig, triggerId: string, view: Record<string, unknown>) =>
    slackApiPost<SlackViewOpenResponse>(config, "views.open", {
      trigger_id: triggerId,
      view
    }),

  openDirectMessage: async (config: AppConfig, userId: string): Promise<string> => {
    const opened = await slackApiPost<SlackConversationOpenResponse>(config, "conversations.open", {
      users: userId
    });
    const channelId = opened.channel?.id;
    if (!channelId) {
      throw new Error("conversations.open response missing channel id");
    }
    return channelId;
  },

  deleteMemberMasterItem: async (config: AppConfig, listId: string, itemId: string) =>
    slackApiPost<Record<string, unknown>>(config, "slackLists.items.delete", {
      list_id: listId,
      id: itemId
    }),

  resolveMemberMasterRecord: async (
    config: AppConfig,
    listId: string,
    targetUser: string
  ): Promise<ResolveMemberMasterRecordResult> => {
    const listed = await fetchListItems(config, listId);
    const rows = (listed.items ?? []).map(parseMemberMasterRow).filter((row): row is MemberMasterRow => !!row);
    const matches = rows.filter((row) => row.targetUser === targetUser);
    if (matches.length === 0) {
      const created = await slackApi.createMemberMasterItem(config, listId, targetUser, []);
      const createdId = (created as SlackListItemCreateResponse).id ?? (created as SlackListItemCreateResponse).item?.id;
      if (createdId) {
        return {
          kept: createdId,
          deleted: [],
          created: true,
          targetUser,
          active: true,
          defaultNotifyChannels: [],
          defaultNotifyUsers: [],
          defaultRegistrationNotify: "none"
        };
      }
      const relisted = await fetchListItems(config, listId);
      const refreshed = (relisted.items ?? [])
        .map(parseMemberMasterRow)
        .filter((row): row is MemberMasterRow => !!row && row.targetUser === targetUser);
      const keptAfterCreate = refreshed.sort((a, b) => b.updatedTimestamp - a.updatedTimestamp)[0];
      if (!keptAfterCreate) {
        throw new Error("member_master record creation verification failed");
      }
      return {
        kept: keptAfterCreate.itemId,
        deleted: [],
        created: true,
        targetUser: keptAfterCreate.targetUser,
        active: keptAfterCreate.active,
        defaultNotifyChannels: keptAfterCreate.defaultNotifyChannels,
        defaultNotifyUsers: keptAfterCreate.defaultNotifyUsers,
        defaultRegistrationNotify: keptAfterCreate.defaultRegistrationNotify
      };
    }

    const sorted = [...matches].sort((a, b) => b.updatedTimestamp - a.updatedTimestamp);
    const kept = sorted[0];
    const duplicates = sorted.slice(1);
    const deleted: string[] = [];
    for (const duplicate of duplicates) {
      await slackApi.deleteMemberMasterItem(config, listId, duplicate.itemId);
      deleted.push(duplicate.itemId);
    }
    return {
      kept: kept.itemId,
      deleted,
      created: false,
      targetUser: kept.targetUser,
      active: kept.active,
      defaultNotifyChannels: kept.defaultNotifyChannels,
      defaultNotifyUsers: kept.defaultNotifyUsers,
      defaultRegistrationNotify: kept.defaultRegistrationNotify
    };
  },

  updateMemberMasterItem: async (
    config: AppConfig,
    listId: string,
    rowId: string,
    targetUser: string,
    defaultChannels: string[],
    defaultUsers: string[],
    active: boolean,
    defaultRegistrationNotify: RegistrationNotifyMode = "none"
  ) => {
    const columnIds = await resolveMemberMasterColumnIds(config, listId);
    if (!columnIds) {
      throw new Error("member_master column resolution failed");
    }
    const cells: Array<Record<string, unknown>> = [
      { row_id: rowId, column_id: columnIds.targetUser, user: [targetUser] },
      { row_id: rowId, column_id: columnIds.active, checkbox: active }
    ];
    if (columnIds.defaultNotifyChannels) {
      cells.push({ row_id: rowId, column_id: columnIds.defaultNotifyChannels, channel: defaultChannels });
    }
    if (columnIds.defaultNotifyUsers) {
      cells.push({ row_id: rowId, column_id: columnIds.defaultNotifyUsers, user: defaultUsers });
    }
    if (columnIds.defaultRegistrationNotify) {
      cells.push({
        row_id: rowId,
        column_id: columnIds.defaultRegistrationNotify,
        select: [defaultRegistrationNotify]
      });
    }
    return slackApiPost<Record<string, unknown>>(config, "slackLists.items.update", {
      list_id: listId,
      cells
    });
  },

  createAbsenceItem: async (config: AppConfig, listId: string, record: AbsenceRecord) => {
    const columnIds = await resolveAbsenceColumnIds(config, listId);
    if (!columnIds) {
      throw new Error("absence column resolution failed");
    }
    const created = await slackApiPost<SlackListItemCreateResponse>(config, "slackLists.items.create", {
      list_id: listId,
      initial_fields: buildAbsenceInitialFields(columnIds, record)
    });
    return created;
  },

  renameList: async (config: AppConfig, listId: string, name: string) =>
    slackApiPost<Record<string, unknown>>(config, "slackLists.update", {
      id: listId,
      name
    }),

  deleteList: async (config: AppConfig, listId: string) =>
    slackApiPost<Record<string, unknown>>(config, "files.delete", {
      file: listId
    }),

  postChannelMessage: async (config: AppConfig, channel: string, text: string) =>
    slackApiPost<{ ts?: string }>(config, "chat.postMessage", {
      channel,
      text
    }),

  postEphemeral: async (
    config: AppConfig,
    channel: string,
    user: string,
    text: string,
    blocks?: Array<Record<string, unknown>>
  ) =>
    slackApiPost<Record<string, unknown>>(config, "chat.postEphemeral", {
      channel,
      user,
      text,
      ...(blocks ? { blocks } : {})
    }),

  updateChannelMessage: async (config: AppConfig, channel: string, ts: string, text: string) =>
    slackApiPost<{ ts?: string }>(config, "chat.update", {
      channel,
      ts,
      text
    }),

  setListAccessForUsers: async (config: AppConfig, listId: string, userIds: string[]) =>
    slackApiPost<Record<string, unknown>>(config, "slackLists.access.set", {
      list_id: listId,
      access_level: "write",
      user_ids: userIds
    }),

  setListAccessForChannels: async (config: AppConfig, listId: string, channelIds: string[]) =>
    slackApiPost<Record<string, unknown>>(config, "slackLists.access.set", {
      list_id: listId,
      access_level: "write",
      channel_ids: channelIds
    })
};

export type { SlackListItem };
