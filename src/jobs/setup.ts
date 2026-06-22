import type { AppConfig } from "../config";
import { slackApi } from "../slack/api";
import { writePersistedListId } from "../state/kv";

export type SetupResult = {
  listId: string;
  created: boolean;
  reconciled: boolean;
  accessGranted: boolean;
};

export const runSetup = async (
  config: AppConfig,
  options?: { preferredListId?: string }
): Promise<SetupResult> => {
  const ensureAccess = async (listId: string): Promise<boolean> => {
    if (config.listAccessUserIds.length === 0) return false;
    await slackApi.setListAccessForUsers(config, listId, config.listAccessUserIds);
    return true;
  };

  const targetListId = options?.preferredListId ?? config.absenceListId;

  if (!targetListId) {
    const created = await slackApi.createAbsenceList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) {
      throw new Error("slackLists.create response missing list id");
    }
    await writePersistedListId(config, createdListId);
    const accessGranted = await ensureAccess(createdListId);
    return {
      listId: createdListId,
      created: true,
      reconciled: false,
      accessGranted
    };
  }

  let reconciled = false;
  try {
    await slackApi.reconcileAbsenceListFields(config, targetListId);
    reconciled = true;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "setup_reconcile_failed",
        listId: targetListId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }

  await writePersistedListId(config, targetListId);

  return {
    listId: targetListId,
    created: false,
    reconciled,
    accessGranted: await ensureAccess(targetListId)
  };
};
