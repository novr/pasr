import { describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
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

  it("includes run_id in missing-table warn context", async () => {
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const config = createTestConfig(createMockKv(), {
      db: createMockD1({ includeChannelNotifySettings: false })
    });
    await loadChannelNotifySettingsMap(config, { runId: "run_warn_test" });
    expect(warnSpy).toHaveBeenCalledWith(
      expect.stringContaining('"event":"channel_notify_settings_table_missing"')
    );
    expect(warnSpy).toHaveBeenCalledWith(expect.stringContaining('"run_id":"run_warn_test"'));
    warnSpy.mockRestore();
  });
});
