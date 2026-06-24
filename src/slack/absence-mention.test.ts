import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AppConfig } from "../config";

const { postUserFacingMessageMock, commitMock, consumeMock } = vi.hoisted(() => ({
  postUserFacingMessageMock: vi.fn(async () => undefined),
  commitMock: vi.fn(async () => ({
    ok: true as const,
    followUp: async () => undefined
  })),
  consumeMock: vi.fn(async () => undefined)
}));

vi.mock("./user-message", () => ({
  postUserFacingMessage: postUserFacingMessageMock
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
  handleAppMentionWithText,
  isMentionAction
} from "./absence-mention";
import * as absenceMentionAi from "./absence-mention-ai";
import * as jstDate from "../domain/jst-date";

const baseConfig = {
  stateKv: {} as KVNamespace,
  runEndpointToken: "",
  debugEndpointsEnabled: false,
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
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(baseConfig, {
      channelId: "C1",
      userId: "U1",
      text: "キャンセルしました。"
    });
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
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(baseConfig, {
      channelId: "C1",
      userId: "U1",
      text: "確認情報の読み取りに失敗しました。もう一度 @PASR で登録してください。"
    });
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
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(baseConfig, {
      channelId: "C1",
      userId: "U1",
      text: "確認情報が無効です。もう一度 @PASR で登録してください。"
    });
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

describe("handleAppMentionWithText", () => {
  beforeEach(() => {
    vi.spyOn(jstDate, "getJstDateParts").mockReturnValue({ day: "2026-06-24", hour: 10 });
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("skips progress message on high-confidence infer without AI binding", async () => {
    await handleAppMentionWithText(baseConfig, {
      event: { user: "U1", channel: "C1", text: "<@UBOT> 来週月曜休み" }
    });

    const progressCalls = (postUserFacingMessageMock.mock.calls as unknown[][]).filter(
      (call) => (call[1] as { text?: string })?.text === "不在内容を確認しています…"
    );
    expect(progressCalls).toHaveLength(0);
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "C1",
        userId: "U1",
        text: "不在登録の確認",
        blocks: expect.any(Array)
      })
    );
  });

  it("uses postUserFacingMessage for DM channel confirm UI", async () => {
    await handleAppMentionWithText(baseConfig, {
      event: { user: "U1", channel: "D1", text: "明日 通院" }
    });

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "D1",
        userId: "U1",
        text: "不在登録の確認"
      })
    );
  });

  it("falls back when AI is unavailable and infer is low-confidence", async () => {
    await handleAppMentionWithText(baseConfig, {
      event: { user: "U1", channel: "C1", text: "<@UBOT> 午後から休みます 子供の行事" }
    });

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "C1",
        userId: "U1",
        text: "自動読み取りは利用できません。下のボタンからフォームで登録してください。",
        blocks: expect.any(Array)
      })
    );
  });

  it("skips AI when tomorrow is high-confidence infer", async () => {
    await handleAppMentionWithText(baseConfig, {
      event: { user: "U1", channel: "C1", text: "<@UBOT> 明日 通院" }
    });

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "C1",
        userId: "U1",
        text: "不在登録の確認",
        blocks: expect.any(Array)
      })
    );
  });

  it("falls back when AI run fails", async () => {
    const configWithAi = { ...baseConfig, ai: {} as Ai };
    vi.spyOn(absenceMentionAi, "runAbsenceMentionAi").mockResolvedValueOnce({
      error: new Error("model unavailable")
    });

    await handleAppMentionWithText(configWithAi, {
      event: { user: "U1", channel: "C1", text: "<@UBOT> 午後から休みます 子供の行事" }
    });

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      configWithAi,
      expect.objectContaining({
        channelId: "C1",
        userId: "U1",
        text: "不在内容を読み取れませんでした。下のボタンからフォームで登録してください。",
        blocks: expect.any(Array)
      })
    );
  });
});
