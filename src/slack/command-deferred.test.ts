import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { handleChannelConfigCommandMock } = vi.hoisted(() => ({
  handleChannelConfigCommandMock: vi.fn(async () => "config updated")
}));

vi.mock("./channel-config", () => ({
  handleChannelConfigCommand: handleChannelConfigCommandMock
}));

import { resolveSlashCommandDispatch } from "./command";

const channelConfigPayload = {
  command: "/pasr-admin",
  text: "channel-config empty on",
  userId: "U_ADMIN",
  teamId: "T1",
  channelId: "C1",
  triggerId: "tr1",
  responseUrl: "https://hooks.slack.com/commands/1/2/3"
};

describe("channel-config deferred handler", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleChannelConfigCommandMock.mockResolvedValue("config updated");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("runs D1 handler and delivers result via response_url", async () => {
    const config = createTestConfig(createMockKv());
    const dispatch = await resolveSlashCommandDispatch(config, channelConfigPayload);
    expect(dispatch.mode).toBe("deferred");
    if (dispatch.mode !== "deferred") return;

    await dispatch.run();

    expect(handleChannelConfigCommandMock).toHaveBeenCalledWith(config, channelConfigPayload);
    expect(fetch).toHaveBeenCalledWith(
      channelConfigPayload.responseUrl,
      expect.objectContaining({
        method: "POST",
        body: expect.stringContaining("config updated")
      })
    );
  });
});
