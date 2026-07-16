import { describe, expect, it } from "vitest";
import { ensureMemberMasterActive, getMemberMaster, listMemberMasterRecords, upsertMemberMaster } from "./member-master-repository";
import { createTestConfig, createMockKv } from "../test/mock-kv";

describe("member-master-repository", () => {
  it("upserts and reads member master", async () => {
    const config = createTestConfig(createMockKv());
    await upsertMemberMaster(config, {
      targetUser: "U1",
      active: true,
      defaultNotifyChannels: ["C1"],
      defaultNotifyUsers: ["U2"],
      defaultRegistrationNotify: "both"
    });
    const row = await getMemberMaster(config, "U1");
    expect(row?.defaultNotifyChannels).toEqual(["C1"]);
    expect(row?.defaultRegistrationNotify).toBe("both");
  });

  it("ensureMemberMasterActive seeds notice channels from config", async () => {
    const config = createTestConfig(createMockKv(), { noticeChannels: ["C_NOTICE", "C_NOTICE2"] });
    const row = await ensureMemberMasterActive(config, "U_NOTICE");
    expect(row.defaultNotifyChannels).toEqual(["C_NOTICE", "C_NOTICE2"]);
  });

  it("ensureMemberMasterActive creates minimal row", async () => {
    const config = createTestConfig(createMockKv());
    const row = await ensureMemberMasterActive(config, "U9");
    expect(row.active).toBe(true);
    expect(row.defaultNotifyChannels).toEqual([]);
  });

  it("listMemberMasterRecords orders active first", async () => {
    const config = createTestConfig(createMockKv());
    await upsertMemberMaster(config, {
      targetUser: "U_B",
      active: false,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    await upsertMemberMaster(config, {
      targetUser: "U_A",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    const rows = await listMemberMasterRecords(config, { limit: 10 });
    expect(rows.map((row) => row.targetUser)).toEqual(["U_A", "U_B"]);
  });
});
