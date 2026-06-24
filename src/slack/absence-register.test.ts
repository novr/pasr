import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { openModalMock, consumeMock } = vi.hoisted(() => ({
  openModalMock: vi.fn(async () => ({})),
  consumeMock: vi.fn(async () => undefined)
}));

vi.mock("./api", () => ({
  slackApi: {
    openModal: openModalMock,
    postEphemeral: vi.fn(async () => ({}))
  }
}));

vi.mock("./interaction-message", () => ({
  consumeInteractionMessage: consumeMock
}));

vi.mock("./member-master-context", () => ({
  resolveMasterContext: vi.fn(async () => ({
    memberMasterListId: "LMM",
    active: true,
    defaultNotifyChannels: [],
    defaultNotifyUsers: [],
    defaultRegistrationNotify: "none" as const
  }))
}));

vi.mock("../jobs/setup", () => ({
  resolveActiveListIds: vi.fn(async () => ({ absenceListId: "L1", memberMasterListId: "LMM" }))
}));

import { handleAbsenceRegisterInteraction } from "./absence-register";
import { buildAbsenceRegisterModalView } from "./absence-register";

const baseConfig = createTestConfig(createMockKv(), { adminUserIds: [] });

describe("buildAbsenceRegisterModalView", () => {
  const baseParams = {
    userId: "U1",
    absenceListId: "L1",
    channelId: "C1",
    defaultNotifyChannels: ["C_NOTIFY"],
    defaultNotifyUsers: ["U2"],
    defaultRegistrationNotify: "none" as const
  };

  it("sets initial dates and note when provided", () => {
    const view = buildAbsenceRegisterModalView({
      ...baseParams,
      initialStartDate: "2026-06-24",
      initialEndDate: "2026-06-24",
      initialNote: "午前通院"
    });
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const startBlock = blocks.find((block) => block.block_id === "start_block");
    const endBlock = blocks.find((block) => block.block_id === "end_block");
    const noteBlock = blocks.find((block) => block.block_id === "note_block");
    expect((startBlock?.element as Record<string, unknown>)?.initial_date).toBe("2026-06-24");
    expect((endBlock?.element as Record<string, unknown>)?.initial_date).toBe("2026-06-24");
    expect((noteBlock?.element as Record<string, unknown>)?.initial_value).toBe("午前通院");
  });

  it("omits initial values when draft is not provided", () => {
    const view = buildAbsenceRegisterModalView(baseParams);
    const blocks = view.blocks as Array<Record<string, unknown>>;
    const startBlock = blocks.find((block) => block.block_id === "start_block");
    const noteBlock = blocks.find((block) => block.block_id === "note_block");
    expect((startBlock?.element as Record<string, unknown>)?.initial_date).toBeUndefined();
    expect((noteBlock?.element as Record<string, unknown>)?.initial_value).toBeUndefined();
  });
});

describe("handleAbsenceRegisterInteraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("consumes mention confirm message when opening modal with draft", async () => {
    const confirmValue = JSON.stringify({
      v: 1,
      userId: "U1",
      channelId: "C1",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午前通院"
    });

    const result = await handleAbsenceRegisterInteraction(baseConfig, {
      type: "block_actions",
      trigger_id: "TR1",
      response_url: "https://hooks.slack.com/actions/T1/2/3",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [{ action_id: "pasr_register_open", value: confirmValue }]
    });

    expect(result).toEqual({ ok: true });
    expect(consumeMock).toHaveBeenCalledWith("https://hooks.slack.com/actions/T1/2/3");
    expect(openModalMock).toHaveBeenCalled();
  });

  it("does not consume message for register button without draft", async () => {
    const result = await handleAbsenceRegisterInteraction(baseConfig, {
      type: "block_actions",
      trigger_id: "TR1",
      response_url: "https://hooks.slack.com/actions/T1/2/3",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [{ action_id: "pasr_register_open" }]
    });

    expect(result).toEqual({ ok: true });
    expect(consumeMock).not.toHaveBeenCalled();
    expect(openModalMock).toHaveBeenCalled();
  });

  it("rejects mention draft with mismatched channelId", async () => {
    const { slackApi } = await import("./api");
    const postEphemeral = vi.mocked(slackApi.postEphemeral);

    const confirmValue = JSON.stringify({
      v: 1,
      userId: "U1",
      channelId: "C_OTHER",
      startDate: "2026-06-24",
      endDate: "2026-06-24",
      note: "午前通院"
    });

    const result = await handleAbsenceRegisterInteraction(baseConfig, {
      type: "block_actions",
      trigger_id: "TR1",
      response_url: "https://hooks.slack.com/actions/T1/2/3",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [{ action_id: "pasr_register_open", value: confirmValue }]
    });

    expect(result).toEqual({ ok: true });
    expect(consumeMock).not.toHaveBeenCalled();
    expect(openModalMock).not.toHaveBeenCalled();
    expect(postEphemeral).toHaveBeenCalledWith(
      baseConfig,
      "C1",
      "U1",
      "確認情報が無効です。もう一度 @PASR で登録してください。"
    );
  });
});
