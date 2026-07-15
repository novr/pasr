import type { AppConfig } from "../config";
import { decryptToken, encryptToken } from "../crypto/token-encryption";
import { getDb } from "./client";

export type SlackUserOAuthRecord = {
  userId: string;
  accessTokenEnc: string;
  scope: string;
  updatedAt: string;
};

const TABLE = "slack_user_oauth";

export const upsertSlackUserOAuth = async (
  config: AppConfig,
  params: { userId: string; accessToken: string; scope: string }
): Promise<void> => {
  const encryptionKey = config.slackOauthEncryptionKey;
  if (!encryptionKey) {
    throw new Error("slack_oauth_encryption_key_missing");
  }
  const accessTokenEnc = await encryptToken(params.accessToken, encryptionKey);
  const updatedAt = new Date().toISOString();
  await getDb(config)
    .prepare(
      `INSERT INTO ${TABLE} (user_id, access_token_enc, scope, updated_at)
       VALUES (?, ?, ?, ?)
       ON CONFLICT(user_id) DO UPDATE SET
         access_token_enc = excluded.access_token_enc,
         scope = excluded.scope,
         updated_at = excluded.updated_at`
    )
    .bind(params.userId, accessTokenEnc, params.scope, updatedAt)
    .run();
};

export const deleteSlackUserOAuthByUserId = async (
  config: AppConfig,
  userId: string
): Promise<void> => {
  await getDb(config).prepare(`DELETE FROM ${TABLE} WHERE user_id = ?`).bind(userId).run();
};

export const getSlackUserOAuth = async (
  config: AppConfig,
  userId: string
): Promise<SlackUserOAuthRecord | null> => {
  const row = await getDb(config)
    .prepare(`SELECT user_id, access_token_enc, scope, updated_at FROM ${TABLE} WHERE user_id = ?`)
    .bind(userId)
    .first<{
      user_id: string;
      access_token_enc: string;
      scope: string;
      updated_at: string;
    }>();
  if (!row) return null;
  return {
    userId: row.user_id,
    accessTokenEnc: row.access_token_enc,
    scope: row.scope,
    updatedAt: row.updated_at
  };
};

export const listSlackUserOAuthForUserIds = async (
  config: AppConfig,
  userIds: string[]
): Promise<Map<string, SlackUserOAuthRecord>> => {
  const result = new Map<string, SlackUserOAuthRecord>();
  if (userIds.length === 0) return result;
  const placeholders = userIds.map(() => "?").join(", ");
  const rows = await getDb(config)
    .prepare(
      `SELECT user_id, access_token_enc, scope, updated_at
       FROM ${TABLE}
       WHERE user_id IN (${placeholders})`
    )
    .bind(...userIds)
    .all<{
      user_id: string;
      access_token_enc: string;
      scope: string;
      updated_at: string;
    }>();
  for (const row of rows.results ?? []) {
    result.set(row.user_id, {
      userId: row.user_id,
      accessTokenEnc: row.access_token_enc,
      scope: row.scope,
      updatedAt: row.updated_at
    });
  }
  return result;
};

export const decryptSlackUserAccessToken = async (
  config: AppConfig,
  record: SlackUserOAuthRecord
): Promise<string> => {
  const encryptionKey = config.slackOauthEncryptionKey;
  if (!encryptionKey) {
    throw new Error("slack_oauth_encryption_key_missing");
  }
  return decryptToken(record.accessTokenEnc, encryptionKey);
};

export const hasSlackUserOAuth = async (config: AppConfig, userId: string): Promise<boolean> => {
  const row = await getDb(config)
    .prepare(`SELECT user_id FROM ${TABLE} WHERE user_id = ?`)
    .bind(userId)
    .first<{ user_id: string }>();
  return row?.user_id === userId;
};
