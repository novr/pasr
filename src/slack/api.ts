import type { AppConfig } from "../config";
import { ABSENCE_LIST_NAME, absenceSchema } from "../domain/absence";
import {
  MEMBER_MASTER_LIST_NAME,
  memberMasterSchema,
  type MemberMasterColumnIds,
  type MemberMasterRow,
  type ResolveMemberMasterRecordResult
} from "../domain/member-master";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "../domain/slack-list-value";

type SlackOkResponse<T> = T & { ok: true };
type SlackErrorResponse = { ok: false; error: string };
type SlackResponse<T> = SlackOkResponse<T> | SlackErrorResponse;

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

type SlackListsListResponse = {
  lists?: SlackList[];
  response_metadata?: {
    next_cursor?: string;
  };
};

type SlackListMetadataSchemaColumn = {
  key?: string;
  id?: string;
  name?: string;
  type?: string;
  is_primary_column?: boolean;
};

type SlackListMetadataResponse = {
  list_metadata?: {
    schema?: SlackListMetadataSchemaColumn[];
  };
  list?: {
    list_metadata?: {
      schema?: SlackListMetadataSchemaColumn[];
    };
  };
};

type SlackListItemInfoResponse = {
  list?: {
    list_metadata?: {
      schema?: SlackListMetadataSchemaColumn[];
    };
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

const memberMasterColumnIdsCache = new Map<string, MemberMasterColumnIds>();

const getSchemaColumns = (metadata: SlackListMetadataResponse): SlackListMetadataSchemaColumn[] =>
  metadata.list?.list_metadata?.schema ?? metadata.list_metadata?.schema ?? [];

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

const listItems = async (config: AppConfig, listId: string): Promise<{ items: SlackListItem[] }> => {
  const items: SlackListItem[] = [];
  let cursor: string | undefined;
  do {
    const page = await apiCall<SlackListItemsListResponse>(config, "slackLists.items.list", {
      list_id: listId,
      limit: 200,
      cursor
    });
    items.push(...(page.items ?? []));
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return { items };
};

const findListIdByName = async (config: AppConfig, listName: string): Promise<string | undefined> => {
  let cursor: string | undefined;
  do {
    const page = await apiCall<SlackListsListResponse>(config, "slackLists.list", {
      limit: 200,
      cursor
    });
    const found = (page.lists ?? []).find((list) => list.name === listName)?.id;
    if (found) return found;
    cursor = page.response_metadata?.next_cursor || undefined;
  } while (cursor);
  return undefined;
};

const resolveMemberMasterColumnIds = async (config: AppConfig, listId: string): Promise<MemberMasterColumnIds | undefined> => {
  const cached = memberMasterColumnIdsCache.get(listId);
  if (cached) return cached;

  let schema = getSchemaColumns(
    await apiCall<SlackListMetadataResponse>(config, "slackLists.update", {
      id: listId,
      name: MEMBER_MASTER_LIST_NAME,
      schema: memberMasterSchema
    })
  );

  if (schema.length === 0) {
    const listed = await listItems(config, listId);
    const firstItemId = listed.items?.[0]?.id;
    if (firstItemId) {
      const info = await apiCall<SlackListItemInfoResponse>(config, "slackLists.items.info", {
        list_id: listId,
        id: firstItemId
      });
      schema = info.list?.list_metadata?.schema ?? [];
    }
  }

  const byKey = new Map(
    schema
      .filter((column): column is { key: string; id: string } => !!column.key && !!column.id)
      .map((column) => [column.key, column.id] as const)
  );
  const findByName = (name: string): string | undefined => schema.find((column) => column.id && column.name === name)?.id;
  const primaryText = schema.find((column) => column.is_primary_column && column.id)?.id;
  const targetUserColumn = byKey.get("target_user") ?? findByName("Target User");
  const defaultNotifyChannels = byKey.get("default_notify_channels") ?? findByName("Default Notify Channels");
  const defaultNotifyUsers = byKey.get("default_notify_users") ?? findByName("Default Notify Users");
  const active = byKey.get("active") ?? findByName("Active");

  if (!primaryText || !targetUserColumn || !active) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "member_master_column_resolve_fallback",
        listId,
        hasPrimaryText: Boolean(primaryText),
        hasTargetUser: Boolean(targetUserColumn),
        hasActive: Boolean(active),
        schemaKeys: schema.map((column) => column.key ?? "").filter((key) => key.length > 0)
      })
    );
    return undefined;
  }

  const resolved = { primaryText, targetUser: targetUserColumn, defaultNotifyChannels, defaultNotifyUsers, active };
  // Optional columns may be added later by schema reconciliation.
  // Avoid caching incomplete optional-column resolution to let later calls re-resolve.
  if (defaultNotifyChannels && defaultNotifyUsers) {
    memberMasterColumnIdsCache.set(listId, resolved);
  } else {
    memberMasterColumnIdsCache.delete(listId);
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "member_master_optional_columns_missing",
        listId,
        hasDefaultNotifyChannels: Boolean(defaultNotifyChannels),
        hasDefaultNotifyUsers: Boolean(defaultNotifyUsers)
      })
    );
  }
  return resolved;
};

const apiCall = async <T>(
  config: AppConfig,
  method: string,
  payload: Record<string, unknown>
): Promise<T> => {
  const res = await fetch(`https://slack.com/api/${method}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${config.slackBotToken}`,
      "Content-Type": "application/json; charset=utf-8"
    },
    body: JSON.stringify(payload)
  });
  const json = (await res.json()) as SlackResponse<T>;
  if (!res.ok) {
    throw new Error(`Slack API HTTP error (${method}): ${res.status}`);
  }
  if (!json.ok) {
    throw new Error(`Slack API error (${method}): ${json.error}`);
  }
  return json;
};

export const slackApi = {
  createAbsenceList: async (config: AppConfig) =>
    apiCall<{ list_id?: string; list?: { id?: string } }>(config, "slackLists.create", {
      name: ABSENCE_LIST_NAME,
      schema: absenceSchema
    }),

  reconcileAbsenceListFields: async (config: AppConfig, listId: string) =>
    apiCall<Record<string, unknown>>(config, "slackLists.update", {
      id: listId,
      name: ABSENCE_LIST_NAME
    }),

  findAbsenceListIdByName: async (config: AppConfig): Promise<string | undefined> => {
    return findListIdByName(config, ABSENCE_LIST_NAME);
  },

  createMemberMasterList: async (config: AppConfig) =>
    apiCall<{ list_id?: string; list?: { id?: string } }>(config, "slackLists.create", {
      name: MEMBER_MASTER_LIST_NAME,
      schema: memberMasterSchema
    }),

  reconcileMemberMasterListFields: async (config: AppConfig, listId: string) =>
    apiCall<SlackListMetadataResponse>(config, "slackLists.update", {
      id: listId,
      name: MEMBER_MASTER_LIST_NAME,
      schema: memberMasterSchema
    }),

  findMemberMasterListIdByName: async (config: AppConfig): Promise<string | undefined> => {
    return findListIdByName(config, MEMBER_MASTER_LIST_NAME);
  },

  listMemberMasterItems: async (config: AppConfig, listId: string) => listItems(config, listId),

  createMemberMasterItem: async (
    config: AppConfig,
    listId: string,
    targetUser: string,
    defaultChannels: string[],
    defaultUsers: string[] = []
  ) =>
    (async () => {
      const columnIds = await resolveMemberMasterColumnIds(config, listId);

      if (columnIds) {
        const initialFields: Array<Record<string, unknown>> = [
          {
            column_id: columnIds.primaryText,
            rich_text: [
              {
                type: "rich_text",
                elements: [{ type: "rich_text_section", elements: [{ type: "text", text: targetUser }] }]
              }
            ]
          },
          { column_id: columnIds.targetUser, user: [targetUser] },
          { column_id: columnIds.active, checkbox: true }
        ];
        if (columnIds.defaultNotifyChannels && defaultChannels.length > 0) {
          initialFields.push({ column_id: columnIds.defaultNotifyChannels, channel: defaultChannels });
        }
        if (columnIds.defaultNotifyUsers && defaultUsers.length > 0) {
          initialFields.push({ column_id: columnIds.defaultNotifyUsers, user: defaultUsers });
        }
        return apiCall<Record<string, unknown>>(config, "slackLists.items.create", {
          list_id: listId,
          initial_fields: initialFields
        });
      }

      const valuePayloadCandidates: Array<Record<string, unknown>> = [
        {
          member_key: targetUser,
          target_user: { user: [targetUser] },
          default_notify_channels: { channel: defaultChannels },
          default_notify_users: { user: defaultUsers },
          active: true
        },
        {
          member_key: targetUser,
          target_user: [targetUser],
          default_notify_channels: defaultChannels,
          default_notify_users: defaultUsers,
          active: true
        },
        {
          member_key: targetUser,
          target_user: targetUser,
          active: true
        }
      ];

      let lastError: unknown;
      for (const values of valuePayloadCandidates) {
        try {
          return await apiCall<Record<string, unknown>>(config, "slackLists.items.create", {
            list_id: listId,
            values
          });
        } catch (error) {
          lastError = error;
        }
      }
      throw lastError instanceof Error ? lastError : new Error(String(lastError));
    })(),

  openModal: async (config: AppConfig, triggerId: string, view: Record<string, unknown>) =>
    apiCall<SlackViewOpenResponse>(config, "views.open", {
      trigger_id: triggerId,
      view
    }),

  openDirectMessage: async (config: AppConfig, userId: string): Promise<string> => {
    const opened = await apiCall<SlackConversationOpenResponse>(config, "conversations.open", {
      users: userId
    });
    const channelId = opened.channel?.id;
    if (!channelId) {
      throw new Error("conversations.open response missing channel id");
    }
    return channelId;
  },

  deleteMemberMasterItem: async (config: AppConfig, listId: string, itemId: string) =>
    apiCall<Record<string, unknown>>(config, "slackLists.items.delete", {
      list_id: listId,
      id: itemId
    }),

  resolveMemberMasterRecord: async (
    config: AppConfig,
    listId: string,
    targetUser: string
  ): Promise<ResolveMemberMasterRecordResult> => {
    const listed = await listItems(config, listId);
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
      const relisted = await listItems(config, listId);
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
      {
        row_id: rowId,
        column_id: columnIds.targetUser,
        user: [targetUser]
      },
      {
        row_id: rowId,
        column_id: columnIds.active,
        checkbox: active
      }
    ];
    if (columnIds.defaultNotifyChannels) {
      cells.push({
        row_id: rowId,
        column_id: columnIds.defaultNotifyChannels,
        channel: defaultChannels
      });
    }
    if (columnIds.defaultNotifyUsers) {
      cells.push({
        row_id: rowId,
        column_id: columnIds.defaultNotifyUsers,
        user: defaultUsers
      });
    }
    return apiCall<Record<string, unknown>>(config, "slackLists.items.update", {
      list_id: listId,
      cells
    });
  },

  listAbsences: async (config: AppConfig, listId: string) => listItems(config, listId),

  postChannelMessage: async (config: AppConfig, channel: string, text: string) =>
    apiCall<{ ts?: string }>(config, "chat.postMessage", {
      channel,
      text
    }),

  updateChannelMessage: async (config: AppConfig, channel: string, ts: string, text: string) =>
    apiCall<{ ts?: string }>(config, "chat.update", {
      channel,
      ts,
      text
    }),

  setListAccessForUsers: async (config: AppConfig, listId: string, userIds: string[]) =>
    apiCall<Record<string, unknown>>(config, "slackLists.access.set", {
      list_id: listId,
      access_level: "write",
      user_ids: userIds
    })
};

export type { SlackListItem };
