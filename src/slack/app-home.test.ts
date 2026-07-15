import { beforeEach, describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import {
  ABSENCE_REGISTER_OPEN_ACTION_ID,
  APP_HOME_LIST_OPEN_ACTION_ID,
  APP_HOME_SETTINGS_OPEN_ACTION_ID
} from "./action-ids";
import { buildAppHomeStaticFallbackBlocks } from "./app-home-blocks";
import { handleAppHomeInteraction, handleAppHomeOpened } from "./app-home";
import { isAppHomeBlockActions } from "./app-home-context";

const { publishAppHomeMock, openDirectMessageMock } = vi.hoisted(() => ({
  publishAppHomeMock: vi.fn(async () => undefined),
  openDirectMessageMock: vi.fn(async () => "D1")
}));

const { openMemberMasterSettingsModalMock } = vi.hoisted(() => ({
  openMemberMasterSettingsModalMock: vi.fn(async () => undefined)
}));

const { showOwnAbsenceListMock } = vi.hoisted(() => ({
  showOwnAbsenceListMock: vi.fn(async () => undefined)
}));

const { postUserFacingMessageMock } = vi.hoisted(() => ({
  postUserFacingMessageMock: vi.fn(async () => undefined)
}));

vi.mock("./app-home-publish", () => ({
  publishAppHome: publishAppHomeMock
}));

vi.mock("./api", () => ({
  slackApi: {
    openDirectMessage: openDirectMessageMock
  }
}));

vi.mock("./member-master-modal", () => ({
  openMemberMasterSettingsModal: openMemberMasterSettingsModalMock
}));

vi.mock("./absence-list", () => ({
  showOwnAbsenceList: showOwnAbsenceListMock
}));

vi.mock("./user-message", () => ({
  postUserFacingMessage: postUserFacingMessageMock
}));

const baseConfig = createTestConfig(createMockKv(), { adminUserIds: [] });

const collectActionIds = (blocks: Array<Record<string, unknown>>): string[] => {
  const ids: string[] = [];
  for (const block of blocks) {
    const elements = block.elements;
    if (!Array.isArray(elements)) continue;
    for (const element of elements) {
      const actionId = (element as { action_id?: string }).action_id;
      if (actionId) ids.push(actionId);
    }
  }
  return ids;
};

describe("buildAppHomeStaticFallbackBlocks", () => {
  it("includes register, settings, and list action ids", () => {
    const actionIds = collectActionIds(buildAppHomeStaticFallbackBlocks());
    expect(actionIds).toEqual([
      ABSENCE_REGISTER_OPEN_ACTION_ID,
      APP_HOME_SETTINGS_OPEN_ACTION_ID,
      APP_HOME_LIST_OPEN_ACTION_ID
    ]);
  });
});

describe("isAppHomeBlockActions", () => {
  it("detects home tab block actions", () => {
    expect(
      isAppHomeBlockActions({
        type: "block_actions",
        container: { type: "view" },
        view: { type: "home" }
      })
    ).toBe(true);
    expect(
      isAppHomeBlockActions({
        type: "block_actions",
        container: { type: "message" }
      })
    ).toBe(false);
  });
});

describe("handleAppHomeOpened", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("publishes home view for home tab", async () => {
    await handleAppHomeOpened(baseConfig, {
      event_id: "E1",
      team_id: "T1",
      event: { type: "app_home_opened", user: "U1", tab: "home" }
    });

    expect(publishAppHomeMock).toHaveBeenCalledWith(baseConfig, "U1", "");
  });

  it("forwards publicBaseUrl to publishAppHome", async () => {
    await handleAppHomeOpened(
      baseConfig,
      {
        event_id: "E1",
        team_id: "T1",
        event: { type: "app_home_opened", user: "U1", tab: "home" }
      },
      "https://worker.example"
    );

    expect(publishAppHomeMock).toHaveBeenCalledWith(baseConfig, "U1", "https://worker.example");
  });

  it("ignores non-home tabs", async () => {
    await handleAppHomeOpened(baseConfig, {
      event: { type: "app_home_opened", user: "U1", tab: "messages" }
    });

    expect(publishAppHomeMock).not.toHaveBeenCalled();
  });

  it("notifies user when publish fails", async () => {
    publishAppHomeMock.mockRejectedValueOnce(new Error("publish failed"));

    await handleAppHomeOpened(baseConfig, {
      event_id: "E2",
      event: { type: "app_home_opened", user: "U1", tab: "home", channel: "D1" }
    });

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "D1",
        userId: "U1",
        text: expect.stringContaining("ホーム画面")
      })
    );
  });
});

describe("handleAppHomeInteraction", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("opens settings modal for settings button", async () => {
    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      trigger_id: "TRIG1",
      user: { id: "U1" },
      actions: [{ action_id: APP_HOME_SETTINGS_OPEN_ACTION_ID }]
    });

    expect(result).toEqual({ handled: true, ok: true });
    expect(openMemberMasterSettingsModalMock).toHaveBeenCalledWith(baseConfig, {
      triggerId: "TRIG1",
      userId: "U1"
    });
  });

  it("notifies user when settings modal cannot open", async () => {
    openMemberMasterSettingsModalMock.mockRejectedValueOnce(new Error("modal failed"));

    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      trigger_id: "TRIG1",
      user: { id: "U1" },
      channel: { id: "D1" },
      actions: [{ action_id: APP_HOME_SETTINGS_OPEN_ACTION_ID }]
    });

    expect(result).toEqual({ handled: true, ok: true });
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "D1",
        userId: "U1",
        text: expect.stringContaining("設定フォーム")
      })
    );
  });

  it("notifies user when trigger_id is missing for settings", async () => {
    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      channel: { id: "D1" },
      actions: [{ action_id: APP_HOME_SETTINGS_OPEN_ACTION_ID }]
    });

    expect(result).toEqual({ handled: true, ok: true });
    expect(openMemberMasterSettingsModalMock).not.toHaveBeenCalled();
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "D1",
        userId: "U1",
        text: expect.stringContaining("設定フォーム")
      })
    );
  });

  it("returns followUp that shows absence list", async () => {
    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      channel: { id: "D1" },
      response_url: "https://hooks.slack.com/actions/T/1/2",
      actions: [{ action_id: APP_HOME_LIST_OPEN_ACTION_ID }]
    });

    expect(result.handled).toBe(true);
    expect(result.followUp).toBeTypeOf("function");
    await result.followUp?.();

    expect(showOwnAbsenceListMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        userId: "U1",
        channelId: "D1",
        responseUrl: "https://hooks.slack.com/actions/T/1/2"
      }),
      { includeEdit: true }
    );
  });

  it("resolves DM channel when App Home list payload has no channel", async () => {
    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      actions: [{ action_id: APP_HOME_LIST_OPEN_ACTION_ID }]
    });

    expect(result.handled).toBe(true);
    await result.followUp?.();

    expect(openDirectMessageMock).toHaveBeenCalledWith(baseConfig, "U1");
    expect(showOwnAbsenceListMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        userId: "U1",
        channelId: "D1",
        responseUrl: ""
      }),
      { includeEdit: true }
    );
  });

  it("notifies user when list followUp fails", async () => {
    showOwnAbsenceListMock.mockRejectedValueOnce(new Error("list failed"));

    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      actions: [{ action_id: APP_HOME_LIST_OPEN_ACTION_ID }]
    });

    await result.followUp?.();

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(
      baseConfig,
      expect.objectContaining({
        channelId: "D1",
        userId: "U1",
        text: expect.stringContaining("不在予定一覧")
      })
    );
  });

  it("notifies user when DM channel cannot be resolved for list", async () => {
    openDirectMessageMock.mockRejectedValue(new Error("dm failed"));

    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      user: { id: "U1" },
      actions: [{ action_id: APP_HOME_LIST_OPEN_ACTION_ID }]
    });

    await result.followUp?.();

    expect(showOwnAbsenceListMock).not.toHaveBeenCalled();
    expect(postUserFacingMessageMock).not.toHaveBeenCalled();
  });

  it("ignores unrelated actions", async () => {
    const result = await handleAppHomeInteraction(baseConfig, {
      type: "block_actions",
      actions: [{ action_id: "other_action" }]
    });

    expect(result).toEqual({ handled: false, ok: true });
  });
});
