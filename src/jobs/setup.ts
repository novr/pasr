import type { AppConfig } from "../config";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "../domain/slack-list-value";
import { slackApi, type SlackListItem } from "../slack/api";
import {
  readPersistedMemberMasterListId,
  writePersistedListId,
  writePersistedMemberMasterListId
} from "../state/kv";

export type SetupResult = {
  listId: string;
  memberMasterListId: string;
  created: boolean;
  reconciled: boolean;
  accessGranted: boolean;
};

type MemberMasterMigrationRow = {
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  updatedTimestamp: number;
};

export type MemberMasterMigrationResult = {
  fromListId: string;
  toListId: string;
  sourceRows: number;
  migratedRows: number;
  skippedRows: number;
  errors: number;
};

const parseMemberMasterMigrationRow = (item: SlackListItem): MemberMasterMigrationRow | undefined => {
  const targetUser = toStringValue(pickListField(item, "target_user")) || toStringValue(pickListField(item, "member_key"));
  if (!targetUser) return undefined;
  const active = toBooleanValue(pickListField(item, "active")) ?? true;
  const defaultNotifyChannels = [...new Set(toStringArray(pickListField(item, "default_notify_channels")))];
  const defaultNotifyUsers = [...new Set(toStringArray(pickListField(item, "default_notify_users")))];
  const updatedTimestamp = Number(item.updated_timestamp ?? "") || 0;
  return {
    targetUser,
    active,
    defaultNotifyChannels,
    defaultNotifyUsers,
    updatedTimestamp
  };
};

const dedupeMemberMasterRows = (rows: MemberMasterMigrationRow[]): MemberMasterMigrationRow[] => {
  const deduped = new Map<string, MemberMasterMigrationRow>();
  for (const row of rows) {
    const existing = deduped.get(row.targetUser);
    if (!existing || row.updatedTimestamp >= existing.updatedTimestamp) {
      deduped.set(row.targetUser, row);
    }
  }
  return [...deduped.values()];
};

export const ensureMemberMasterList = async (config: AppConfig): Promise<string> => {
  const ensureListAccess = async (listId: string): Promise<void> => {
    if (config.adminUserIds.length === 0) return;
    await slackApi.setListAccessForUsers(config, listId, config.adminUserIds);
  };

  const ensureListSchema = async (listId: string): Promise<void> => {
    try {
      await slackApi.reconcileMemberMasterListFields(config, listId);
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "member_master_reconcile_failed",
          listId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  };

  const persisted = await readPersistedMemberMasterListId(config);
  if (persisted) {
    await ensureListSchema(persisted);
    await ensureListAccess(persisted);
    return persisted;
  }

  let foundByName: string | undefined;
  try {
    foundByName = await slackApi.findMemberMasterListIdByName(config);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    console.warn(JSON.stringify({ level: "warn", event: "member_master_lookup_skipped", message }));
  }
  if (foundByName) {
    await writePersistedMemberMasterListId(config, foundByName);
    await ensureListSchema(foundByName);
    await ensureListAccess(foundByName);
    return foundByName;
  }

  const created = await slackApi.createMemberMasterList(config);
  const createdListId = created.list_id ?? created.list?.id;
  if (!createdListId) {
    throw new Error("slackLists.create response missing member master list id");
  }
  await writePersistedMemberMasterListId(config, createdListId);
  await ensureListAccess(createdListId);
  return createdListId;
};

export const runSetup = async (
  config: AppConfig,
  options?: { preferredListId?: string }
): Promise<SetupResult> => {
  const ensureAbsenceListAccess = async (listId: string): Promise<boolean> => {
    if (config.adminUserIds.length === 0) return false;
    await slackApi.setListAccessForUsers(config, listId, config.adminUserIds);
    return true;
  };
  const reconcileAbsenceList = async (listId: string): Promise<boolean> => {
    try {
      await slackApi.reconcileAbsenceListFields(config, listId);
      return true;
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "setup_reconcile_failed",
          listId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
      return false;
    }
  };

  const targetListId = options?.preferredListId ?? config.absenceListId;

  if (!targetListId) {
    let existingListId: string | undefined;
    try {
      existingListId = await slackApi.findAbsenceListIdByName(config);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      // Some workspaces do not expose slackLists.list; in that case keep legacy create flow.
      console.warn(JSON.stringify({ level: "warn", event: "setup_list_lookup_skipped", message }));
    }
    if (existingListId) {
      const reconciled = await reconcileAbsenceList(existingListId);
      await writePersistedListId(config, existingListId);
      return {
        listId: existingListId,
        memberMasterListId: await ensureMemberMasterList(config),
        created: false,
        reconciled,
        accessGranted: await ensureAbsenceListAccess(existingListId)
      };
    }

    const created = await slackApi.createAbsenceList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) {
      throw new Error("slackLists.create response missing list id");
    }
    await writePersistedListId(config, createdListId);
    return {
      listId: createdListId,
      memberMasterListId: await ensureMemberMasterList(config),
      created: true,
      reconciled: false,
      accessGranted: await ensureAbsenceListAccess(createdListId)
    };
  }

  const reconciled = await reconcileAbsenceList(targetListId);

  await writePersistedListId(config, targetListId);

  return {
    listId: targetListId,
    memberMasterListId: await ensureMemberMasterList(config),
    created: false,
    reconciled,
    accessGranted: await ensureAbsenceListAccess(targetListId)
  };
};

export const runMemberMasterMigration = async (config: AppConfig): Promise<MemberMasterMigrationResult> => {
  const sourceListId = await ensureMemberMasterList(config);
  const source = await slackApi.listMemberMasterItems(config, sourceListId);
  const parsedRows = (source.items ?? []).map(parseMemberMasterMigrationRow);
  const validRows = parsedRows.filter((row): row is MemberMasterMigrationRow => !!row);
  const dedupedRows = dedupeMemberMasterRows(validRows);
  const skippedRows = (source.items ?? []).length - validRows.length;

  const created = await slackApi.createMemberMasterList(config);
  const destinationListId = created.list_id ?? created.list?.id;
  if (!destinationListId) {
    throw new Error("slackLists.create response missing member master list id");
  }

  if (config.adminUserIds.length > 0) {
    await slackApi.setListAccessForUsers(config, destinationListId, config.adminUserIds);
  }

  let migratedRows = 0;
  let errors = 0;
  for (const row of dedupedRows) {
    try {
      await slackApi.createMemberMasterItem(
        config,
        destinationListId,
        row.targetUser,
        row.defaultNotifyChannels,
        row.defaultNotifyUsers
      );
      if (!row.active) {
        const resolved = await slackApi.resolveMemberMasterRecord(config, destinationListId, row.targetUser);
        await slackApi.updateMemberMasterItem(
          config,
          destinationListId,
          resolved.kept,
          row.targetUser,
          row.defaultNotifyChannels,
          row.defaultNotifyUsers,
          false
        );
      }
      migratedRows += 1;
    } catch (error) {
      errors += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "member_master_migration_row_failed",
          fromListId: sourceListId,
          toListId: destinationListId,
          targetUser: row.targetUser,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  await writePersistedMemberMasterListId(config, destinationListId);
  return {
    fromListId: sourceListId,
    toListId: destinationListId,
    sourceRows: source.items?.length ?? 0,
    migratedRows,
    skippedRows,
    errors
  };
};
