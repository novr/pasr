import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import type { SlackListItem } from "./slack-list-read";

const absenceItems: SlackListItem[] = Array.from({ length: 9 }, (_, index) => ({
  id: `abs-${index + 1}`,
  fields: {
    target_user: { user_id: `U${index + 1}` },
    start_date: "2026-06-24",
    end_date: "2026-06-24",
    type: "absence",
    notify_channels: [{ channel_id: "C1" }],
    notify_users: []
  }
}));

const memberItems: SlackListItem[] = Array.from({ length: 12 }, (_, index) => ({
  id: `mm-${index + 1}`,
  updated_timestamp: String(1_700_000_000_000 + index),
  fields: {
    target_user: { user_id: `U${index + 1}` },
    active: true,
    default_notify_channels: [],
    default_notify_users: [],
    default_registration_notify: "none"
  }
}));

const duplicateMember: SlackListItem = {
  id: "mm-dup-old",
  updated_timestamp: "1700000000000",
  fields: {
    target_user: { user_id: "U1" },
    active: false,
    default_notify_channels: [],
    default_notify_users: [],
    default_registration_notify: "none"
  }
};

const { fetchSlackListItemsMock } = vi.hoisted(() => ({
  fetchSlackListItemsMock: vi.fn(async (_config: unknown, listId: string) => {
    if (listId === "LA") return absenceItems;
    if (listId === "LM") return [...memberItems, duplicateMember];
    return [];
  })
}));

vi.mock("./slack-list-read", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./slack-list-read")>();
  return {
    ...actual,
    getAuthedUserId: vi.fn(async () => "U_BOT"),
    fetchSlackListItems: fetchSlackListItemsMock
  };
});

vi.mock("./list-discovery", () => ({
  createListDiscovery: vi.fn(async () => ({
    findByExactName: () => [],
    findByNamePrefix: () => [],
    listAll: () => []
  }))
}));

import { importFromSlackLists, ImportConflictError } from "./from-slack-lists";
import { createAbsence, countAbsences } from "../db/absence-repository";
import { countMemberMaster } from "../db/member-master-repository";
import { writeImportCompleted } from "../state/kv";

describe("importFromSlackLists", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
  });

  it("imports 9 absences and 12 member_master rows", async () => {
    const kv = createMockKv();
    await kv.put("absence:config:list_id", "LA");
    await kv.put("member_master:config:list_id", "LM");
    const config = createTestConfig(kv);

    const result = await importFromSlackLists(config);

    expect(result.absences).toEqual({ processed: 9, skipped: 0, errors: 0 });
    expect(result.memberMaster).toEqual({ processed: 12, skipped: 0, errors: 0 });
    expect(await countAbsences(config)).toBe(9);
    expect(await countMemberMaster(config)).toBe(12);
  });

  it("rejects when import already completed", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv);
    await writeImportCompleted(config, { absences: { processed: 9 } });

    await expect(importFromSlackLists(config)).rejects.toBeInstanceOf(ImportConflictError);
  });

  it("rejects when d1 is not empty", async () => {
    const kv = createMockKv();
    const config = createTestConfig(kv);
    await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      notifyChannels: ["C1"],
      notifyUsers: [],
      absenceType: "absence"
    });

    await expect(importFromSlackLists(config)).rejects.toBeInstanceOf(ImportConflictError);
  });
});
