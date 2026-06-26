import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { slackApiPostMock, SlackApiError } = vi.hoisted(() => {
  class SlackApiError extends Error {
    readonly method: string;
    readonly slackError: string;

    constructor(method: string, slackError: string) {
      super(`Slack API error (${method}): ${slackError}`);
      this.method = method;
      this.slackError = slackError;
    }
  }

  return {
    slackApiPostMock: vi.fn(),
    SlackApiError
  };
});

vi.mock("./client", () => ({
  SlackApiError,
  slackApiPost: slackApiPostMock
}));

import { addUserToPasrUsergroup } from "./usergroup";

describe("addUserToPasrUsergroup", () => {
  beforeEach(() => {
    slackApiPostMock.mockReset();
  });

  it("skips API calls when usergroup id is unset", async () => {
    const config = createTestConfig(createMockKv());
    await addUserToPasrUsergroup(config, "U_NEW");
    expect(slackApiPostMock).not.toHaveBeenCalled();
  });

  it("does not update when user is already in the group", async () => {
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });
    slackApiPostMock.mockResolvedValueOnce({ users: ["U_EXISTING"] });

    await addUserToPasrUsergroup(config, "U_EXISTING");

    expect(slackApiPostMock).toHaveBeenCalledTimes(1);
    expect(slackApiPostMock).toHaveBeenCalledWith(config, "usergroups.users.list", {
      usergroup: "S_GROUP"
    });
  });

  it("lists and updates with comma-separated users for a new member", async () => {
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });
    slackApiPostMock
      .mockResolvedValueOnce({ users: ["U1"] })
      .mockResolvedValueOnce({ ok: true });

    await addUserToPasrUsergroup(config, "U2");

    expect(slackApiPostMock).toHaveBeenCalledTimes(2);
    expect(slackApiPostMock).toHaveBeenNthCalledWith(2, config, "usergroups.users.update", {
      usergroup: "S_GROUP",
      users: "U1,U2"
    });
  });

  it("warns and does not throw when list fails", async () => {
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });
    const warnSpy = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    slackApiPostMock.mockRejectedValueOnce(new SlackApiError("usergroups.users.list", "missing_scope"));

    await expect(addUserToPasrUsergroup(config, "U2")).resolves.toBeUndefined();

    expect(warnSpy).toHaveBeenCalledOnce();
    const logged = JSON.parse(String(warnSpy.mock.calls[0]?.[0])) as { event: string; slack_error: string };
    expect(logged.event).toBe("pasr_usergroup_add_failed");
    expect(logged.slack_error).toBe("missing_scope");
    warnSpy.mockRestore();
  });

  it("retries update after list merge when first update fails", async () => {
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });
    slackApiPostMock
      .mockResolvedValueOnce({ users: ["U1"] })
      .mockRejectedValueOnce(new SlackApiError("usergroups.users.update", "user_not_found"))
      .mockResolvedValueOnce({ users: ["U1", "U3"] })
      .mockResolvedValueOnce({ ok: true });

    await addUserToPasrUsergroup(config, "U2");

    expect(slackApiPostMock).toHaveBeenCalledTimes(4);
    expect(slackApiPostMock).toHaveBeenNthCalledWith(4, config, "usergroups.users.update", {
      usergroup: "S_GROUP",
      users: "U1,U3,U2"
    });
  });
});
