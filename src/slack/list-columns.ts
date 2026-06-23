import type { AppConfig } from "../config";
import type { MemberMasterColumnIds } from "../domain/member-master";
import { slackApiGet, slackApiPost } from "./client";

export type SlackListMetadataSchemaColumn = {
  key?: string;
  id?: string;
  name?: string;
  type?: string;
  is_primary_column?: boolean;
  options?: Record<string, unknown>;
};

type SlackListItem = {
  id: string;
};

type SlackListItemsListResponse = {
  items?: SlackListItem[];
  response_metadata?: {
    next_cursor?: string;
  };
};

type SlackListItemInfoResponse = {
  list?: {
    list_metadata?: {
      schema?: SlackListMetadataSchemaColumn[];
    };
  };
};

type FilesInfoResponse = {
  file?: {
    filetype?: string;
    list_metadata?: {
      schema?: SlackListMetadataSchemaColumn[];
    };
  };
};

type SlackListMetadataResponse = {
  list_metadata?: {
    schema?: SlackListMetadataSchemaColumn[];
  };
};

export type AbsenceColumnIds = {
  absenceTitle: string;
  targetUser: string;
  startDate: string;
  endDate: string;
  type?: string;
  notifyChannels?: string;
  notifyUsers?: string;
  note?: string;
};

const schemaCache = new Map<string, SlackListMetadataSchemaColumn[]>();
const memberMasterColumnIdsCache = new Map<string, MemberMasterColumnIds>();
const absenceColumnIdsCache = new Map<string, AbsenceColumnIds>();

export const cacheListSchema = (listId: string, schema: SlackListMetadataSchemaColumn[]): void => {
  if (schema.length === 0) return;
  schemaCache.set(listId, schema);
  memberMasterColumnIdsCache.delete(listId);
  absenceColumnIdsCache.delete(listId);
};

const listFirstItemId = async (config: AppConfig, listId: string): Promise<string | undefined> => {
  const page = await slackApiPost<SlackListItemsListResponse>(config, "slackLists.items.list", {
    list_id: listId,
    limit: 1
  });
  return page.items?.[0]?.id;
};

export const readListSchemaColumns = async (
  config: AppConfig,
  listId: string
): Promise<SlackListMetadataSchemaColumn[]> => {
  const cached = schemaCache.get(listId);
  if (cached) return cached;

  const fromFile = await slackApiGet<FilesInfoResponse>(config, "files.info", { file: listId });
  const fileSchema = fromFile.file?.list_metadata?.schema ?? [];
  if (fileSchema.length > 0) {
    schemaCache.set(listId, fileSchema);
    return fileSchema;
  }

  const firstItemId = await listFirstItemId(config, listId);
  if (firstItemId) {
    const info = await slackApiPost<SlackListItemInfoResponse>(config, "slackLists.items.info", {
      list_id: listId,
      id: firstItemId
    });
    const itemSchema = info.list?.list_metadata?.schema ?? [];
    if (itemSchema.length > 0) {
      schemaCache.set(listId, itemSchema);
      return itemSchema;
    }
  }

  return [];
};

export const readSchemaFromCreateResponse = (response: SlackListMetadataResponse): SlackListMetadataSchemaColumn[] =>
  response.list_metadata?.schema ?? [];

const columnIdByKey = (
  schema: SlackListMetadataSchemaColumn[],
  key: string,
  name: string
): string | undefined => {
  const byKey = schema.find((column) => column.key === key && column.id);
  if (byKey?.id) return byKey.id;
  return schema.find((column) => column.name === name && column.id)?.id;
};

export const resolveMemberMasterColumnIds = async (
  config: AppConfig,
  listId: string
): Promise<MemberMasterColumnIds | undefined> => {
  const cached = memberMasterColumnIdsCache.get(listId);
  if (cached) return cached;

  const schema = await readListSchemaColumns(config, listId);
  const primaryText = schema.find((column) => column.is_primary_column && column.id)?.id;
  const targetUser = columnIdByKey(schema, "target_user", "Target User");
  const defaultNotifyChannels = columnIdByKey(schema, "default_notify_channels", "Default Notify Channels");
  const defaultNotifyUsers = columnIdByKey(schema, "default_notify_users", "Default Notify Users");
  const defaultRegistrationNotify = columnIdByKey(
    schema,
    "default_registration_notify",
    "Default Registration Notify"
  );
  const active = columnIdByKey(schema, "active", "Active");

  if (!primaryText || !targetUser || !active) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "member_master_column_resolve_failed",
        listId,
        hasPrimaryText: Boolean(primaryText),
        hasTargetUser: Boolean(targetUser),
        hasActive: Boolean(active),
        schemaKeys: schema.map((column) => column.key ?? "").filter((key) => key.length > 0)
      })
    );
    return undefined;
  }

  const resolved: MemberMasterColumnIds = {
    primaryText,
    targetUser,
    defaultNotifyChannels,
    defaultNotifyUsers,
    defaultRegistrationNotify,
    active
  };
  if (defaultNotifyChannels && defaultNotifyUsers) {
    memberMasterColumnIdsCache.set(listId, resolved);
  } else {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "member_master_optional_columns_missing",
        listId,
        hasDefaultNotifyChannels: Boolean(defaultNotifyChannels),
        hasDefaultNotifyUsers: Boolean(defaultNotifyUsers)
      })
    );
  }
  return resolved;
};

export const resolveAbsenceColumnIds = async (
  config: AppConfig,
  listId: string
): Promise<AbsenceColumnIds | undefined> => {
  const cached = absenceColumnIdsCache.get(listId);
  if (cached) return cached;

  const schema = await readListSchemaColumns(config, listId);
  const absenceTitle = columnIdByKey(schema, "absence_title", "Absence");
  const targetUser = columnIdByKey(schema, "target_user", "Target User");
  const startDate = columnIdByKey(schema, "start_date", "Start Date");
  const endDate = columnIdByKey(schema, "end_date", "End Date");
  if (!absenceTitle || !targetUser || !startDate || !endDate) {
    console.warn(
      JSON.stringify({
        level: "warn",
        event: "absence_column_resolve_failed",
        listId,
        hasAbsenceTitle: Boolean(absenceTitle),
        hasTargetUser: Boolean(targetUser),
        hasStartDate: Boolean(startDate),
        hasEndDate: Boolean(endDate)
      })
    );
    return undefined;
  }

  const resolved: AbsenceColumnIds = {
    absenceTitle,
    targetUser,
    startDate,
    endDate,
    type: columnIdByKey(schema, "type", "Type"),
    notifyChannels: columnIdByKey(schema, "notify_channels", "Notify Channels"),
    notifyUsers: columnIdByKey(schema, "notify_users", "Notify Users"),
    note: columnIdByKey(schema, "note", "Note")
  };
  absenceColumnIdsCache.set(listId, resolved);
  return resolved;
};

export const richTextField = (columnId: string, text: string): Record<string, unknown> => ({
  column_id: columnId,
  rich_text: [
    {
      type: "rich_text",
      elements: [{ type: "rich_text_section", elements: [{ type: "text", text }] }]
    }
  ]
});
