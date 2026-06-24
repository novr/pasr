import { describe, expect, it } from "vitest";
import { existsSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadDevVars } from "./load-dev-vars";

describe("loadDevVars", () => {
  it("loads KEY=value pairs without export prefix", () => {
    const dir = mkdtempSync(join(tmpdir(), "pasr-dev-vars-"));
    const path = join(dir, ".dev.vars");
    writeFileSync(path, "RUN_ENDPOINT_TOKEN=test-token\n# comment\nSLACK_BOT_TOKEN=xoxb\n");

    const previous = process.env.RUN_ENDPOINT_TOKEN;
    Reflect.deleteProperty(process.env, "RUN_ENDPOINT_TOKEN");
    loadDevVars(path);
    expect(process.env.RUN_ENDPOINT_TOKEN).toBe("test-token");
    if (previous === undefined) {
      Reflect.deleteProperty(process.env, "RUN_ENDPOINT_TOKEN");
    } else {
      process.env.RUN_ENDPOINT_TOKEN = previous;
    }
    expect(existsSync(path)).toBe(true);
  });
});
