const WORKER_ORIGIN_PREFIX = "pasr:worker_origin:";
const WORKER_ORIGIN_TTL_SEC = 60 * 60 * 24 * 7;

const workerOriginKey = (userId: string): string => `${WORKER_ORIGIN_PREFIX}${userId}`;

export const rememberWorkerOriginForUser = async (
  stateKv: KVNamespace,
  userId: string,
  origin: string
): Promise<void> => {
  const trimmed = origin.trim().replace(/\/$/, "");
  if (!userId || trimmed.length === 0) return;
  await stateKv.put(workerOriginKey(userId), trimmed, {
    expirationTtl: WORKER_ORIGIN_TTL_SEC
  });
};

export const readRememberedWorkerOriginForUser = async (
  stateKv: KVNamespace,
  userId: string
): Promise<string> => {
  if (!userId) return "";
  const value = await stateKv.get(workerOriginKey(userId));
  return value?.trim().replace(/\/$/, "") ?? "";
};

export const resolvePublicBaseUrlForUser = async (
  config: { stateKv: KVNamespace; publicBaseUrl: string },
  userId: string,
  requestOrigin = ""
): Promise<string> => {
  const override = config.publicBaseUrl.trim().replace(/\/$/, "");
  if (override.length > 0) return override;
  const fromRequest = requestOrigin.trim().replace(/\/$/, "");
  if (fromRequest.length > 0) {
    await rememberWorkerOriginForUser(config.stateKv, userId, fromRequest);
    return fromRequest;
  }
  return readRememberedWorkerOriginForUser(config.stateKv, userId);
};
