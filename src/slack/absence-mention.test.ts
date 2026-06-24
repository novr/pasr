import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";

const { postEphemeralMock, commitMock, consumeMock } = vi.hoisted(() => ({
  postEphemeralMock: vi.fn(async () => ({})),
  commitMock: vi.fn(async () => ({
    ok: true as const,
    followUp: async () => undefined
  })),
  consumeMock: vi.fn(async () => undefined)
}));

vi.mock("./api", () => ({
  slackApi: {
    postEphemeral: postEphemeralMock
  }
}));

vi.mock("./interaction-message", () => ({
  consumeInteractionMessage: consumeMock
}));

vi.mock("./absence-register-commit", () => ({
  commitAbsenceRegistration: commitMock,
  formatAbsenceRegistrationValidationError: (error: { reason: string }) => error.reason
}));

vi.mock("./member-master-context", () => ({
  resolveMasterContext: vi.fn(async () => ({
    memberMasterListId: "LMM",
    active: true,
    defaultNotifyChannels: ["C_NOTIFY"],
    defaultNotifyUsers: [],
    defaultRegistrationNotify: "none" as const
  }))
}));

vi.mock("../jobs/setup", () => ({
  resolveActiveListIds: vi.fn(async () => ({ absenceListId: "L1", memberMasterListId: "LMM" }))
}));

import {
  ABSENCE_MENTION_CANCEL_ACTION_ID,
  ABSENCE_MENTION_CONFIRM_ACTION_ID,
  handleAbsenceMentionInteraction,
  isMentionAction
} from "./absence-mention";

const baseConfig = {
  stateKv: {} as KVNamespace,
  runEndpointToken: "",
  slackBotToken: "xoxb-test",
  slackSigningSecret: "secret",
  timezone: "Asia/Tokyo",
  adminUserIds: [],
  listAccessChannelIds: []
} satisfies AppConfig;

describe("absence-mention interaction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("isMentionAction detects mention action ids", () => {
    expect(
      isMentionAction({
        type: "block_actions",
        actions: [{ action_id: ABSENCE_MENTION_CONFIRM_ACTION_ID }]
      })
    ).toBe(true);
    expect(
      isMentionAction({
        type: "block_actions",
        actions: [{ action_id: ABSENCE_MENTION_CANCEL_ACTION_ID }]
      })
    ).toBe(true);
    expect(
      isMentionAction({
        type: "block_actions",
        actions: [{ action_id: "pasr_register_open" }]
      })
    ).toBe(false);
  });

  it("handleAbsenceMentionInteraction returns followUp that commits with KV list id", async () => {
    const confirmValue = JSON.stringify({
      v: 1,
      userId: "U1",
      channelId: "C1",
      startDate: "2026-06-25",
      endDate: "2026-06-25",
      note: "通院"
    });

    const result = await handleAbsenceMentionInteraction(baseConfig, {
      type: "block_actions",
      response_url: "https://hooks.slack.com/actions/T1/2/3",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [{ action_id: ABSENCE_MENTION_CONFIRM_ACTION_ID, value: confirmValue }]
    });

    expect(consumeMock).toHaveBeenCalledWith("https://hooks.slack.com/actions/T1/2/3");

    expect(result.ok).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    expect(commitMock).not.toHaveBeenCalled();

    await result.followUp?.();

    expect(commitMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        userId: "U1",
        channelId: "C1",
        absenceListId: "L1",
        startDate: "2026-06-25",
        endDate: "2026-06-25",
        note: "通院"
      })
    );
  });

  it("handleAbsenceMentionInteraction consumes confirm message on cancel", async () => {
    const result = await handleAbsenceMentionInteraction(baseConfig, {
      type: "block_actions",
      response_url: "https://hooks.slack.com/actions/T1/2/3",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [{ action_id: ABSENCE_MENTION_CANCEL_ACTION_ID }]
    });

    expect(result).toEqual({ ok: true });
    expect(consumeMock).toHaveBeenCalledWith("https://hooks.slack.com/actions/T1/2/3");
    expect(postEphemeralMock).not.toHaveBeenCalled();
  });

  it("handleAbsenceMentionInteraction rejects invalid confirm payload", async () => {
    const result = await handleAbsenceMentionInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [
        {
          action_id: ABSENCE_MENTION_CONFIRM_ACTION_ID,
          value: JSON.stringify({
            v: 1,
            userId: "U1",
            channelId: "C1",
            startDate: "2026-99-99",
            endDate: "2026-06-25"
          })
        }
      ]
    });

    expect(result).toEqual({ ok: true });
    expect(commitMock).not.toHaveBeenCalled();
    expect(consumeMock).not.toHaveBeenCalled();
    expect(postEphemeralMock).toHaveBeenCalledWith(
      baseConfig,
      "C1",
      "U1",
      "確認情報の読み取りに失敗しました。もう一度 @PASR で登録してください。"
    );
  });

  it("handleAbsenceMentionInteraction rejects mismatched channelId", async () => {
    const confirmValue = JSON.stringify({
      v: 1,
      userId: "U1",
      channelId: "C_OTHER",
      startDate: "2026-06-25",
      endDate: "2026-06-25"
    });

    const result = await handleAbsenceMentionInteraction(baseConfig, {
      type: "block_actions",
      response_url: "https://hooks.slack.com/actions/T1/2/3",
      user: { id: "U1" },
      channel: { id: "C1" },
      actions: [{ action_id: ABSENCE_MENTION_CONFIRM_ACTION_ID, value: confirmValue }]
    });

    expect(result).toEqual({ ok: true });
    expect(commitMock).not.toHaveBeenCalled();
    expect(consumeMock).not.toHaveBeenCalled();
    expect(postEphemeralMock).toHaveBeenCalledWith(
      baseConfig,
      "C1",
      "U1",
      "確認情報が無効です。もう一度 @PASR で登録してください。"
    );
  });

  it("handleAbsenceMentionInteraction ignores non-mention actions", async () => {
    const result = await handleAbsenceMentionInteraction(baseConfig, {
      type: "block_actions",
      actions: [{ action_id: "pasr_register_open" }]
    });
    expect(result).toEqual({ ok: true });
    expect(commitMock).not.toHaveBeenCalled();
  });
});
