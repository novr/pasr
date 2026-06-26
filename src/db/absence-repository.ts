import type { AppConfig } from "../config";
import { DEFAULT_ABSENCE_TYPE, type AbsenceRecord } from "../domain/absence";
import { getDb } from "./client";
import { serializeJsonArray } from "./json-columns";
import { rowToAbsenceRecord, type AbsenceRow } from "./row-mapper";

const nowIso = (): string => new Date().toISOString();

export const createAbsence = async (
  config: AppConfig,
  record: Omit<AbsenceRecord, "itemId"> & { itemId?: string }
): Promise<AbsenceRecord> => {
  const db = getDb(config);
  const id = record.itemId && record.itemId.length > 0 ? record.itemId : crypto.randomUUID();
  const timestamp = nowIso();
  await db
    .prepare(
      `INSERT INTO absences (
        id, target_user, start_date, end_date, absence_type,
        notify_channels, notify_users, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      id,
      record.targetUser,
      record.startDate,
      record.endDate,
      record.absenceType ?? DEFAULT_ABSENCE_TYPE,
      serializeJsonArray(record.notifyChannels),
      serializeJsonArray(record.notifyUsers),
      record.note ?? null,
      timestamp,
      timestamp
    )
    .run();
  const created = await getAbsenceById(config, id);
  if (!created) throw new Error("absence create verification failed");
  return created;
};

export const updateAbsence = async (config: AppConfig, record: AbsenceRecord): Promise<void> => {
  const db = getDb(config);
  await db
    .prepare(
      `UPDATE absences SET
        target_user = ?, start_date = ?, end_date = ?, absence_type = ?,
        notify_channels = ?, notify_users = ?, note = ?, updated_at = ?
       WHERE id = ?`
    )
    .bind(
      record.targetUser,
      record.startDate,
      record.endDate,
      record.absenceType ?? DEFAULT_ABSENCE_TYPE,
      serializeJsonArray(record.notifyChannels),
      serializeJsonArray(record.notifyUsers),
      record.note ?? null,
      nowIso(),
      record.itemId
    )
    .run();
};

export const deleteAbsenceById = async (config: AppConfig, id: string): Promise<void> => {
  await getDb(config).prepare("DELETE FROM absences WHERE id = ?").bind(id).run();
};

export const getAbsenceById = async (config: AppConfig, id: string): Promise<AbsenceRecord | undefined> => {
  const row = await getDb(config).prepare("SELECT * FROM absences WHERE id = ?").bind(id).first<AbsenceRow>();
  return row ? rowToAbsenceRecord(row) : undefined;
};

export const listAbsencesByUserFuture = async (
  config: AppConfig,
  userId: string,
  todayJst: string,
  options?: { limit?: number }
): Promise<AbsenceRecord[]> => {
  const limit = options?.limit;
  const sql =
    limit !== undefined
      ? `SELECT * FROM absences
       WHERE target_user = ? AND end_date >= ?
       ORDER BY start_date ASC, id ASC
       LIMIT ?`
      : `SELECT * FROM absences
       WHERE target_user = ? AND end_date >= ?
       ORDER BY start_date ASC, id ASC`;
  const statement = getDb(config).prepare(sql);
  const result =
    limit !== undefined
      ? await statement.bind(userId, todayJst, limit).all<AbsenceRow>()
      : await statement.bind(userId, todayJst).all<AbsenceRow>();
  return (result.results ?? []).map(rowToAbsenceRecord);
};

export const listAllAbsences = async (config: AppConfig): Promise<AbsenceRecord[]> => {
  const result = await getDb(config)
    .prepare("SELECT * FROM absences ORDER BY start_date ASC, id ASC")
    .all<AbsenceRow>();
  return (result.results ?? []).map(rowToAbsenceRecord);
};

export const listAbsencesActiveOnDate = async (
  config: AppConfig,
  todayJst: string
): Promise<AbsenceRecord[]> => {
  const result = await getDb(config)
    .prepare(
      `SELECT * FROM absences
       WHERE start_date <= ? AND end_date >= ?
       ORDER BY start_date ASC, id ASC`
    )
    .bind(todayJst, todayJst)
    .all<AbsenceRow>();
  return (result.results ?? []).map(rowToAbsenceRecord);
};

export const listAbsenceIdsEndedBefore = async (
  config: AppConfig,
  todayJst: string
): Promise<string[]> => {
  const result = await getDb(config)
    .prepare("SELECT id FROM absences WHERE end_date < ?")
    .bind(todayJst)
    .all<{ id: string }>();
  return (result.results ?? []).map((row) => row.id);
};

export const countAbsences = async (config: AppConfig): Promise<number> => {
  const row = await getDb(config).prepare("SELECT COUNT(*) AS count FROM absences").first<{ count: number }>();
  return row?.count ?? 0;
};

export const insertAbsenceOrIgnore = async (
  config: AppConfig,
  record: AbsenceRecord,
  timestamps: { createdAt: string; updatedAt: string }
): Promise<boolean> => {
  const result = await getDb(config)
    .prepare(
      `INSERT OR IGNORE INTO absences (
        id, target_user, start_date, end_date, absence_type,
        notify_channels, notify_users, note, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
    )
    .bind(
      record.itemId,
      record.targetUser,
      record.startDate,
      record.endDate,
      record.absenceType ?? DEFAULT_ABSENCE_TYPE,
      serializeJsonArray(record.notifyChannels),
      serializeJsonArray(record.notifyUsers),
      record.note ?? null,
      timestamps.createdAt,
      timestamps.updatedAt
    )
    .run();
  return (result.meta.changes ?? 0) > 0;
};
