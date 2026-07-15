import type { AppConfig } from "../config";
import { createMockD1 } from "./mock-d1";

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

export const createTestConfig = (
  stateKv: KVNamespace,
  overrides: Partial<AppConfig> = {}
): AppConfig => ({
  stateKv,
  db: createMockD1(),
  runEndpointToken: "test-token",
  debugEndpointsEnabled: false,
  slackBotToken: "xoxb-test",
  slackSigningSecret: "test-secret",
  slackClientId: "",
  slackClientSecret: "",
  slackOauthEncryptionKey: "",
  publicBaseUrl: "",
  statusDefaultText: "不在",
  statusEmoji: ":date:",
  timezone: "Asia/Tokyo",
  adminUserIds: ["U_ADMIN"],
  pasrUsersUsergroupId: "",
  notifyEmptyDefault: true,
  opsChannelId: "",
  noticeChannels: [],
  ...overrides
});
