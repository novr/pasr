import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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

describe("handleAbsenceEditInteraction from app home", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-09-15T00:30:00+09:00"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("stores fromAppHome in modal metadata", async () => {
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
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

    await handleAbsenceEditInteraction(config, {
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
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
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

    const result = await handleAbsenceEditInteraction(config, {
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

    const updated = await getAbsenceById(config, created.itemId);
    expect(updated?.startDate).toBe("2026-10-03");
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(config, "U1");
  });

  it("keeps stored times when the submission omits the time fields", async () => {
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-10-02",
      endDate: "2026-10-04",
      startTime: "18:00",
      endTime: "13:00",
      notifyChannels: ["C1"],
      notifyUsers: ["U2"]
    });
    const view = buildAbsenceEditModalView({
      userId: "U1",
      record: created,
      fromAppHome: true
    });
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const startTimeBlock = blocks.find((block) => block.block_id === "start_time_block");
    const endTimeBlock = blocks.find((block) => block.block_id === "end_time_block");
    expect((startTimeBlock?.element as Record<string, unknown>)?.initial_time).toBe("18:00");
    expect((endTimeBlock?.element as Record<string, unknown>)?.initial_time).toBe("13:00");

    const result = await handleAbsenceEditInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_EDIT_MODAL_CALLBACK_ID,
        private_metadata: view.private_metadata as string,
        state: {
          values: {
            start_block: { start_date: { selected_date: "2026-10-02" } },
            end_block: { end_date: { selected_date: "2026-10-04" } },
            note_block: { note_input: { value: "通院" } },
            channels_block: { notify_channels_select: { selected_conversations: ["C1"] } },
            users_block: { notify_users_select: { selected_users: ["U2"] } }
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    const updated = await getAbsenceById(config, created.itemId);
    expect(updated?.startTime).toBe("18:00");
    expect(updated?.endTime).toBe("13:00");
    expect(updated?.note).toBe("通院");
  });

  it("does not save when omitted times become inverted on the same day", async () => {
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-10-02",
      endDate: "2026-10-04",
      startTime: "18:00",
      endTime: "13:00",
      notifyChannels: ["C1"],
      notifyUsers: ["U2"]
    });
    const view = buildAbsenceEditModalView({ userId: "U1", record: created });

    const result = await handleAbsenceEditInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_EDIT_MODAL_CALLBACK_ID,
        private_metadata: view.private_metadata as string,
        state: {
          values: {
            start_block: { start_date: { selected_date: "2026-10-02" } },
            end_block: { end_date: { selected_date: "2026-10-02" } },
            note_block: { note_input: { value: "" } },
            channels_block: { notify_channels_select: { selected_conversations: ["C1"] } },
            users_block: { notify_users_select: { selected_users: ["U2"] } }
          }
        }
      }
    });

    expect(result.ok).toBe(false);
    expect(result.error).toContain("終了日を翌日");
    const stored = await getAbsenceById(config, created.itemId);
    expect(stored?.endDate).toBe("2026-10-04");
    expect(stored?.startTime).toBe("18:00");
  });

  it("clears a time when the timepicker submits null", async () => {
    const config = createTestConfig(createMockKv());
    const created = await createAbsence(config, {
      targetUser: "U1",
      startDate: "2026-10-02",
      endDate: "2026-10-02",
      startTime: "13:00",
      endTime: "16:00",
      notifyChannels: ["C1"],
      notifyUsers: ["U2"]
    });
    const view = buildAbsenceEditModalView({ userId: "U1", record: created });

    const result = await handleAbsenceEditInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: ABSENCE_EDIT_MODAL_CALLBACK_ID,
        private_metadata: view.private_metadata as string,
        state: {
          values: {
            start_block: { start_date: { selected_date: "2026-10-02" } },
            end_block: { end_date: { selected_date: "2026-10-02" } },
            start_time_block: { start_time: { selected_time: null } },
            end_time_block: { end_time: { selected_time: "16:00" } },
            note_block: { note_input: { value: "" } },
            channels_block: { notify_channels_select: { selected_conversations: ["C1"] } },
            users_block: { notify_users_select: { selected_users: ["U2"] } }
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    const updated = await getAbsenceById(config, created.itemId);
    expect(updated?.startTime).toBeUndefined();
    expect(updated?.endTime).toBe("16:00");
  });
});
