#!/usr/bin/env node

import { spawnSync } from "node:child_process";
import { loadDevVars } from "../src/test/load-dev-vars";

loadDevVars();

const text = process.argv.slice(2).join(" ").trim();
if (!text) {
  console.error('Usage: npm run debug:mention-ai -- "明日 通院のため午後から"');
  console.error("Requires: npm run dev (another terminal)");
  process.exit(1);
}

const result = spawnSync(
  "npx",
  ["vitest", "run", "--config", "vitest.integration.config.ts", "-t", "@cli"],
  {
    env: {
      ...process.env,
      PASR_RUN_INTEGRATION: "1",
      PASR_MENTION_AI_TEXT: text
    },
    stdio: "inherit"
  }
);

process.exit(result.status ?? 1);
