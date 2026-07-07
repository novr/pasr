import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import {
  deleteChannelNotifySetting,
  loadChannelNotifySettingsMap,
  resolveNotifyWhenEmpty,
  upsertChannelNotifySetting
} from "./channel-notify-repository";

describe("channel-notify-repository", () => {
  it("loads map and resolves org default", async () => {
    const config = createTestConfig(createMockKv());
    await upsertChannelNotifySetting(config, "C1", false, "U_ADMIN");
    const map = await loadChannelNotifySettingsMap(config);
    expect(resolveNotifyWhenEmpty("C1", map, true)).toBe(false);
    expect(resolveNotifyWhenEmpty("C2", map, true)).toBe(true);
  });

  it("deletes channel override", async () => {
    const config = createTestConfig(createMockKv());
    await upsertChannelNotifySetting(config, "C1", false, "U_ADMIN");
    await deleteChannelNotifySetting(config, "C1");
    const map = await loadChannelNotifySettingsMap(config);
    expect(map.size).toBe(0);
    expect(resolveNotifyWhenEmpty("C1", map, false)).toBe(false);
  });
});
