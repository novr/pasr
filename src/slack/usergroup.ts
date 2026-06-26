import type { AppConfig } from "../config";
import { SlackApiError, slackApiPost } from "./client";

type UsergroupUsersListResponse = {
  users?: string[];
};

const mergeUserIds = (current: string[], userId: string): string[] => {
  const merged = [...current];
  if (!merged.includes(userId)) merged.push(userId);
  return merged;
};

const toUsersCsv = (userIds: string[]): string => userIds.join(",");

const warnUsergroupAddFailed = (
  userId: string,
  usergroupId: string,
  error: unknown,
  retried: boolean
): void => {
  const payload: Record<string, unknown> = {
    level: "warn",
    event: "pasr_usergroup_add_failed",
    user_id: userId,
    usergroup_id: usergroupId,
    retried
  };
  if (error instanceof SlackApiError) {
    payload.slack_error = error.slackError;
    payload.slack_method = error.method;
  } else {
    payload.message = error instanceof Error ? error.message : String(error);
  }
  console.warn(JSON.stringify(payload));
};

const listUsergroupMembers = async (config: AppConfig, groupId: string): Promise<string[]> => {
  const response = await slackApiPost<UsergroupUsersListResponse>(config, "usergroups.users.list", {
    usergroup: groupId
  });
  return response.users ?? [];
};

const updateUsergroupMembers = async (
  config: AppConfig,
  groupId: string,
  userIds: string[]
): Promise<void> => {
  await slackApiPost(config, "usergroups.users.update", {
    usergroup: groupId,
    users: toUsersCsv(userIds)
  });
};

export const addUserToPasrUsergroup = async (config: AppConfig, userId: string): Promise<void> => {
  const groupId = config.pasrUsersUsergroupId;
  if (!groupId) return;

  let retried = false;
  try {
    const current = await listUsergroupMembers(config, groupId);
    if (current.includes(userId)) return;

    const attemptUpdate = async (members: string[]) => {
      await updateUsergroupMembers(config, groupId, mergeUserIds(members, userId));
    };

    try {
      await attemptUpdate(current);
    } catch {
      retried = true;
      const refreshed = await listUsergroupMembers(config, groupId);
      if (refreshed.includes(userId)) return;
      await attemptUpdate(refreshed);
    }
  } catch (error) {
    warnUsergroupAddFailed(userId, groupId, error, retried);
  }
};
