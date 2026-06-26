import { describe, expect, it, vi } from "vitest";
import { createAbsence, getAbsenceById } from "../db/absence-repository";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import {
  ABSENCE_EDIT_MODAL_CALLBACK_ID,
  buildAbsenceEditModalView,
  handleAbsenceEditInteraction
} from "./absence-edit";
import { ABSENCE_EDIT_OPEN_ACTION_ID } from "./absence-list-blocks";

const { refreshAppHomeAfterMutationMock, openModalMock } = vi.hoisted(() => ({
  refreshAppHomeAfterMutationMock: vi.fn(async () => undefined),
  openModalMock: vi.fn(async () => ({}))
}));

vi.mock("./app-home-publish", () => ({
  refreshAppHomeAfterMutation: refreshAppHomeAfterMutationMock
}));

vi.mock("./api", () => ({
  slackApi: {
    openModal: openModalMock
  }
}));

vi.mock("./member-master-context", () => ({
  resolveMasterContext: vi.fn(async () => ({
    active: true,
    defaultNotifyChannels: ["C1"],
    defaultNotifyUsers: [],
    defaultRegistrationNotify: "none" as const
  }))
}));

const baseConfig = createTestConfig(createMockKv());

describe("handleAbsenceEditInteraction from app home", () => {
  it("stores fromAppHome in modal metadata", async () => {
    const created = await createAbsence(baseConfig, {
      targetUser: "U1",
      startDate: "2026-10-01",
      endDate: "2026-10-01",
      notifyChannels: ["C1"],
      notifyUsers: []
    });

    const view = buildAbsenceEditModalView({
      userId: "U1",
      record: created,
      fromAppHome: true
    });
    const metadata = JSON.parse(String(view.private_metadata)) as { fromAppHome?: boolean };
    expect(metadata.fromAppHome).toBe(true);

    await handleAbsenceEditInteraction(baseConfig, {
      type: "block_actions",
      trigger_id: "TRIG1",
      user: { id: "U1" },
      container: { type: "view" },
      view: { type: "home" },
      actions: [{ action_id: ABSENCE_EDIT_OPEN_ACTION_ID, value: created.itemId }]
    });

    expect(openModalMock).toHaveBeenCalled();
  });

  it("returns followUp to refresh home after successful submission", async () => {
    const created = await createAbsence(baseConfig, {
      targetUser: "U1",
      startDate: "2026-10-02",
      endDate: "2026-10-02",
      notifyChannels: ["C1"],
      notifyUsers: ["U2"]
    });

    const view = buildAbsenceEditModalView({
      userId: "U1",
      record: created,
      fromAppHome: true
    });

    const result = await handleAbsenceEditInteraction(baseConfig, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_EDIT_MODAL_CALLBACK_ID,
        private_metadata: view.private_metadata as string,
        state: {
          values: {
            start_block: { start_date: { selected_date: "2026-10-03" } },
            end_block: { end_date: { selected_date: "2026-10-03" } },
            note_block: { note_input: { value: "updated" } },
            channels_block: { notify_channels_select: { selected_conversations: ["C1"] } },
            users_block: { notify_users_select: { selected_users: ["U2"] } }
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();

    const updated = await getAbsenceById(baseConfig, created.itemId);
    expect(updated?.startDate).toBe("2026-10-03");
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(baseConfig, "U1");
  });
});
