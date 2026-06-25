import type { AppConfig } from "../config";
import { ABSENCE_LIST_NAME, parseAbsence, type AbsenceRecord } from "../domain/absence";
import { parseRegistrationNotifyMode } from "../domain/absence-registration";
import { MEMBER_MASTER_LIST_NAME } from "../domain/member-master";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "../domain/slack-list-value";
import { countAbsences, insertAbsenceOrIgnore } from "../db/absence-repository";
import {
  countMemberMaster,
  insertMemberMasterOrIgnore,
  type MemberMasterRecord
} from "../db/member-master-repository";
import { readImportCompleted, readImportSummary, readPersistedListId, readPersistedMemberMasterListId, writeImportCompleted } from "../state/kv";
import { createListDiscovery } from "./list-discovery";
import { fetchSlackListItems, getAuthedUserId, type SlackListItem } from "./slack-list-read";

type ImportTableResult = {
  processed: number;
  skipped: number;
  errors: number;
};

export type ImportFromSlackListsResult = {
  absences: ImportTableResult;
  memberMaster: ImportTableResult;
};

const mergeListIds = (...groups: Array<string[] | undefined>): string[] => {
  const ids = new Set<string>();
  for (const group of groups) {
    for (const id of group ?? []) {
      if (id) ids.add(id);
    }
  }
  return [...ids];
};

const resolveListIds = async (
  config: AppConfig,
  listName: string,
  persistedId: string | undefined
): Promise<string[]> => {
  const discovery = await createListDiscovery(config, { userId: await getAuthedUserId(config) });
  return mergeListIds(discovery.findByExactName(listName), persistedId ? [persistedId] : undefined);
};

const parseMemberMasterImportRow = (
  item: SlackListItem
): (MemberMasterRecord & { updatedAt: string }) | undefined => {
  const targetUser = toStringValue(pickListField(item, "target_user")) || toStringValue(pickListField(item, "member_key"));
  if (!targetUser) return undefined;
  const updatedTimestamp = Number(item.updated_timestamp ?? "") || Date.now();
  return {
    targetUser,
    active: toBooleanValue(pickListField(item, "active")) ?? true,
    defaultNotifyChannels: [...new Set(toStringArray(pickListField(item, "default_notify_channels")))],
    defaultNotifyUsers: [...new Set(toStringArray(pickListField(item, "default_notify_users")))],
    defaultRegistrationNotify: parseRegistrationNotifyMode(
      toStringValue(pickListField(item, "default_registration_notify"))
    ),
    updatedAt: new Date(updatedTimestamp).toISOString()
  };
};

const dedupeMemberMasterRows = (
  rows: Array<MemberMasterRecord & { updatedAt: string }>
): Array<MemberMasterRecord & { updatedAt: string }> => {
  const byUser = new Map<string, MemberMasterRecord & { updatedAt: string }>();
  for (const row of rows) {
    const existing = byUser.get(row.targetUser);
    if (!existing || row.updatedAt > existing.updatedAt) {
      byUser.set(row.targetUser, row);
    }
  }
  return [...byUser.values()];
};

export const importFromSlackLists = async (config: AppConfig): Promise<ImportFromSlackListsResult> => {
  if (await readImportCompleted(config)) {
    const summary = await readImportSummary(config);
    throw new ImportConflictError("import already completed", summary);
  }
  const absenceCount = await countAbsences(config);
  const masterCount = await countMemberMaster(config);
  if (absenceCount > 0 || masterCount > 0) {
    throw new ImportConflictError("d1 not empty", { absenceCount, masterCount });
  }

  const absenceListIds = await resolveListIds(
    config,
    ABSENCE_LIST_NAME,
    await readPersistedListId(config)
  );
  const memberMasterListIds = await resolveListIds(
    config,
    MEMBER_MASTER_LIST_NAME,
    await readPersistedMemberMasterListId(config)
  );

  const absenceResult: ImportTableResult = { processed: 0, skipped: 0, errors: 0 };
  const memberMasterResult: ImportTableResult = { processed: 0, skipped: 0, errors: 0 };

  const absenceRecords: AbsenceRecord[] = [];
  for (const listId of absenceListIds) {
    const items = await fetchSlackListItems(config, listId);
    for (const item of items) {
      const parsed = parseAbsence(item);
      if (!parsed.ok) {
        absenceResult.skipped += 1;
        continue;
      }
      absenceRecords.push(parsed.record);
    }
  }

  const timestamp = new Date().toISOString();
  for (const record of absenceRecords) {
    try {
      const inserted = await insertAbsenceOrIgnore(config, record, {
        createdAt: timestamp,
        updatedAt: timestamp
      });
      if (inserted) absenceResult.processed += 1;
      else absenceResult.skipped += 1;
    } catch {
      absenceResult.errors += 1;
    }
  }

  const masterRows: Array<MemberMasterRecord & { updatedAt: string }> = [];
  for (const listId of memberMasterListIds) {
    const items = await fetchSlackListItems(config, listId);
    for (const item of items) {
      const parsed = parseMemberMasterImportRow(item);
      if (!parsed) {
        memberMasterResult.skipped += 1;
        continue;
      }
      masterRows.push(parsed);
    }
  }

  for (const row of dedupeMemberMasterRows(masterRows)) {
    try {
      const inserted = await insertMemberMasterOrIgnore(
        config,
        {
          targetUser: row.targetUser,
          active: row.active,
          defaultNotifyChannels: row.defaultNotifyChannels,
          defaultNotifyUsers: row.defaultNotifyUsers,
          defaultRegistrationNotify: row.defaultRegistrationNotify
        },
        row.updatedAt
      );
      if (inserted) memberMasterResult.processed += 1;
      else memberMasterResult.skipped += 1;
    } catch {
      memberMasterResult.errors += 1;
    }
  }

  const summary = { absences: absenceResult, memberMaster: memberMasterResult };
  await writeImportCompleted(config, summary);
  console.log(
    JSON.stringify({
      level: "info",
      event: "import_from_slack_lists_done",
      ...summary
    })
  );
  return summary;
};

export class ImportConflictError extends Error {
  readonly details: unknown;

  constructor(message: string, details: unknown) {
    super(message);
    this.name = "ImportConflictError";
    this.details = details;
  }
}
