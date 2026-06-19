import type { AppConfig } from "../config";
import { slackApi } from "../slack/api";

export type SetupResult = {
  listId: string;
  created: boolean;
  reconciled: boolean;
  accessGranted: boolean;
};

export const runSetup = async (config: AppConfig): Promise<SetupResult> => {
  const ensureAccess = async (listId: string): Promise<boolean> => {
    if (config.listAccessUserIds.length === 0) return false;
    await slackApi.setListAccessForUsers(config, listId, config.listAccessUserIds);
    return true;
  };

  if (!config.absenceListId) {
    const created = await slackApi.createAbsenceList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) {
      throw new Error("slackLists.create response missing list id");
    }
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
    await slackApi.reconcileAbsenceListFields(config, config.absenceListId);
    reconciled = true;
  } catch (error) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "setup_reconcile_failed",
        listId: config.absenceListId,
        message: error instanceof Error ? error.message : String(error)
      })
    );
  }

  return {
    listId: config.absenceListId,
    created: false,
    reconciled,
    accessGranted: await ensureAccess(config.absenceListId)
  };
};
