import type { AppConfig } from "../config";
import { getDb } from "./client";

export const countMemberMasterTotal = async (config: AppConfig): Promise<number> => {
  const row = await getDb(config)
    .prepare("SELECT COUNT(*) AS count FROM member_master")
    .first<{ count: number }>();
  return row?.count ?? 0;
};

export const countMemberMasterActive = async (config: AppConfig): Promise<number> => {
  const row = await getDb(config)
    .prepare("SELECT COUNT(*) AS count FROM member_master WHERE active = 1")
    .first<{ count: number }>();
  return row?.count ?? 0;
};
