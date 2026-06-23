import type { ListSchemaStatus } from "./list-schema";

export const mergeListIds = (...candidates: Array<string | undefined>): string[] => [
  ...new Set(candidates.filter((id): id is string => !!id))
];

export const pickMigrationSourceListId = (
  listIds: string[],
  persistedListId?: string
): string | undefined => {
  if (listIds.length === 0) return undefined;
  if (persistedListId && listIds.includes(persistedListId)) return persistedListId;
  return listIds[0];
};

export const needsMigrationDataRecoveryFromCounts = (
  activeListId: string,
  itemCountsByListId: Record<string, number>
): boolean => {
  if ((itemCountsByListId[activeListId] ?? 0) > 0) return false;
  for (const [listId, count] of Object.entries(itemCountsByListId)) {
    if (listId === activeListId) continue;
    if (count > 0) return true;
  }
  return false;
};

export const shouldSkipListKindMigration = (
  status: ListSchemaStatus,
  needsDataRecovery: boolean
): boolean => {
  const canSkipForVersion = status.upToDate || (status.shapeUpToDate && !status.versionUpToDate);
  return canSkipForVersion && !needsDataRecovery;
};
