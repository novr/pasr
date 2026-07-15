import { describe, expect, it } from "vitest";
import { checkChannelNotifySettingsSchema, checkDbSchema, checkSlackUserOAuthSchema } from "./schema-check";
import { createTestConfig, createMockKv } from "../test/mock-kv";
import { createMockD1 } from "../test/mock-d1";

describe("schema-check", () => {
  it("returns ok when tables exist in mock d1", async () => {
    const config = createTestConfig(createMockKv());
    expect(await checkDbSchema(config)).toBe("ok");
    expect(await checkChannelNotifySettingsSchema(config)).toBe("ok");
  });

  it("reports channel_notify_settings missing before migration", async () => {
    const config = createTestConfig(createMockKv(), {
      db: createMockD1({ includeChannelNotifySettings: false })
    });
    expect(await checkDbSchema(config)).toBe("ok");
    expect(await checkChannelNotifySettingsSchema(config)).toBe("schema_missing");
  });

  it("reports slack_user_oauth missing before migration", async () => {
    const config = createTestConfig(createMockKv(), {
      db: createMockD1({ includeSlackUserOAuth: false })
    });
    expect(await checkSlackUserOAuthSchema(config)).toBe("schema_missing");
  });
});
