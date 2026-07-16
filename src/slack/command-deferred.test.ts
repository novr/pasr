import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { handleChannelConfigCommandMock, handleUsersCommandMock, handleAbsencesCommandMock } = vi.hoisted(() => ({
  handleChannelConfigCommandMock: vi.fn(async () => "config updated"),
  handleUsersCommandMock: vi.fn(async () => "users listed"),
  handleAbsencesCommandMock: vi.fn(async () => "absences listed")
}));

vi.mock("./channel-config", () => ({
  handleChannelConfigCommand: handleChannelConfigCommandMock
}));

vi.mock("./admin-users", () => ({
  handleUsersCommand: handleUsersCommandMock
}));

vi.mock("./admin-absences", () => ({
  handleAbsencesCommand: handleAbsencesCommandMock
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
    handleUsersCommandMock.mockResolvedValue("users listed");
    handleAbsencesCommandMock.mockResolvedValue("absences listed");
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

const adminPayload = {
  command: "/pasr-admin",
  userId: "U_ADMIN",
  teamId: "T1",
  channelId: "C1",
  triggerId: "tr1",
  responseUrl: "https://hooks.slack.com/commands/1/2/3"
} as const;

describe("admin deferred handlers", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    handleUsersCommandMock.mockResolvedValue("users listed");
    handleAbsencesCommandMock.mockResolvedValue("absences listed");
    vi.stubGlobal("fetch", vi.fn(async () => ({ ok: true }) as Response));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("users runs deferred handler without queue", async () => {
    const config = createTestConfig(createMockKv());
    const dispatch = await resolveSlashCommandDispatch(config, {
      ...adminPayload,
      text: "users"
    });
    expect(dispatch.mode).toBe("deferred");
    if (dispatch.mode !== "deferred") return;
    await dispatch.run();
    expect(handleUsersCommandMock).toHaveBeenCalled();
    expect(fetch).toHaveBeenCalledWith(
      adminPayload.responseUrl,
      expect.objectContaining({ body: expect.stringContaining("users listed") })
    );
  });

  it("absences runs deferred handler without queue", async () => {
    const config = createTestConfig(createMockKv());
    const dispatch = await resolveSlashCommandDispatch(config, {
      ...adminPayload,
      text: "absences"
    });
    expect(dispatch.mode).toBe("deferred");
    if (dispatch.mode !== "deferred") return;
    await dispatch.run();
    expect(handleAbsencesCommandMock).toHaveBeenCalled();
  });
});
