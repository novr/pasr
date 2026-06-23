import type { AppConfig } from "../config";
import { ABSENCE_LIST_NAME, absenceSchema, type AbsenceRecord } from "../domain/absence";
import {
  MEMBER_MASTER_LIST_NAME,
  memberMasterSchema,
  type MemberMasterRow,
  type ResolveMemberMasterRecordResult
} from "../domain/member-master";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "../domain/slack-list-value";
import { isSkippableSlackLookupError, slackApiGet, slackApiPost } from "./client";
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

type SlackList = {
  id?: string;
  name?: string;
};

type SlackFile = {
  id?: string;
  name?: string;
  filetype?: string;
};

type FilesListResponse = {
  files?: SlackFile[];
  paging?: {
    page?: number;
    pages?: number;
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

const SLACK_LIST_FILETYPE = "list";

const isSlackListFile = (file: SlackFile): file is { id: string; name: string } =>
  !!file.id && file.filetype === SLACK_LIST_FILETYPE && typeof file.name === "string";

const parseMemberMasterRow = (item: SlackListItem): MemberMasterRow | undefined => {
  const targetUser = toStringValue(pickListField(item, "target_user")) || toStringValue(pickListField(item, "member_key"));
  if (!targetUser) return undefined;
  const active = toBooleanValue(pickListField(item, "active")) ?? true;
  const defaultNotifyChannels = [...new Set(toStringArray(pickListField(item, "default_notify_channels")))];
  const defaultNotifyUsers = [...new Set(toStringArray(pickListField(item, "default_notify_users")))];
  const updatedTimestamp = Number(item.updated_timestamp ?? "") || 0;
  return {
    itemId: item.id,
    targetUser,
    active,
    defaultNotifyChannels,
    defaultNotifyUsers,
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

const listListFiles = async (
  config: AppConfig,
  matches: (file: { id: string; name: string }) => boolean
): Promise<SlackList[]> => {
  const lists: SlackList[] = [];
  let page = 1;
  let pages = 1;
  do {
    const response = await slackApiGet<FilesListResponse>(config, "files.list", {
      count: 200,
      page,
      types: "all"
    });
    for (const file of response.files ?? []) {
      if (!isSlackListFile(file) || !matches(file)) continue;
      lists.push({ id: file.id, name: file.name });
    }
    pages = response.paging?.pages ?? page;
    page += 1;
  } while (page <= pages);
  return lists;
};

const findListIdsByName = async (config: AppConfig, listName: string): Promise<string[]> => {
  try {
    const lists = await listListFiles(config, (file) => file.name === listName);
    return lists.map((list) => list.id).filter((id): id is string => !!id);
  } catch (error) {
    if (!isSkippableSlackLookupError(error)) throw error;
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "files_list_lookup_skipped",
        listName,
        message: error instanceof Error ? error.message : String(error)
      })
    );
    return [];
  }
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
  active = true
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

  listItems: async (config: AppConfig, listId: string) => fetchListItems(config, listId),

  createMemberMasterItem: async (
    config: AppConfig,
    listId: string,
    targetUser: string,
    defaultChannels: string[],
    defaultUsers: string[] = []
  ) => {
    const columnIds = await resolveMemberMasterColumnIds(config, listId);
    if (!columnIds) {
      throw new Error("member_master column resolution failed");
    }
    return slackApiPost<Record<string, unknown>>(config, "slackLists.items.create", {
      list_id: listId,
      initial_fields: buildMemberMasterInitialFields(columnIds, targetUser, defaultChannels, defaultUsers)
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
          defaultNotifyUsers: []
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
        defaultNotifyUsers: keptAfterCreate.defaultNotifyUsers
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
      defaultNotifyUsers: kept.defaultNotifyUsers
    };
  },

  updateMemberMasterItem: async (
    config: AppConfig,
    listId: string,
    rowId: string,
    targetUser: string,
    defaultChannels: string[],
    defaultUsers: string[],
    active: boolean
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
    return slackApiPost<Record<string, unknown>>(config, "slackLists.items.create", {
      list_id: listId,
      initial_fields: buildAbsenceInitialFields(columnIds, record)
    });
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

  findListsByNamePrefix: async (config: AppConfig, namePrefix: string): Promise<SlackList[]> => {
    try {
      return await listListFiles(config, (file) => file.name.startsWith(namePrefix));
    } catch (error) {
      if (!isSkippableSlackLookupError(error)) throw error;
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "files_list_lookup_skipped",
          namePrefix,
          message: error instanceof Error ? error.message : String(error)
        })
      );
      return [];
    }
  },

  postChannelMessage: async (config: AppConfig, channel: string, text: string) =>
    slackApiPost<{ ts?: string }>(config, "chat.postMessage", {
      channel,
      text
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
    })
};

export type { SlackListItem };
