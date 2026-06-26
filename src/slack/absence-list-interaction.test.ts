import { beforeEach, describe, expect, it, vi } from "vitest";
import { createAbsence, getAbsenceById } from "../db/absence-repository";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { ABSENCE_DELETE_ACTION_ID } from "./absence-list-blocks";
import { handleAbsenceListInteraction } from "./absence-list";

const { refreshAppHomeAfterMutationMock } = vi.hoisted(() => ({
  refreshAppHomeAfterMutationMock: vi.fn(async () => undefined)
}));

vi.mock("./app-home-publish", () => ({
  refreshAppHomeAfterMutation: refreshAppHomeAfterMutationMock
}));

const baseConfig = createTestConfig(createMockKv());

describe("handleAbsenceListInteraction home refresh", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    global.fetch = vi.fn(async () => new Response("", { status: 200 })) as typeof fetch;
  });

  it("refreshes app home after delete from home tab", async () => {
    const created = await createAbsence(baseConfig, {
      targetUser: "U1",
      startDate: "2026-09-01",
      endDate: "2026-09-01",
      notifyChannels: ["C1"],
      notifyUsers: []
    });

    const result = await handleAbsenceListInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      response_url: "https://hooks.slack.com/actions/T/1/2",
      container: { type: "view" },
      view: { type: "home" },
      actions: [{ action_id: ABSENCE_DELETE_ACTION_ID, value: created.itemId }]
    });

    await result.followUp?.();

    expect(await getAbsenceById(baseConfig, created.itemId)).toBeUndefined();
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(baseConfig, "U1");
    expect(global.fetch).not.toHaveBeenCalled();
  });

  it("reloads ephemeral list after delete outside home", async () => {
    const created = await createAbsence(baseConfig, {
      targetUser: "U1",
      startDate: "2026-09-02",
      endDate: "2026-09-02",
      notifyChannels: ["C1"],
      notifyUsers: []
    });

    const result = await handleAbsenceListInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      response_url: "https://hooks.slack.com/actions/T/1/2",
      container: { type: "message" },
      actions: [{ action_id: ABSENCE_DELETE_ACTION_ID, value: created.itemId }]
    });

    await result.followUp?.();

    expect(refreshAppHomeAfterMutationMock).not.toHaveBeenCalled();
    expect(global.fetch).toHaveBeenCalled();
  });
});
