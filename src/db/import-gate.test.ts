import { describe, expect, it } from "vitest";
import { getImportGateMessage } from "./import-gate";
import { createTestConfig, createMockKv } from "../test/mock-kv";

describe("import-gate", () => {
  it("blocks writes until import completed", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv);
    expect(await getImportGateMessage(config)).toBeTruthy();
    await kv.put("db:import:completed", "true");
    expect(await getImportGateMessage(config)).toBeUndefined();
  });
});
