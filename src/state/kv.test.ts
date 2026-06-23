import { describe, expect, it } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import {
  addPrunePending,
  readPrunePending,
  releaseMigrationLock,
  removePrunePending,
  tryAcquireMigrationLock
} from "./kv";

describe("kv prune pending", () => {
  it("merges prune pending by list id", async () => {
    const config = createTestConfig(createMockKv());
    await addPrunePending(config, [{ listId: "L1", listName: "absence_list__archived__L1", archived: true }]);
    await addPrunePending(config, [{ listId: "L1", listName: "absence_list__archived__L1-renamed", archived: true }]);
    expect(await readPrunePending(config)).toEqual([
      { listId: "L1", listName: "absence_list__archived__L1-renamed", archived: true }
    ]);
  });

  it("removePrunePending deletes key when empty", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv);
    await addPrunePending(config, [{ listId: "L1", listName: "n1", archived: true }]);
    await removePrunePending(config, "L1");
    expect(await readPrunePending(config)).toEqual([]);
  });

  it("readPrunePending returns empty array for invalid json", async () => {
    const kv = createMockKv();
    await kv.put("prune:pending", "{not-json");
    const config = createTestConfig(kv);
    expect(await readPrunePending(config)).toEqual([]);
  });
});

describe("migration lock", () => {
  it("allows only one active lock", async () => {
    const config = createTestConfig(createMockKv());
    expect(await tryAcquireMigrationLock(config)).toBe(true);
    expect(await tryAcquireMigrationLock(config)).toBe(false);
    await releaseMigrationLock(config);
    expect(await tryAcquireMigrationLock(config)).toBe(true);
  });
});
