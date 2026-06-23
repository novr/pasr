import type { AppConfig } from "../config";
import { ABSENCE_LIST_NAME, ABSENCE_SCHEMA_VERSION, parseAbsence, type AbsenceRecord } from "../domain/absence";
import { MEMBER_MASTER_LIST_NAME, MEMBER_MASTER_SCHEMA_VERSION } from "../domain/member-master";
import {
  buildArchivedListName,
  evaluateSchemaStatus,
  hasExpectedAbsenceSchema,
  hasExpectedMemberMasterSchema,
  MIGRATE_HINT,
  MIGRATION_ERRORS_HINT,
  pasrManagedListBaseName,
  isPasrManagedListName,
  PRUNE_AFTER_MIGRATE_HINT,
  PRUNE_EMPTY_HINT,
  PRUNE_REMAINING_HINT,
  type ListSchemaStatus
} from "../domain/list-schema";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "../domain/slack-list-value";
import { slackApi, type SlackListItem } from "../slack/api";
import { createListDiscovery, type ListDiscovery } from "../slack/list-discovery";
import {
  readPersistedAbsenceSchemaVersion,
  readPersistedListId,
  readPersistedMemberMasterListId,
  readPersistedMemberMasterSchemaVersion,
  addPrunePending,
  readPrunePending,
  removePrunePending,
  type PruneCandidate,
  writePersistedAbsenceSchemaVersion,
  writePersistedListId,
  writePersistedMemberMasterListId,
  writePersistedMemberMasterSchemaVersion
} from "../state/kv";

export type ActiveListIds = {
  absenceListId: string;
  memberMasterListId: string;
};

export type SetupResult = {
  listId: string;
  memberMasterListId: string;
};

type MemberMasterMigrationRow = {
  targetUser: string;
  active: boolean;
  defaultNotifyChannels: string[];
  defaultNotifyUsers: string[];
  updatedTimestamp: number;
};

export type ListKindMigrationResult = {
  listName: string;
  fromListIds: string[];
  toListId: string;
  sourceRows: number;
  migratedRows: number;
  skippedRows: number;
  errors: number;
  skipped: boolean;
};

export type ListMigrationResult = {
  skippedMigration: boolean;
  skipReason?: "up_to_date";
  hints: string[];
  absence: ListKindMigrationResult;
  memberMaster: ListKindMigrationResult;
};

export type ListPruneKindResult = {
  activeListId: string;
  found: number;
  deleted: number;
  errors: number;
};

export type ListPruneResult = {
  skippedPrune: boolean;
  skipReason?: "migrate_required";
  hints: string[];
  absence: ListPruneKindResult;
  memberMaster: ListPruneKindResult;
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

const logSchemaOutdated = (listName: string, listId: string, status: ListSchemaStatus): void => {
  if (status.upToDate) return;
  console.warn(
    JSON.stringify({
      level: "warn",
      event: "list_schema_outdated",
      listName,
      listId,
      versionUpToDate: status.versionUpToDate,
      shapeUpToDate: status.shapeUpToDate,
      hint: MIGRATE_HINT
    })
  );
};

const readMemberMasterShapeValid = async (config: AppConfig, listId: string): Promise<boolean> =>
  hasExpectedMemberMasterSchema(await slackApi.readMemberMasterSchemaColumns(config, listId));

const readAbsenceShapeValid = async (config: AppConfig, listId: string): Promise<boolean> =>
  hasExpectedAbsenceSchema(await slackApi.readAbsenceSchemaColumns(config, listId));

const inspectMemberMasterSchema = async (
  config: AppConfig,
  listId: string,
  persistedVersion: number | undefined
): Promise<ListSchemaStatus> => {
  const columns = await slackApi.readMemberMasterSchemaColumns(config, listId);
  return evaluateSchemaStatus(persistedVersion, MEMBER_MASTER_SCHEMA_VERSION, hasExpectedMemberMasterSchema(columns));
};

const inspectAbsenceSchema = async (
  config: AppConfig,
  listId: string,
  persistedVersion: number | undefined
): Promise<ListSchemaStatus> => {
  const columns = await slackApi.readAbsenceSchemaColumns(config, listId);
  return evaluateSchemaStatus(persistedVersion, ABSENCE_SCHEMA_VERSION, hasExpectedAbsenceSchema(columns));
};

const mergeListIds = (...candidates: Array<string | undefined>): string[] => [
  ...new Set(candidates.filter((id): id is string => !!id))
];

const resolvePreferredListId = async (
  config: AppConfig,
  listName: string,
  persistedListId: string | undefined,
  inspectShape: (listId: string) => Promise<boolean>,
  loadDiscovery?: () => Promise<ListDiscovery>
): Promise<string | undefined> => {
  if (persistedListId && (await inspectShape(persistedListId))) {
    return persistedListId;
  }

  const discovered = loadDiscovery
    ? (await loadDiscovery()).findByExactName(listName)
    : await slackApi.findListIdsByName(config, listName);
  const listIds = mergeListIds(...discovered, persistedListId);
  if (listIds.length === 0) return undefined;

  for (const listId of listIds) {
    if (await inspectShape(listId)) return listId;
  }
  return undefined;
};

const persistListKvIfShapeValid = async (
  config: AppConfig,
  listName: string,
  listId: string,
  status: ListSchemaStatus,
  writeListId: (config: AppConfig, listId: string) => Promise<void>,
  writeVersion: (config: AppConfig, version: number) => Promise<void>,
  expectedVersion: number
): Promise<boolean> => {
  if (!status.shapeUpToDate) {
    logSchemaOutdated(listName, listId, status);
    return false;
  }
  await writeListId(config, listId);
  if (!status.versionUpToDate) {
    await writeVersion(config, expectedVersion);
  }
  return true;
};

const archiveSourceLists = async (
  config: AppConfig,
  baseName: string,
  sourceListIds: string[],
  destinationListId: string
): Promise<void> => {
  for (const listId of sourceListIds) {
    if (listId === destinationListId) continue;
    const archivedName = buildArchivedListName(baseName, listId);
    try {
      await slackApi.renameList(config, listId, archivedName);
      await addPrunePending(config, [{ listId, listName: archivedName }]);
    } catch (error) {
      console.error(
        JSON.stringify({
          level: "error",
          event: "list_migration_archive_rename_failed",
          baseName,
          listId,
          archivedName,
          destinationListId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }
};

const commitMigrationTarget = async (
  errors: number,
  destinationListId: string,
  event: string,
  writeListId: () => Promise<void>,
  writeVersion: () => Promise<void>
): Promise<void> => {
  if (errors > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event,
        errors,
        destinationListId
      })
    );
    return;
  }
  await writeListId();
  await writeVersion();
};

const syncSchemaVersionIfShapeValid = async (
  config: AppConfig,
  listName: string,
  listId: string,
  status: ListSchemaStatus,
  writeVersion: (config: AppConfig, version: number) => Promise<void>,
  expectedVersion: number
): Promise<void> => {
  if (!status.shapeUpToDate) {
    logSchemaOutdated(listName, listId, status);
    return;
  }
  if (!status.versionUpToDate) {
    await writeVersion(config, expectedVersion);
  }
};

export const resolveActiveListIds = async (config: AppConfig): Promise<ActiveListIds> => {
  const persistedAbsenceListId = await readPersistedListId(config);
  const persistedMemberMasterListId = await readPersistedMemberMasterListId(config);

  const absenceListId = await resolvePreferredListId(
    config,
    ABSENCE_LIST_NAME,
    persistedAbsenceListId,
    (listId) => readAbsenceShapeValid(config, listId)
  );
  const memberMasterListId = await resolvePreferredListId(
    config,
    MEMBER_MASTER_LIST_NAME,
    persistedMemberMasterListId,
    (listId) => readMemberMasterShapeValid(config, listId)
  );

  if (!absenceListId) {
    throw new Error(`active absence list not found. ${MIGRATE_HINT}`);
  }
  if (!memberMasterListId) {
    throw new Error(`active member_master list not found. ${MIGRATE_HINT}`);
  }

  return { absenceListId, memberMasterListId };
};

export const ensureMemberMasterList = async (config: AppConfig): Promise<string> => {
  const ensureListAccess = async (listId: string): Promise<void> => {
    if (config.adminUserIds.length === 0) return;
    await slackApi.setListAccessForUsers(config, listId, config.adminUserIds);
  };

  const persisted = await readPersistedMemberMasterListId(config);
  const persistedSchemaVersion = await readPersistedMemberMasterSchemaVersion(config);
  if (persisted) {
    const status = await inspectMemberMasterSchema(config, persisted, persistedSchemaVersion);
    if (status.shapeUpToDate) {
      await syncSchemaVersionIfShapeValid(
        config,
        MEMBER_MASTER_LIST_NAME,
        persisted,
        status,
        writePersistedMemberMasterSchemaVersion,
        MEMBER_MASTER_SCHEMA_VERSION
      );
      await ensureListAccess(persisted);
      return persisted;
    }

    const alternative = await resolvePreferredListId(
      config,
      MEMBER_MASTER_LIST_NAME,
      persisted,
      (listId) => readMemberMasterShapeValid(config, listId)
    );
    if (alternative) {
      const alternativeStatus = await inspectMemberMasterSchema(config, alternative, persistedSchemaVersion);
      if (
        await persistListKvIfShapeValid(
          config,
          MEMBER_MASTER_LIST_NAME,
          alternative,
          alternativeStatus,
          writePersistedMemberMasterListId,
          writePersistedMemberMasterSchemaVersion,
          MEMBER_MASTER_SCHEMA_VERSION
        )
      ) {
        await ensureListAccess(alternative);
        return alternative;
      }
    }

    logSchemaOutdated(MEMBER_MASTER_LIST_NAME, persisted, status);
    await ensureListAccess(persisted);
    return persisted;
  }

  const foundByName = await resolvePreferredListId(
    config,
    MEMBER_MASTER_LIST_NAME,
    undefined,
    (listId) => readMemberMasterShapeValid(config, listId)
  );
  if (foundByName) {
    const status = await inspectMemberMasterSchema(config, foundByName, persistedSchemaVersion);
    if (
      !(await persistListKvIfShapeValid(
        config,
        MEMBER_MASTER_LIST_NAME,
        foundByName,
        status,
        writePersistedMemberMasterListId,
        writePersistedMemberMasterSchemaVersion,
        MEMBER_MASTER_SCHEMA_VERSION
      ))
    ) {
      throw new Error(`member_master list schema outdated: ${foundByName}. ${MIGRATE_HINT}`);
    }
    await ensureListAccess(foundByName);
    return foundByName;
  }

  const created = await slackApi.createMemberMasterList(config);
  const createdListId = created.list_id ?? created.list?.id;
  if (!createdListId) {
    throw new Error("slackLists.create response missing member master list id");
  }
  await writePersistedMemberMasterListId(config, createdListId);
  await writePersistedMemberMasterSchemaVersion(config, MEMBER_MASTER_SCHEMA_VERSION);
  await ensureListAccess(createdListId);
  return createdListId;
};

export const runSetup = async (config: AppConfig): Promise<SetupResult> => {
  const ensureAbsenceListAccess = async (listId: string): Promise<void> => {
    if (config.adminUserIds.length === 0) return;
    await slackApi.setListAccessForUsers(config, listId, config.adminUserIds);
  };

  const persistedAbsenceListId = await readPersistedListId(config);
  const targetListId = persistedAbsenceListId;
  const persistedAbsenceSchemaVersion = await readPersistedAbsenceSchemaVersion(config);

  const finalizeAbsenceList = async (listId: string, created: boolean): Promise<SetupResult> => {
    const status = await inspectAbsenceSchema(config, listId, persistedAbsenceSchemaVersion);
    if (created) {
      await writePersistedListId(config, listId);
      await writePersistedAbsenceSchemaVersion(config, ABSENCE_SCHEMA_VERSION);
    } else if (
      !(await persistListKvIfShapeValid(
        config,
        ABSENCE_LIST_NAME,
        listId,
        status,
        writePersistedListId,
        writePersistedAbsenceSchemaVersion,
        ABSENCE_SCHEMA_VERSION
      ))
    ) {
      throw new Error(`absence list schema outdated: ${listId}. ${MIGRATE_HINT}`);
    }
    await ensureAbsenceListAccess(listId);
    return {
      listId,
      memberMasterListId: await ensureMemberMasterList(config)
    };
  };

  const resolvedAbsenceId = await resolvePreferredListId(
    config,
    ABSENCE_LIST_NAME,
    targetListId,
    (listId) => readAbsenceShapeValid(config, listId)
  );

  if (!resolvedAbsenceId) {
    const created = await slackApi.createAbsenceList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) {
      throw new Error("slackLists.create response missing list id");
    }
    return finalizeAbsenceList(createdListId, true);
  }

  return finalizeAbsenceList(resolvedAbsenceId, false);
};

const dedupeAbsenceRecords = (records: AbsenceRecord[]): AbsenceRecord[] => {
  const deduped = new Map<string, AbsenceRecord>();
  for (const record of records) {
    const key = `${record.targetUser}:${record.startDate}:${record.endDate}`;
    deduped.set(key, record);
  }
  return [...deduped.values()];
};

const PRUNE_MAX_DELETES_PER_RUN = 40;

const registerPrunePendingListIds = async (
  config: AppConfig,
  listIds: string[],
  discovery?: ListDiscovery
): Promise<void> => {
  if (listIds.length === 0) return;
  const nameById = new Map((discovery?.listAll() ?? []).map((file) => [file.id, file.name]));
  await addPrunePending(
    config,
    listIds.map((listId) => ({
      listId,
      listName: nameById.get(listId) ?? listId
    }))
  );
};

const skippedKindResult = (
  listName: string,
  listId: string,
  allListIds: string[]
): ListKindMigrationResult => ({
  listName,
  fromListIds: allListIds.filter((id) => id !== listId),
  toListId: listId,
  sourceRows: 0,
  migratedRows: 0,
  skippedRows: 0,
  errors: 0,
  skipped: true
});

const migrateMemberMasterKind = async (
  config: AppConfig,
  loadDiscovery?: () => Promise<ListDiscovery>
): Promise<ListKindMigrationResult> => {
  const persistedListId = await readPersistedMemberMasterListId(config);
  const persistedVersion = await readPersistedMemberMasterSchemaVersion(config);
  const sourceListId = await resolvePreferredListId(
    config,
    MEMBER_MASTER_LIST_NAME,
    persistedListId,
    (listId) => readMemberMasterShapeValid(config, listId),
    loadDiscovery
  );
  if (!sourceListId) {
    const created = await slackApi.createMemberMasterList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) throw new Error("slackLists.create response missing member master list id");
    await writePersistedMemberMasterListId(config, createdListId);
    await writePersistedMemberMasterSchemaVersion(config, MEMBER_MASTER_SCHEMA_VERSION);
    return {
      listName: MEMBER_MASTER_LIST_NAME,
      fromListIds: mergeListIds(persistedListId),
      toListId: createdListId,
      sourceRows: 0,
      migratedRows: 0,
      skippedRows: 0,
      errors: 0,
      skipped: false
    };
  }

  const status = await inspectMemberMasterSchema(config, sourceListId, persistedVersion);
  if (status.upToDate || (status.shapeUpToDate && !status.versionUpToDate)) {
    if (status.shapeUpToDate && !status.versionUpToDate) {
      await writePersistedMemberMasterSchemaVersion(config, MEMBER_MASTER_SCHEMA_VERSION);
    }
    return skippedKindResult(MEMBER_MASTER_LIST_NAME, sourceListId, [sourceListId]);
  }

  const listDiscovery = loadDiscovery ? await loadDiscovery() : await createListDiscovery(config);
  const allListIds = mergeListIds(
    ...listDiscovery.findByExactName(MEMBER_MASTER_LIST_NAME),
    persistedListId,
    sourceListId
  );
  await registerPrunePendingListIds(config, allListIds, listDiscovery);

  const allRows: MemberMasterMigrationRow[] = [];
  let sourceRows = 0;
  for (const listId of allListIds) {
    const source = await slackApi.listItems(config, listId);
    sourceRows += source.items?.length ?? 0;
    for (const item of source.items ?? []) {
      const row = parseMemberMasterMigrationRow(item);
      if (row) allRows.push(row);
    }
  }
  const dedupedRows = dedupeMemberMasterRows(allRows);
  const skippedRows = sourceRows - allRows.length;

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
        row.defaultNotifyUsers,
        row.active
      );
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

  await commitMigrationTarget(
    errors,
    destinationListId,
    "member_master_migration_kv_not_updated",
    () => writePersistedMemberMasterListId(config, destinationListId),
    () => writePersistedMemberMasterSchemaVersion(config, MEMBER_MASTER_SCHEMA_VERSION)
  );
  if (errors === 0) {
    await archiveSourceLists(
      config,
      MEMBER_MASTER_LIST_NAME,
      allListIds.filter((id) => id !== destinationListId),
      destinationListId
    );
  }
  return {
    listName: MEMBER_MASTER_LIST_NAME,
    fromListIds: allListIds.filter((id) => id !== destinationListId),
    toListId: destinationListId,
    sourceRows,
    migratedRows,
    skippedRows,
    errors,
    skipped: false
  };
};

const migrateAbsenceKind = async (
  config: AppConfig,
  loadDiscovery?: () => Promise<ListDiscovery>
): Promise<ListKindMigrationResult> => {
  const persistedListId = await readPersistedListId(config);
  const persistedVersion = await readPersistedAbsenceSchemaVersion(config);
  const sourceListId = await resolvePreferredListId(
    config,
    ABSENCE_LIST_NAME,
    persistedListId,
    (listId) => readAbsenceShapeValid(config, listId),
    loadDiscovery
  );
  if (!sourceListId) {
    const created = await slackApi.createAbsenceList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) throw new Error("slackLists.create response missing list id");
    await writePersistedListId(config, createdListId);
    await writePersistedAbsenceSchemaVersion(config, ABSENCE_SCHEMA_VERSION);
    return {
      listName: ABSENCE_LIST_NAME,
      fromListIds: mergeListIds(persistedListId),
      toListId: createdListId,
      sourceRows: 0,
      migratedRows: 0,
      skippedRows: 0,
      errors: 0,
      skipped: false
    };
  }

  const status = await inspectAbsenceSchema(config, sourceListId, persistedVersion);
  if (status.upToDate || (status.shapeUpToDate && !status.versionUpToDate)) {
    if (status.shapeUpToDate && !status.versionUpToDate) {
      await writePersistedAbsenceSchemaVersion(config, ABSENCE_SCHEMA_VERSION);
    }
    return skippedKindResult(ABSENCE_LIST_NAME, sourceListId, [sourceListId]);
  }

  const listDiscovery = loadDiscovery ? await loadDiscovery() : await createListDiscovery(config);
  const allListIds = mergeListIds(...listDiscovery.findByExactName(ABSENCE_LIST_NAME), persistedListId, sourceListId);
  await registerPrunePendingListIds(config, allListIds, listDiscovery);

  const allRecords: AbsenceRecord[] = [];
  let sourceRows = 0;
  let skippedRows = 0;
  for (const listId of allListIds) {
    const source = await slackApi.listItems(config, listId);
    sourceRows += source.items?.length ?? 0;
    for (const item of source.items ?? []) {
      const parsed = parseAbsence(item);
      if (parsed.ok) {
        allRecords.push(parsed.record);
      } else {
        skippedRows += 1;
      }
    }
  }
  const validRecords = dedupeAbsenceRecords(allRecords);

  const created = await slackApi.createAbsenceList(config);
  const destinationListId = created.list_id ?? created.list?.id;
  if (!destinationListId) {
    throw new Error("slackLists.create response missing list id");
  }
  if (config.adminUserIds.length > 0) {
    await slackApi.setListAccessForUsers(config, destinationListId, config.adminUserIds);
  }

  let migratedRows = 0;
  let errors = 0;
  for (const record of validRecords) {
    try {
      await slackApi.createAbsenceItem(config, destinationListId, record);
      migratedRows += 1;
    } catch (error) {
      errors += 1;
      console.error(
        JSON.stringify({
          level: "error",
          event: "absence_migration_row_failed",
          fromListId: sourceListId,
          toListId: destinationListId,
          itemId: record.itemId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  await commitMigrationTarget(
    errors,
    destinationListId,
    "absence_migration_kv_not_updated",
    () => writePersistedListId(config, destinationListId),
    () => writePersistedAbsenceSchemaVersion(config, ABSENCE_SCHEMA_VERSION)
  );
  if (errors === 0) {
    await archiveSourceLists(
      config,
      ABSENCE_LIST_NAME,
      allListIds.filter((id) => id !== destinationListId),
      destinationListId
    );
  }
  return {
    listName: ABSENCE_LIST_NAME,
    fromListIds: allListIds.filter((id) => id !== destinationListId),
    toListId: destinationListId,
    sourceRows,
    migratedRows,
    skippedRows,
    errors,
    skipped: false
  };
};

export const runListMigration = async (config: AppConfig): Promise<ListMigrationResult> => {
  const cache = { discovery: undefined as ListDiscovery | undefined };
  const loadDiscovery = async (): Promise<ListDiscovery> => {
    cache.discovery ??= await createListDiscovery(config);
    return cache.discovery;
  };
  const memberMaster = await migrateMemberMasterKind(config, loadDiscovery);
  const absence = await migrateAbsenceKind(config, loadDiscovery);
  const skippedMigration = memberMaster.skipped && absence.skipped;
  const hints: string[] = [];
  if (!skippedMigration) {
    const totalErrors = memberMaster.errors + absence.errors;
    if (totalErrors === 0) {
      hints.push(PRUNE_AFTER_MIGRATE_HINT);
    } else {
      hints.push(MIGRATION_ERRORS_HINT);
    }
  }
  return {
    skippedMigration,
    skipReason: skippedMigration ? "up_to_date" : undefined,
    hints,
    absence,
    memberMaster
  };
};

export const runListPrune = async (config: AppConfig): Promise<ListPruneResult> => {
  const { absenceListId: activeAbsenceListId, memberMasterListId: activeMemberMasterListId } =
    await resolveActiveListIds(config);
  const absenceStatus = await inspectAbsenceSchema(
    config,
    activeAbsenceListId,
    await readPersistedAbsenceSchemaVersion(config)
  );
  const memberMasterStatus = await inspectMemberMasterSchema(
    config,
    activeMemberMasterListId,
    await readPersistedMemberMasterSchemaVersion(config)
  );
  if (!absenceStatus.upToDate || !memberMasterStatus.upToDate) {
    return {
      skippedPrune: true,
      skipReason: "migrate_required",
      hints: [MIGRATE_HINT],
      absence: { activeListId: activeAbsenceListId, found: 0, deleted: 0, errors: 0 },
      memberMaster: { activeListId: activeMemberMasterListId, found: 0, deleted: 0, errors: 0 }
    };
  }

  const activeListIds = new Set([activeAbsenceListId, activeMemberMasterListId]);
  const targetsById = new Map<string, PruneCandidate>();

  for (const pending of await readPrunePending(config)) {
    if (!activeListIds.has(pending.listId)) {
      targetsById.set(pending.listId, pending);
    }
  }

  if (targetsById.size === 0) {
    try {
      const botUserId = await slackApi.getAuthedUserId(config);
      const discovery = await createListDiscovery(config, { userId: botUserId, maxPages: 10 });
      for (const list of discovery.listAll()) {
        if (isPasrManagedListName(list.name) && !activeListIds.has(list.id)) {
          targetsById.set(list.id, { listId: list.id, listName: list.name });
        }
      }
    } catch (error) {
      console.warn(
        JSON.stringify({
          level: "warn",
          event: "prune_discovery_skipped",
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  await addPrunePending(config, [...targetsById.values()]);
  const targets = [...targetsById.values()];
  const toDelete = targets.slice(0, PRUNE_MAX_DELETES_PER_RUN);
  const deletedIds = new Set<string>();
  const errorIds = new Set<string>();

  for (const target of toDelete) {
    try {
      await slackApi.deleteList(config, target.listId);
      await removePrunePending(config, target.listId);
      deletedIds.add(target.listId);
    } catch (error) {
      errorIds.add(target.listId);
      console.error(
        JSON.stringify({
          level: "error",
          event: "list_prune_delete_failed",
          listName: target.listName,
          listId: target.listId,
          message: error instanceof Error ? error.message : String(error)
        })
      );
    }
  }

  const kindResult = (baseName: string, activeListId: string): ListPruneKindResult => {
    const kindTargets = targets.filter((target) => pasrManagedListBaseName(target.listName) === baseName);
    return {
      activeListId,
      found: kindTargets.length,
      deleted: kindTargets.filter((target) => deletedIds.has(target.listId)).length,
      errors: kindTargets.filter((target) => errorIds.has(target.listId)).length
    };
  };

  const absence = kindResult(ABSENCE_LIST_NAME, activeAbsenceListId);
  const memberMaster = kindResult(MEMBER_MASTER_LIST_NAME, activeMemberMasterListId);
  const hints: string[] = [];
  if (targets.length === 0) {
    hints.push(PRUNE_EMPTY_HINT);
  } else if (targets.length > toDelete.length) {
    hints.push(PRUNE_REMAINING_HINT);
  }

  return {
    skippedPrune: false,
    hints,
    absence,
    memberMaster
  };
};
