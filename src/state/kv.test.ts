import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { readImportCompleted, readImportSummary, writeImportCompleted } from "./kv";

describe("import kv", () => {
  it("readImportCompleted returns false when unset", async () => {
    const config = createTestConfig(createMockKv());
    expect(await readImportCompleted(config)).toBe(false);
  });

  it("writeImportCompleted stores summary", async () => {
    const config = createTestConfig(createMockKv());
    const summary = { absences: { processed: 9 }, memberMaster: { processed: 12 } };
    await writeImportCompleted(config, summary);
    expect(await readImportCompleted(config)).toBe(true);
    expect(await readImportSummary(config)).toEqual(summary);
  });
});
