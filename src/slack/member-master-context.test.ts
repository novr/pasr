import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { getMemberMasterMock, ensureMemberMasterActiveMock, addUserToPasrUsergroupMock } = vi.hoisted(() => ({
  getMemberMasterMock: vi.fn(),
  ensureMemberMasterActiveMock: vi.fn(),
  addUserToPasrUsergroupMock: vi.fn(async () => undefined)
}));

vi.mock("../db/member-master-repository", () => ({
  getMemberMaster: getMemberMasterMock,
  ensureMemberMasterActive: ensureMemberMasterActiveMock
}));

vi.mock("./usergroup", () => ({
  addUserToPasrUsergroup: addUserToPasrUsergroupMock
}));

import { resolveMasterContext } from "./member-master-context";

const createdRecord = {
  targetUser: "U_NEW",
  active: true,
  defaultNotifyChannels: [] as string[],
  defaultNotifyUsers: [] as string[],
  defaultRegistrationNotify: "none" as const
};

describe("resolveMasterContext", () => {
  beforeEach(() => {
    getMemberMasterMock.mockReset();
    ensureMemberMasterActiveMock.mockReset();
    addUserToPasrUsergroupMock.mockReset();
    addUserToPasrUsergroupMock.mockResolvedValue(undefined);
  });

  it("does not add to usergroup when member already exists", async () => {
    getMemberMasterMock.mockResolvedValue({
      ...createdRecord,
      targetUser: "U_EXISTING"
    });
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });

    const result = await resolveMasterContext(config, "U_EXISTING");

    expect(result.active).toBe(true);
    expect(ensureMemberMasterActiveMock).not.toHaveBeenCalled();
    expect(addUserToPasrUsergroupMock).not.toHaveBeenCalled();
  });

  it("adds to usergroup when member is created for the first time", async () => {
    getMemberMasterMock.mockResolvedValue(undefined);
    ensureMemberMasterActiveMock.mockResolvedValue(createdRecord);
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });

    const result = await resolveMasterContext(config, "U_NEW");

    expect(result.defaultRegistrationNotify).toBe("none");
    expect(ensureMemberMasterActiveMock).toHaveBeenCalledWith(config, "U_NEW");
    expect(addUserToPasrUsergroupMock).toHaveBeenCalledWith(config, "U_NEW");
  });

  it("returns master context even when usergroup add resolves without throwing", async () => {
    getMemberMasterMock.mockResolvedValue(undefined);
    ensureMemberMasterActiveMock.mockResolvedValue(createdRecord);
    addUserToPasrUsergroupMock.mockResolvedValue(undefined);
    const config = createTestConfig(createMockKv(), { pasrUsersUsergroupId: "S_GROUP" });

    const result = await resolveMasterContext(config, "U_NEW");

    expect(result.active).toBe(true);
    expect(addUserToPasrUsergroupMock).toHaveBeenCalledOnce();
  });
});
