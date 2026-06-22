import type { AppConfig } from "../config";
import { slackApi } from "../slack/api";
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

export const ensureMemberMasterList = async (config: AppConfig): Promise<string> => {
  const ensureMemberMasterAccess = async (listId: string): Promise<void> => {
    if (config.adminUserIds.length === 0) return;
    await slackApi.setListAccessForUsers(config, listId, config.adminUserIds);
  };

  const ensureMemberMasterSchema = async (listId: string): Promise<void> => {
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
    await ensureMemberMasterSchema(persisted);
    await ensureMemberMasterAccess(persisted);
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
    await ensureMemberMasterSchema(foundByName);
    await ensureMemberMasterAccess(foundByName);
    return foundByName;
  }

  const created = await slackApi.createMemberMasterList(config);
  const createdListId = created.list_id ?? created.list?.id;
  if (!createdListId) {
    throw new Error("slackLists.create response missing member master list id");
  }
  await writePersistedMemberMasterListId(config, createdListId);
  await ensureMemberMasterAccess(createdListId);
  return createdListId;
};

export const runSetup = async (
  config: AppConfig,
  options?: { preferredListId?: string }
): Promise<SetupResult> => {
  const ensureAccess = async (listId: string): Promise<boolean> => {
    if (config.adminUserIds.length === 0) return false;
    await slackApi.setListAccessForUsers(config, listId, config.adminUserIds);
    return true;
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
      let reconciled = false;
      try {
        await slackApi.reconcileAbsenceListFields(config, existingListId);
        reconciled = true;
      } catch (error) {
        console.warn(
          JSON.stringify({
            level: "warn",
            event: "setup_reconcile_failed",
            listId: existingListId,
            message: error instanceof Error ? error.message : String(error)
          })
        );
      }
      await writePersistedListId(config, existingListId);
      return {
        listId: existingListId,
        memberMasterListId: await ensureMemberMasterList(config),
        created: false,
        reconciled,
        accessGranted: await ensureAccess(existingListId)
      };
    }

    const created = await slackApi.createAbsenceList(config);
    const createdListId = created.list_id ?? created.list?.id;
    if (!createdListId) {
      throw new Error("slackLists.create response missing list id");
    }
    await writePersistedListId(config, createdListId);
    const accessGranted = await ensureAccess(createdListId);
    return {
      listId: createdListId,
      memberMasterListId: await ensureMemberMasterList(config),
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
    memberMasterListId: await ensureMemberMasterList(config),
    created: false,
    reconciled,
    accessGranted: await ensureAccess(targetListId)
  };
};
