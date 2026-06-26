import type { AppConfig } from "../config";
import { slackApiGet, slackApiPost } from "../slack/client";

export type SlackListItem = {
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

type AuthTestResponse = {
  user_id?: string;
};

let authedUserIdByToken = new Map<string, string>();

export const getAuthedUserId = async (config: AppConfig): Promise<string> => {
  const cached = authedUserIdByToken.get(config.slackBotToken);
  if (cached) return cached;
  const response = await slackApiGet<AuthTestResponse>(config, "auth.test", {});
  const userId = response.user_id;
  if (!userId) throw new Error("auth.test response missing user_id");
  authedUserIdByToken.set(config.slackBotToken, userId);
  return userId;
};

export const fetchSlackListItems = async (config: AppConfig, listId: string): Promise<SlackListItem[]> => {
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
  return items;
};
