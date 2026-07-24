import { describe, expect, it, vi, beforeEach } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import {
  MEMBER_MASTER_MODAL_CALLBACK_ID,
  STATUS_DEFAULT_TEXT_BLOCK_ID,
  STATUS_EMOJI_BLOCK_ID
} from "./member-master-modal";
import { handleSlackInteraction } from "./command";

const { refreshAppHomeAfterMutationMock } = vi.hoisted(() => ({
  refreshAppHomeAfterMutationMock: vi.fn(async () => undefined)
}));

const { reconcileStatusAfterMemberMasterSettingsChangeIsolatedMock } = vi.hoisted(() => ({
  reconcileStatusAfterMemberMasterSettingsChangeIsolatedMock: vi.fn(async () => undefined)
}));

vi.mock("./app-home-publish", () => ({
  publishAppHome: vi.fn(),
  refreshAppHomeAfterMutation: refreshAppHomeAfterMutationMock
}));

vi.mock("../jobs/status-sync", async (importOriginal) => {
  const original = await importOriginal<typeof import("../jobs/status-sync")>();
  return {
    ...original,
    reconcileStatusAfterMemberMasterSettingsChangeIsolated:
      reconcileStatusAfterMemberMasterSettingsChangeIsolatedMock
  };
});

const baseSubmissionValues = {
  active_block: {
    active_checkbox: {
      selected_options: [{ value: "active" }]
    }
  },
  channels_block: {
    default_channels_select: { selected_conversations: [] }
  },
  users_block: {
    default_users_select: { selected_users: [] }
  },
  registration_notify_block: {
    default_registration_notify_select: {
      selected_option: { value: "none" }
    }
  }
};

describe("handleSlackInteraction settings submission", () => {
  beforeEach(() => {
    refreshAppHomeAfterMutationMock.mockClear();
    reconcileStatusAfterMemberMasterSettingsChangeIsolatedMock.mockClear();
  });

  it("refreshes App Home without status reconcile when status prefs are unchanged", async () => {
    const config = createTestConfig(createMockKv());
    const result = await handleSlackInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: MEMBER_MASTER_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({ userId: "U1" }),
        state: { values: baseSubmissionValues }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();
    expect(reconcileStatusAfterMemberMasterSettingsChangeIsolatedMock).not.toHaveBeenCalled();
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(config, "U1");
  });

  it("reconciles status after status prefs change", async () => {
    const config = createTestConfig(createMockKv());
    const result = await handleSlackInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: MEMBER_MASTER_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({ userId: "U1" }),
        state: {
          values: {
            ...baseSubmissionValues,
            [STATUS_DEFAULT_TEXT_BLOCK_ID]: {
              status_default_text_input: { value: "リモート" }
            },
            [STATUS_EMOJI_BLOCK_ID]: {
              status_emoji_input: { value: ":house:" }
            }
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    await result.followUp?.();
    expect(reconcileStatusAfterMemberMasterSettingsChangeIsolatedMock).toHaveBeenCalledWith(config, {
      userId: "U1"
    });
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(config, "U1");
  });
});
