import type { AppConfig } from "../config";
import type { AbsenceRecord } from "../domain/absence";
import { getJstDateParts } from "../domain/jst-date";
import { listAbsencesByUserFuture } from "../db/absence-repository";
import {
  getMemberMaster,
  type MemberMasterRecord
} from "../db/member-master-repository";

import { isStatusOAuthEnabled } from "../config";
import { checkMemberMasterStatusPrefsSchema, checkSlackUserOAuthSchema } from "../db/schema-check";
import { hasSlackUserOAuth } from "../db/slack-user-oauth-repository";
import { issueOAuthStartUrlForUser } from "./oauth";

export const APP_HOME_ABSENCE_PREVIEW_MAX = 5;
export const APP_HOME_ABSENCE_FETCH_LIMIT = 6;

export type AppHomeStatusOAuth = {
  linked: boolean;
  startUrl: string | null;
};

export type AppHomeData = {
  todayJst: string;
  master?: MemberMasterRecord;
  absences: AbsenceRecord[];
  hasMoreAbsences: boolean;
  statusPrefsEnabled: boolean;
  orgStatusDefaultText: string;
  orgStatusDefaultEmoji: string;
  statusOAuth?: AppHomeStatusOAuth;
};

export const loadAppHomeStatusOAuth = async (
  config: AppConfig,
  userId: string,
  publicBaseUrl: string
): Promise<AppHomeStatusOAuth | undefined> => {
  if (!isStatusOAuthEnabled(config)) return undefined;
  const schemaOk = (await checkSlackUserOAuthSchema(config)) === "ok";
  if (!schemaOk) return undefined;
  const linked = await hasSlackUserOAuth(config, userId);
  const startUrl =
    !linked && publicBaseUrl.length > 0
      ? await issueOAuthStartUrlForUser(config, userId, publicBaseUrl)
      : null;
  return { linked, startUrl };
};

export const loadAppHomeData = async (
  config: AppConfig,
  userId: string,
  publicBaseUrl = ""
): Promise<AppHomeData> => {
  const { day: todayJst } = getJstDateParts();
  const [master, absences, statusOAuth, statusPrefsEnabled] = await Promise.all([
    getMemberMaster(config, userId),
    listAbsencesByUserFuture(config, userId, todayJst, { limit: APP_HOME_ABSENCE_FETCH_LIMIT }),
    loadAppHomeStatusOAuth(config, userId, publicBaseUrl),
    checkMemberMasterStatusPrefsSchema(config).then((result) => result === "ok")
  ]);
  return {
    todayJst,
    master,
    absences,
    hasMoreAbsences: absences.length > APP_HOME_ABSENCE_PREVIEW_MAX,
    statusPrefsEnabled,
    orgStatusDefaultText: config.statusDefaultText,
    orgStatusDefaultEmoji: config.statusEmoji,
    statusOAuth
  };
};
