import { describe, expect, it } from "vitest";
import { ensureMemberMasterActive, getMemberMaster, listMemberMasterRecords, listMemberMasterStatusPrefsForUserIds, upsertMemberMaster } from "./member-master-repository";
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

  it("round-trips status prefs and clears them with null", async () => {
    const config = createTestConfig(createMockKv());
    await upsertMemberMaster(config, {
      targetUser: "U_STATUS",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusDefaultText: "リモート",
      statusEmoji: ":house:"
    });
    const row = await getMemberMaster(config, "U_STATUS");
    expect(row?.statusDefaultText).toBe("リモート");
    expect(row?.statusEmoji).toBe(":house:");

    const prefs = await listMemberMasterStatusPrefsForUserIds(config, ["U_STATUS", "U_MISSING"]);
    expect(prefs.get("U_STATUS")).toEqual({ statusDefaultText: "リモート", statusEmoji: ":house:" });
    expect(prefs.has("U_MISSING")).toBe(false);

    await upsertMemberMaster(config, {
      targetUser: "U_STATUS",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none"
    });
    const preserved = await getMemberMaster(config, "U_STATUS");
    expect(preserved?.statusDefaultText).toBe("リモート");
    expect(preserved?.statusEmoji).toBe(":house:");

    await upsertMemberMaster(config, {
      targetUser: "U_STATUS",
      active: true,
      defaultNotifyChannels: [],
      defaultNotifyUsers: [],
      defaultRegistrationNotify: "none",
      statusDefaultText: null,
      statusEmoji: null
    });
    const cleared = await getMemberMaster(config, "U_STATUS");
    expect(cleared?.statusDefaultText).toBeUndefined();
    expect(cleared?.statusEmoji).toBeUndefined();
  });
});
