import { defineConfig } from "vitest/config";
import { loadDevVars } from "./src/test/load-dev-vars";

loadDevVars();

export default defineConfig({
  test: {
    environment: "node",
    include: ["src/integration/**/*.integration.test.ts"],
    testTimeout: 60_000,
    hookTimeout: 30_000,
    fileParallelism: false
  }
});
