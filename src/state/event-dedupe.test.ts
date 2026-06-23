import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { isDuplicateSlackCommandTrigger, isDuplicateSlackEvent } from "./event-dedupe";

describe("event-dedupe", () => {
  it("detects duplicate slack events", async () => {
    const config = createTestConfig(createMockKv());
    expect(await isDuplicateSlackEvent(config, "Ev123")).toBe(false);
    expect(await isDuplicateSlackEvent(config, "Ev123")).toBe(true);
  });

  it("detects duplicate slash command triggers", async () => {
    const config = createTestConfig(createMockKv());
    expect(await isDuplicateSlackCommandTrigger(config, "Tr123")).toBe(false);
    expect(await isDuplicateSlackCommandTrigger(config, "Tr123")).toBe(true);
  });

  it("treats empty ids as non-duplicate", async () => {
    const config = createTestConfig(createMockKv());
    expect(await isDuplicateSlackEvent(config, "")).toBe(false);
    expect(await isDuplicateSlackCommandTrigger(config, "")).toBe(false);
  });
});
