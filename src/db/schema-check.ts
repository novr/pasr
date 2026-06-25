import type { AppConfig } from "../config";
import { getDb } from "./client";

export type DbSchemaStatus = "ok" | "schema_missing";

export const checkDbSchema = async (config: AppConfig): Promise<DbSchemaStatus> => {
  const db = getDb(config);
  const result = await db
    .prepare(
      `SELECT name FROM sqlite_master
       WHERE type = 'table' AND name IN ('absences', 'member_master')`
    )
    .all<{ name: string }>();
  const names = new Set((result.results ?? []).map((row) => row.name));
  if (!names.has("absences") || !names.has("member_master")) {
    return "schema_missing";
  }
  return "ok";
};

export class DbSchemaMismatchError extends Error {
  constructor() {
    super("db_schema_mismatch");
    this.name = "DbSchemaMismatchError";
  }
}

export const assertDbSchema = async (config: AppConfig): Promise<void> => {
  const status = await checkDbSchema(config);
  if (status !== "ok") {
    console.error(JSON.stringify({ level: "error", event: "db_schema_mismatch" }));
    throw new DbSchemaMismatchError();
  }
};
