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

    expect(handleChannelConfigCommandMock).toHaveBeenCalledWith(
      config,
      channelConfigPayload,
      { kind: "empty", value: "on" }
    );
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

  it.each([
    ["users", 1],
    ["absences", 1],
    ["channel-config empty on", { kind: "empty", value: "on" as const }]
  ] as const)("deferred admin %s does not queue", async (text, expectedArg) => {
    const config = createTestConfig(createMockKv());
    const dispatch = await resolveSlashCommandDispatch(config, {
      ...adminPayload,
      text
    });
    expect(dispatch.mode).toBe("deferred");
    if (dispatch.mode !== "deferred") return;
    await dispatch.run();
    if (text === "users") {
      expect(handleUsersCommandMock).toHaveBeenCalledWith(
        config,
        expect.objectContaining({ text }),
        expectedArg
      );
    } else if (text === "absences") {
      expect(handleAbsencesCommandMock).toHaveBeenCalledWith(
        config,
        expect.objectContaining({ text }),
        expectedArg
      );
    } else {
      expect(handleChannelConfigCommandMock).toHaveBeenCalledWith(
        config,
        expect.objectContaining({ text }),
        expectedArg
      );
    }
    expect(fetch).toHaveBeenCalledWith(
      adminPayload.responseUrl,
      expect.objectContaining({ method: "POST" })
    );
  });

  it("invalid channel-config returns immediate text not deferred", async () => {
    const config = createTestConfig(createMockKv());
    const dispatch = await resolveSlashCommandDispatch(config, {
      ...adminPayload,
      text: "channel-config empty maybe"
    });
    expect(dispatch.mode).toBe("text");
    if (dispatch.mode !== "text") return;
    expect(dispatch.text).toContain("empty");
  });

  it("invalid users text returns immediate text not queue", async () => {
    const config = createTestConfig(createMockKv());
    const dispatch = await resolveSlashCommandDispatch(config, {
      ...adminPayload,
      text: "users list"
    });
    expect(dispatch.mode).toBe("text");
    if (dispatch.mode !== "text") return;
    expect(dispatch.text).toContain("使い方");
  });
});
