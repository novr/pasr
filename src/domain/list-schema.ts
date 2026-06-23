import { absenceSchema } from "./absence";
import { memberMasterSchema } from "./member-master";

export type ListSchemaColumn = {
  key?: string;
  name?: string;
  type?: string;
  is_primary_column?: boolean;
  options?: Record<string, unknown>;
};

export type ListSchemaStatus = {
  versionUpToDate: boolean;
  shapeUpToDate: boolean;
  upToDate: boolean;
};

type ExpectedColumn = {
  key: string;
  name: string;
  type: string;
  is_primary_column?: boolean;
  options?: Record<string, unknown>;
};

export const ARCHIVED_LIST_INFIX = "__archived__";

export const buildArchivedListName = (baseName: string, listId: string): string =>
  `${baseName}${ARCHIVED_LIST_INFIX}${listId}`;

export const isArchivedListName = (baseName: string, listName: string): boolean =>
  listName.startsWith(`${baseName}${ARCHIVED_LIST_INFIX}`);

const asRecord = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" ? (value as Record<string, unknown>) : null;

const findColumn = (columns: ListSchemaColumn[], key: string, name: string): ListSchemaColumn | undefined =>
  columns.find((column) => column.key === key) ?? columns.find((column) => column.name === name);

const valuesEqual = (left: unknown, right: unknown): boolean => {
  if (left === right) return true;
  if (!left || !right || typeof left !== "object" || typeof right !== "object") return false;
  return JSON.stringify(left) === JSON.stringify(right);
};

const optionsMatch = (actual: unknown, expected: Record<string, unknown>): boolean => {
  const actualRecord = asRecord(actual);
  if (!actualRecord) return false;
  for (const [key, expectedValue] of Object.entries(expected)) {
    if (key === "choices") continue;
    if (!valuesEqual(actualRecord[key], expectedValue)) return false;
  }
  return true;
};

const columnMatches = (actual: ListSchemaColumn | undefined, expected: ExpectedColumn): boolean => {
  if (!actual?.type) return false;
  if (actual.type !== expected.type) return false;
  if (expected.is_primary_column === true && !actual.is_primary_column) return false;
  if (expected.options && !optionsMatch(actual.options, expected.options)) return false;
  return true;
};

const hasExpectedSchema = (columns: ListSchemaColumn[], expected: readonly ExpectedColumn[]): boolean => {
  for (const spec of expected) {
    const column = findColumn(columns, spec.key, spec.name);
    if (!columnMatches(column, spec)) return false;
  }
  return true;
};

export const hasExpectedMemberMasterSchema = (columns: ListSchemaColumn[]): boolean =>
  hasExpectedSchema(columns, memberMasterSchema);

export const hasExpectedAbsenceSchema = (columns: ListSchemaColumn[]): boolean =>
  hasExpectedSchema(columns, absenceSchema);

export const evaluateSchemaStatus = (
  persistedVersion: number | undefined,
  expectedVersion: number,
  shapeUpToDate: boolean
): ListSchemaStatus => {
  const versionUpToDate = persistedVersion === expectedVersion;
  return {
    versionUpToDate,
    shapeUpToDate,
    upToDate: versionUpToDate && shapeUpToDate
  };
};

export const MIGRATE_HINT = "スキーマ不一致時は /pasr-admin migrate を実行してください。";
export const PRUNE_AFTER_MIGRATE_HINT = "移行後は /pasr-admin prune で archived 旧 List を削除できます。";
export const MIGRATION_ERRORS_HINT =
  "移行エラーがあるため KV は切り替えていません。原因を修正して /pasr-admin migrate を再実行してください。";
