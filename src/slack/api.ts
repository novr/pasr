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
      name: "absence_list",
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
      list_id: listId,
      add_fields: [
        { name: "target_user", type: "person", required: true },
        { name: "start_date", type: "date", required: true },
        { name: "end_date", type: "date", required: false },
        { name: "type", type: "single_select", required: false, default: "absence" },
        { name: "notify_channels", type: "channel", required: true, multi: true },
        { name: "notify_users", type: "person", required: false, multi: true },
        { name: "note", type: "text", required: false }
      ]
    }),

  listAbsences: async (config: AppConfig, listId: string) =>
    apiCall<SlackListItemsListResponse>(config, "slackLists.items.list", {
      list_id: listId
    }),

  postChannelMessage: async (config: AppConfig, channel: string, text: string) =>
    apiCall<Record<string, unknown>>(config, "chat.postMessage", {
      channel,
      text
    }),

  setListAccessForUsers: async (config: AppConfig, listId: string, userIds: string[]) =>
    apiCall<Record<string, unknown>>(config, "slackLists.access.set", {
      list_id: listId,
      access_level: "write",
      user_ids: userIds
    }),

  setListAccessForChannels: async (config: AppConfig, listId: string, channelIds: string[]) =>
    apiCall<Record<string, unknown>>(config, "slackLists.access.set", {
      list_id: listId,
      access_level: "write",
      channel_ids: channelIds
    })
};

export type { SlackListItem };
