import { describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { publishAppHome } from "./app-home-publish";

const { publishHomeViewMock } = vi.hoisted(() => ({
  publishHomeViewMock: vi.fn(async () => ({}))
}));

vi.mock("./api", () => ({
  slackApi: {
    publishHomeView: publishHomeViewMock
  }
}));

vi.mock("./app-home-data", () => ({
  loadAppHomeData: vi.fn(async () => {
    throw new Error("db down");
  })
}));

const baseConfig = createTestConfig(createMockKv());

describe("publishAppHome fallback", () => {
  it("publishes static fallback when data load fails", async () => {
    await publishAppHome(baseConfig, "U1");

    expect(publishHomeViewMock).toHaveBeenCalledWith(
      baseConfig,
      "U1",
      expect.arrayContaining([
        expect.objectContaining({ type: "header" }),
        expect.objectContaining({ type: "actions" })
      ])
    );
  });
});
