import { describe, expect, it } from "vitest";
import { createMockKv } from "../test/mock-kv";
import {
  readRememberedWorkerOriginForUser,
  rememberWorkerOriginForUser,
  resolvePublicBaseUrlForUser
} from "./worker-origin";

describe("worker-origin", () => {
  it("prefers PASR_PUBLIC_BASE_URL override", async () => {
    const stateKv = createMockKv();
    const url = await resolvePublicBaseUrlForUser(
      { stateKv, publicBaseUrl: "https://override.example" },
      "U1",
      "https://request.example"
    );
    expect(url).toBe("https://override.example");
  });

  it("remembers request origin and reuses it", async () => {
    const stateKv = createMockKv();
    const config = { stateKv, publicBaseUrl: "" };
    expect(await resolvePublicBaseUrlForUser(config, "U1", "https://worker.example")).toBe(
      "https://worker.example"
    );
    expect(await resolvePublicBaseUrlForUser(config, "U1")).toBe("https://worker.example");
    expect(await readRememberedWorkerOriginForUser(stateKv, "U1")).toBe("https://worker.example");
  });

  it("ignores empty remember writes", async () => {
    const stateKv = createMockKv();
    await rememberWorkerOriginForUser(stateKv, "U1", "   ");
    expect(await readRememberedWorkerOriginForUser(stateKv, "U1")).toBe("");
  });
});
