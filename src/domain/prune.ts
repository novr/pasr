import { ABSENCE_LIST_NAME } from "./absence";
import { MEMBER_MASTER_LIST_NAME } from "./member-master";
import { isArchivedListName, isPasrManagedListName } from "./list-schema";

export const PRUNE_MAX_DELETES_PER_RUN = 40;

export type PruneTarget = {
  listId: string;
  listName: string;
  archived?: boolean;
};

export type DiscoveredList = {
  id: string;
  name: string;
};

export const isArchivedPruneCandidate = (candidate: PruneTarget): boolean =>
  candidate.archived === true ||
  isArchivedListName(ABSENCE_LIST_NAME, candidate.listName) ||
  isArchivedListName(MEMBER_MASTER_LIST_NAME, candidate.listName);

export type MergePruneTargetsResult = {
  targets: PruneTarget[];
  toDelete: PruneTarget[];
  hasRemaining: boolean;
};

export const mergePruneTargets = (
  pending: PruneTarget[],
  discovered: DiscoveredList[],
  activeListIds: ReadonlySet<string>,
  maxDeletesPerRun = PRUNE_MAX_DELETES_PER_RUN
): MergePruneTargetsResult => {
  const targetsById = new Map<string, PruneTarget>();

  for (const candidate of pending) {
    if (!activeListIds.has(candidate.listId) && isArchivedPruneCandidate(candidate)) {
      targetsById.set(candidate.listId, candidate);
    }
  }

  for (const list of discovered) {
    if (isPasrManagedListName(list.name) && !activeListIds.has(list.id)) {
      targetsById.set(list.id, { listId: list.id, listName: list.name });
    }
  }

  const targets = [...targetsById.values()];
  const toDelete = targets.slice(0, maxDeletesPerRun);
  return {
    targets,
    toDelete,
    hasRemaining: targets.length > toDelete.length
  };
};

export type ExecutePruneDeletesResult = {
  deletedIds: Set<string>;
  errorIds: Set<string>;
};

export const executePruneDeletes = async (
  toDelete: PruneTarget[],
  deps: {
    deleteList: (listId: string) => Promise<void>;
    removePrunePending: (listId: string) => Promise<void>;
    logDeleteFailed?: (target: PruneTarget, error: unknown) => void;
  }
): Promise<ExecutePruneDeletesResult> => {
  const deletedIds = new Set<string>();
  const errorIds = new Set<string>();
  for (const target of toDelete) {
    try {
      await deps.deleteList(target.listId);
      await deps.removePrunePending(target.listId);
      deletedIds.add(target.listId);
    } catch (error) {
      errorIds.add(target.listId);
      deps.logDeleteFailed?.(target, error);
    }
  }
  return { deletedIds, errorIds };
};
