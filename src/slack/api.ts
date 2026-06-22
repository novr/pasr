import type { AppConfig } from "../config";

type SlackOkResponse<T> = T & { ok: true };
type SlackErrorResponse = { ok: false; error: string };
type SlackResponse<T> = SlackOkResponse<T> | SlackErrorResponse;

type SlackListItem = {
  id: string;
  fields?: Record<string, unknown>;
  values?: Record<string, unknown>;
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

const memberMasterColumnIdsCache = new Map<string, MemberMasterColumnIds>();

const getSchemaColumns = (metadata: SlackListMetadataResponse): SlackListMetadataSchemaColumn[] =>
  metadata.list?.list_metadata?.schema ?? metadata.list_metadata?.schema ?? [];

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
