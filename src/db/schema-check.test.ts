import { describe, expect, it } from "vitest";
import { checkDbSchema } from "./schema-check";
import { createTestConfig, createMockKv } from "../test/mock-kv";

describe("schema-check", () => {
  it("returns ok when tables exist in mock d1", async () => {
    const config = createTestConfig(createMockKv());
    expect(await checkDbSchema(config)).toBe("ok");
  });
});
