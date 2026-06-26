import type { AppConfig } from "../config";
import type { RegistrationNotifyMode } from "../domain/absence-registration";
import { getMemberMaster, ensureMemberMasterActive } from "../db/member-master-repository";

export type MasterContext = {
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  defaultRegistrationNotify: RegistrationNotifyMode;
};

export const resolveMasterContext = async (config: AppConfig, userId: string): Promise<MasterContext> => {
  const existing = await getMemberMaster(config, userId);
  if (existing) {
    return {
      active: existing.active,
      defaultNotifyChannels: existing.defaultNotifyChannels,
      defaultNotifyUsers: existing.defaultNotifyUsers,
      defaultRegistrationNotify: existing.defaultRegistrationNotify
    };
  }
  const created = await ensureMemberMasterActive(config, userId);
  return {
    active: created.active,
    defaultNotifyChannels: created.defaultNotifyChannels,
    defaultNotifyUsers: created.defaultNotifyUsers,
    defaultRegistrationNotify: created.defaultRegistrationNotify
  };
};
