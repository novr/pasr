import type { AppConfig } from "../config";

export const getDb = (config: AppConfig): D1Database => config.db;
