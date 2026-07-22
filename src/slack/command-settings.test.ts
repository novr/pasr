import { describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { MEMBER_MASTER_MODAL_CALLBACK_ID } from "./member-master-modal";
import { handleSlackInteraction } from "./command";

const { refreshAppHomeAfterMutationMock } = vi.hoisted(() => ({
  refreshAppHomeAfterMutationMock: vi.fn(async () => undefined)
}));

vi.mock("./app-home-publish", () => ({
  publishAppHome: vi.fn(),
  refreshAppHomeAfterMutation: refreshAppHomeAfterMutationMock
}));

describe("handleSlackInteraction settings submission", () => {
  it("refreshes App Home after member master save", async () => {
    const config = createTestConfig(createMockKv());
    const result = await handleSlackInteraction(config, {
      type: "view_submission",
      user: { id: "U1" },
      view: {
        callback_id: MEMBER_MASTER_MODAL_CALLBACK_ID,
        private_metadata: JSON.stringify({ userId: "U1" }),
        state: {
          values: {
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
          }
        }
      }
    });

    expect(result.ok).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();
    expect(refreshAppHomeAfterMutationMock).toHaveBeenCalledWith(config, "U1");
  });
});
