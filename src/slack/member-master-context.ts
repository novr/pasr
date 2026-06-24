import type { AppConfig } from "../config";
import type { RegistrationNotifyMode } from "../domain/absence-registration";
import { ensureMemberMasterList } from "../jobs/setup";
import { slackApi } from "./api";

export type MasterContext = {
  memberMasterListId: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
};

export const resolveMasterContext = async (config: AppConfig, userId: string): Promise<MasterContext> => {
  const memberMasterListId = await ensureMemberMasterList(config);
  const resolved = await slackApi.resolveMemberMasterRecord(config, memberMasterListId, userId);
  return {
    memberMasterListId,
    active: resolved.active,
    defaultNotifyChannels: resolved.defaultNotifyChannels,
    defaultNotifyUsers: resolved.defaultNotifyUsers,
    defaultRegistrationNotify: resolved.defaultRegistrationNotify
  };
};
