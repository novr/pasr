import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";
import { upsertChannelNotifySetting } from "../db/channel-notify-repository";
import { handleChannelConfigCommand } from "./channel-config";
import type { SlackCommandPayload } from "./command";

const basePayload = (overrides: Partial<SlackCommandPayload> = {}): SlackCommandPayload => ({
  command: "/pasr-admin",
  text: "channel-config empty off",
  userId: "U_ADMIN",
  teamId: "T1",
  channelId: "C_TARGET",
  triggerId: "tr1",
  responseUrl: "",
  ...overrides
});

describe("handleChannelConfigCommand", () => {
  it("rejects empty override outside a channel", async () => {
    const config = createTestConfig(createMockKv());
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ channelId: "D_DM", text: "channel-config empty off" }),
      { kind: "empty", value: "off" }
    );
    expect(text).toContain("チャンネル内でのみ");
  });

  it("returns schema_missing when channel_notify_settings is absent", async () => {
    const config = createTestConfig(createMockKv(), {
      db: createMockD1({ includeChannelNotifySettings: false })
    });
    const text = await handleChannelConfigCommand(config, basePayload(), { kind: "empty", value: "off" });
    expect(text).toContain("db: schema_missing");
  });

  it("upserts empty off and reports no delivery", async () => {
    const config = createTestConfig(createMockKv());
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ text: "channel-config empty off" }),
      { kind: "empty", value: "off" }
    );
    expect(text).toContain("配信しない");
    expect(text).toContain("channel override off");
  });

  it("upserts empty on and reports delivery for non-notice channel", async () => {
    const config = createTestConfig(createMockKv());
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ text: "channel-config empty on" }),
      { kind: "empty", value: "on" }
    );
    expect(text).toContain("配信する");
    expect(text).toContain("channel override on");
  });

  it("reports no delivery for non-notice channel on default even when org default is on", async () => {
    const config = createTestConfig(createMockKv(), { notifyEmptyDefault: true });
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ text: "channel-config empty default" }),
      { kind: "empty", value: "default" }
    );
    expect(text).toContain("配信しない");
    expect(text).toContain("notice 外");
    expect(text).toContain("empty on でオプトイン");
    expect(text).toContain("設定: empty default");
  });

  it("status reports current channel without mutating", async () => {
    const config = createTestConfig(createMockKv(), { notifyEmptyDefault: true });
    const text = await handleChannelConfigCommand(config, basePayload(), { kind: "status" });
    expect(text).toContain("配信しない");
    expect(text).toContain("notice 外");
    expect(text).not.toContain("設定: empty");
  });

  it("lists channel overrides with fan-out note", async () => {
    const config = createTestConfig(createMockKv());
    await upsertChannelNotifySetting(config, "C1", false, "U_ADMIN");
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ channelId: "", text: "channel-config list" }),
      { kind: "list" }
    );
    expect(text).toContain("org default: on");
    expect(text).toContain("notice CH");
    expect(text).toContain("C1");
    expect(text).toContain("off");
  });
});
