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

  it("upserts empty off and reports effective value", async () => {
    const config = createTestConfig(createMockKv());
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ text: "channel-config empty off" }),
      { kind: "empty", value: "off" }
    );
    expect(text).toContain("0件時通知: off");
    expect(text).toContain("channel override");
  });

  it("lists channel overrides", async () => {
    const config = createTestConfig(createMockKv());
    await upsertChannelNotifySetting(config, "C1", false, "U_ADMIN");
    const text = await handleChannelConfigCommand(
      config,
      basePayload({ channelId: "", text: "channel-config list" }),
      { kind: "list" }
    );
    expect(text).toContain("org default: on");
    expect(text).toContain("C1");
    expect(text).toContain("off");
  });
});
