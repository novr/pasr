import type { AppConfig } from "../config";
import { readImportCompleted } from "../state/kv";

export const IMPORT_GATE_MESSAGE = "データ移行中です。しばらくしてから再度お試しください。";

export const isImportCompleted = async (config: AppConfig): Promise<boolean> =>
  readImportCompleted(config);

export const getImportGateMessage = async (config: AppConfig): Promise<string | undefined> => {
  const completed = await isImportCompleted(config);
  return completed ? undefined : IMPORT_GATE_MESSAGE;
};
