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

const ABSENCE_LIST_NAME = "absence_list";
const MEMBER_MASTER_LIST_NAME = "member_master";

const memberMasterSchema = [
  {
    key: "target_user",
    name: "Target User",
    type: "user",
    is_primary_column: true,
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
    let cursor: string | undefined;
    do {
      const page = await apiCall<SlackListsListResponse>(config, "slackLists.list", {
        limit: 200,
        cursor
      });
      const found = (page.lists ?? []).find((list) => list.name === ABSENCE_LIST_NAME)?.id;
      if (found) return found;
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return undefined;
  },

  createMemberMasterList: async (config: AppConfig) =>
    apiCall<{ list_id?: string; list?: { id?: string } }>(config, "slackLists.create", {
      name: MEMBER_MASTER_LIST_NAME,
      schema: memberMasterSchema
    }),

  reconcileMemberMasterListFields: async (config: AppConfig, listId: string) =>
    apiCall<Record<string, unknown>>(config, "slackLists.update", {
      id: listId,
      name: MEMBER_MASTER_LIST_NAME,
      schema: memberMasterSchema
    }),

  findMemberMasterListIdByName: async (config: AppConfig): Promise<string | undefined> => {
    let cursor: string | undefined;
    do {
      const page = await apiCall<SlackListsListResponse>(config, "slackLists.list", {
        limit: 200,
        cursor
      });
      const found = (page.lists ?? []).find((list) => list.name === MEMBER_MASTER_LIST_NAME)?.id;
      if (found) return found;
      cursor = page.response_metadata?.next_cursor || undefined;
    } while (cursor);
    return undefined;
  },

  listMemberMasterItems: async (config: AppConfig, listId: string) => {
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
  },

  createMemberMasterItem: async (config: AppConfig, listId: string, targetUser: string, defaultChannels: string[]) =>
    apiCall<Record<string, unknown>>(config, "slackLists.items.create", {
      list_id: listId,
      values: {
        target_user: [{ id: targetUser }],
        default_notify_channels: defaultChannels.map((id) => ({ id })),
        active: true
      }
    }),

  listAbsences: async (config: AppConfig, listId: string) => {
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
  },

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
