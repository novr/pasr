import type { AppConfig } from "../config";

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

const ABSENCE_LIST_NAME = "absence_list";
const MEMBER_MASTER_LIST_NAME = "member_master";

const memberMasterSchema = [
  {
    key: "member_key",
    name: "Member Key",
    type: "text",
    is_primary_column: true
  },
  {
    key: "target_user",
    name: "Target User",
    type: "user",
    options: { format: "single_entity", notify_users: false }
  },
  {
    key: "default_notify_channels",
    name: "Default Notify Channels",
    type: "channel",
    options: { format: "multi_entity" }
  },
  {
    key: "active",
    name: "Active",
    type: "checkbox"
  }
] as const;

type MemberMasterColumnIds = {
  primaryText: string;
  targetUser: string;
  defaultNotifyChannels?: string;
  active: string;
};

type MemberMasterRow = {
  itemId: string;
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  updatedTimestamp: number;
};

type ResolveMemberMasterRecordResult = {
  kept: string;
  deleted: string[];
  created: boolean;
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
};

const memberMasterColumnIdsCache = new Map<string, MemberMasterColumnIds>();

const getSchemaColumns = (metadata: SlackListMetadataResponse): SlackListMetadataSchemaColumn[] =>
  metadata.list?.list_metadata?.schema ?? metadata.list_metadata?.schema ?? [];

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const pickField = (item: SlackListItem, key: string): unknown => {
  if (Array.isArray(item.fields)) {
    const fromFields = item.fields.find((entry) => {
      const record = asRecord(entry);
      return record?.key === key;
    });
    if (fromFields) return fromFields;
  }
  return item.fields?.[key] ?? item.values?.[key];
};

const toStringValue = (value: unknown): string => {
  if (typeof value === "string") return value;
  if (Array.isArray(value)) {
    for (const entry of value) {
      const nested = toStringValue(entry);
      if (nested) return nested;
    }
    return "";
  }
  const obj = asRecord(value);
  if (!obj) return "";
  const direct = ["id", "user_id", "channel_id", "entity_id", "value", "name"].find(
    (key) => typeof obj[key] === "string" && String(obj[key]).length > 0
  );
  if (direct) return String(obj[direct]);
  for (const nestedKey of ["value", "user", "channel", "select"]) {
    if (obj[nestedKey] != null) {
      const nested = toStringValue(obj[nestedKey]);
      if (nested) return nested;
    }
  }
  return "";
};

const toStringArray = (value: unknown): string[] => {
  if (Array.isArray(value)) {
    return value.map((entry) => toStringValue(entry)).filter((entry) => entry.length > 0);
  }
  const obj = asRecord(value);
  if (!obj) return [];
  for (const key of ["channel", "user", "select"]) {
    if (Array.isArray(obj[key])) {
      return obj[key].map((entry) => toStringValue(entry)).filter((entry) => entry.length > 0);
    }
  }
  const single = toStringValue(value);
  return single ? [single] : [];
};

const toBooleanValue = (value: unknown): boolean | undefined => {
  if (typeof value === "boolean") return value;
  if (typeof value === "number") return value !== 0;
  if (typeof value === "string") {
    const normalized = value.trim().toLowerCase();
    if (normalized === "true" || normalized === "1" || normalized === "yes" || normalized === "on") return true;
    if (normalized === "false" || normalized === "0" || normalized === "no" || normalized === "off") return false;
    return undefined;
  }
  const obj = asRecord(value);
  if (!obj) return undefined;
  for (const key of ["value", "checked", "is_checked", "selected"]) {
    if (obj[key] !== undefined) {
      const nested = toBooleanValue(obj[key]);
      if (nested !== undefined) return nested;
    }
  }
  return undefined;
};

const parseMemberMasterRow = (item: SlackListItem): MemberMasterRow | undefined => {
  const targetUser = toStringValue(pickField(item, "target_user")) || toStringValue(pickField(item, "member_key"));
  if (!targetUser) return undefined;
  const active = toBooleanValue(pickField(item, "active")) ?? true;
  const defaultNotifyChannels = [...new Set(toStringArray(pickField(item, "default_notify_channels")))];
  const updatedTimestamp = Number(item.updated_timestamp ?? "") || 0;
  return {
    itemId: item.id,
    targetUser,
    active,
    defaultNotifyChannels,
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

  const resolved = { primaryText, targetUser: targetUserColumn, defaultNotifyChannels, active };
  memberMasterColumnIdsCache.set(listId, resolved);
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
      schema: [
        { key: "absence_title", name: "Absence", type: "text", is_primary_column: true },
        {
          key: "target_user",
          name: "Target User",
          type: "user",
          options: { format: "single_entity", notify_users: false }
        },
        { key: "start_date", name: "Start Date", type: "date" },
        { key: "end_date", name: "End Date", type: "date" },
        {
          key: "type",
          name: "Type",
          type: "select",
          options: {
            format: "single_select",
            choices: [{ value: "absence", label: "absence", color: "blue" }]
          }
        },
        { key: "notify_channels", name: "Notify Channels", type: "channel", options: { format: "multi_entity" } },
        {
          key: "notify_users",
          name: "Notify Users",
          type: "user",
          options: { format: "multi_entity", notify_users: false }
        },
        { key: "note", name: "Note", type: "text" }
      ]
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

  createMemberMasterItem: async (config: AppConfig, listId: string, targetUser: string, defaultChannels: string[]) =>
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
          active: true
        },
        {
          member_key: targetUser,
          target_user: [targetUser],
          default_notify_channels: defaultChannels,
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
          defaultNotifyChannels: []
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
        defaultNotifyChannels: keptAfterCreate.defaultNotifyChannels
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
      defaultNotifyChannels: kept.defaultNotifyChannels
    };
  },

  updateMemberMasterItem: async (
    config: AppConfig,
    listId: string,
    rowId: string,
    targetUser: string,
    defaultChannels: string[],
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
