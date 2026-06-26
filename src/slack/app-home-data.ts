import type { AppConfig } from "../config";
import type { AbsenceRecord } from "../domain/absence";
import { getJstDateParts } from "../domain/jst-date";
import { listAbsencesByUserFuture } from "../db/absence-repository";
import {
  getMemberMaster,
  type MemberMasterRecord
} from "../db/member-master-repository";

export const APP_HOME_ABSENCE_PREVIEW_MAX = 5;
export const APP_HOME_ABSENCE_FETCH_LIMIT = 6;

export type AppHomeData = {
  todayJst: string;
  master?: MemberMasterRecord;
  absences: AbsenceRecord[];
  hasMoreAbsences: boolean;
};

export const loadAppHomeData = async (config: AppConfig, userId: string): Promise<AppHomeData> => {
  const { day: todayJst } = getJstDateParts();
  const [master, absences] = await Promise.all([
    getMemberMaster(config, userId),
    listAbsencesByUserFuture(config, userId, todayJst, { limit: APP_HOME_ABSENCE_FETCH_LIMIT })
  ]);
  return {
    todayJst,
    master,
    absences,
    hasMoreAbsences: absences.length > APP_HOME_ABSENCE_PREVIEW_MAX
  };
};
