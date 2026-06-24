type KvEntry = {
  value: string;
};

export const createMockKv = (): KVNamespace => {
  const store = new Map<string, KvEntry>();
  return {
    get: async (key: string) => store.get(key)?.value ?? null,
    put: async (key: string, value: string) => {
      store.set(key, { value });
    },
    delete: async (key: string) => {
      store.delete(key);
    },
    list: async () => ({ keys: [], list_complete: true, cacheStatus: null }),
    getWithMetadata: async (key: string) => ({
      value: store.get(key)?.value ?? null,
      metadata: null,
      cacheStatus: null
    })
  } as unknown as KVNamespace;
};

export const createTestConfig = (stateKv: KVNamespace) => ({
  stateKv,
  runEndpointToken: "test-token",
  debugEndpointsEnabled: false,
  slackBotToken: "xoxb-test",
  slackSigningSecret: "test-secret",
  timezone: "Asia/Tokyo",
  adminUserIds: ["U_ADMIN"],
  listAccessChannelIds: []
});
