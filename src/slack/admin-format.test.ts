import { describe, expect, it, vi } from "vitest";
import { createMockKv, createTestConfig } from "../test/mock-kv";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";

const { postUserFacingMessageMock } = vi.hoisted(() => ({
  postUserFacingMessageMock: vi.fn(async () => undefined)
}));

vi.mock("./user-message", () => ({
  postUserFacingMessage: postUserFacingMessageMock
}));

import {
  ADMIN_EPHEMERAL_TEXT_MAX,
  buildAdminEphemeralBlocks,
  buildAdminEphemeralPostBody,
  deliverAdminEphemeralReply,
  formatAdminEphemeralMessage,
  formatEntityList,
  normalizeAdminEphemeralReply
} from "./admin-format";

describe("formatEntityList", () => {
  it("truncates visible entities", () => {
    expect(formatEntityList(["<#C1>", "<#C2>", "<#C3>"], "なし")).toBe("<#C1> <#C2> 他 1");
  });
});

describe("formatAdminEphemeralMessage", () => {
  it("keeps header and all lines when within limit", () => {
    const text = formatAdminEphemeralMessage("header", ["line1", "line2"], 0);
    expect(text).toBe("header\nline1\nline2");
  });

  it("adds hidden count beyond fetched lines", () => {
    const text = formatAdminEphemeralMessage("header", ["line1"], 3);
    expect(text).toBe("header\nline1\n… 他 3 件");
  });

  it("drops lines to stay within text max", () => {
    const longLine = "x".repeat(ADMIN_EPHEMERAL_TEXT_MAX);
    const text = formatAdminEphemeralMessage("header", [longLine, "line2"], 0);
    expect(text.length).toBeLessThanOrEqual(ADMIN_EPHEMERAL_TEXT_MAX);
    expect(text).not.toContain("line2");
    expect(text).toContain("… 他 2 件");
  });
});

describe("normalizeAdminEphemeralReply", () => {
  it("prepends section when blocks contain actions only", () => {
    const reply = normalizeAdminEphemeralReply({
      text: "list body",
      blocks: [{ type: "actions", elements: [] }]
    });
    expect(reply.blocks?.[0]).toEqual({
      type: "section",
      text: { type: "mrkdwn", text: "list body" }
    });
    expect(reply.blocks?.[1]?.type).toBe("actions");
  });

  it("leaves replies with section unchanged", () => {
    const blocks = [
      { type: "section", text: { type: "mrkdwn", text: "ok" } },
      { type: "actions", elements: [] }
    ];
    const reply = normalizeAdminEphemeralReply({ text: "ok", blocks });
    expect(reply.blocks).toEqual(blocks);
  });
});

describe("buildAdminEphemeralPostBody", () => {
  it("includes section mrkdwn when posting actions-only blocks", () => {
    const body = buildAdminEphemeralPostBody({
      text: "list body",
      blocks: [{ type: "actions", elements: [] }]
    });
    const blocks = body.blocks as Array<{ type: string; text?: { type: string; text: string } }>;
    expect(blocks[0].type).toBe("section");
    expect(blocks[0].text).toEqual({ type: "mrkdwn", text: "list body" });
  });
});

describe("buildAdminEphemeralBlocks", () => {
  it("includes section text when pagination is needed", () => {
    const body = "header\n• <@U1> active";
    const blocks = buildAdminEphemeralBlocks(body, {
      actionId: "pasr_admin_users_page",
      blockId: "pasr_admin_users_pagination",
      page: 1,
      totalPages: 2,
      totalCount: ADMIN_EPHEMERAL_LIST_MAX + 1
    });
    expect(blocks).toBeDefined();
    const section = blocks?.[0] as { type?: string; text?: { text?: string } };
    expect(section.type).toBe("section");
    expect(section.text?.text).toBe(body);
    expect(blocks?.[1]?.type).toBe("actions");
  });

  it("returns undefined for single page", () => {
    expect(
      buildAdminEphemeralBlocks("body", {
        actionId: "action",
        blockId: "block",
        page: 1,
        totalPages: 1,
        totalCount: 1
      })
    ).toBeUndefined();
  });
});

describe("deliverAdminEphemeralReply", () => {
  it("falls back to channel postUserFacingMessage when response_url fails", async () => {
    postUserFacingMessageMock.mockClear();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const config = createTestConfig(createMockKv());

    await deliverAdminEphemeralReply(
      config,
      {
        userId: "U1",
        responseUrl: "https://hooks.slack.com/commands/1/2/3",
        channelId: "C1"
      },
      "fallback body"
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(postUserFacingMessageMock).toHaveBeenCalledWith(config, {
      channelId: "C1",
      userId: "U1",
      text: "fallback body",
      blocks: undefined
    });
    vi.unstubAllGlobals();
  });

  it("falls back to DM chat.postMessage when response_url fails in IM", async () => {
    postUserFacingMessageMock.mockClear();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const config = createTestConfig(createMockKv());

    await deliverAdminEphemeralReply(
      config,
      {
        userId: "U1",
        responseUrl: "https://hooks.slack.com/commands/1/2/3",
        channelId: "D_DM"
      },
      "dm fallback"
    );

    expect(postUserFacingMessageMock).toHaveBeenCalledWith(config, {
      channelId: "D_DM",
      userId: "U1",
      text: "dm fallback",
      blocks: undefined
    });
    vi.unstubAllGlobals();
  });

  it("does not channel-fallback when replace_original fails", async () => {
    postUserFacingMessageMock.mockClear();
    const fetchMock = vi.fn(async () => ({ ok: false, status: 500 }) as Response);
    vi.stubGlobal("fetch", fetchMock);
    const config = createTestConfig(createMockKv());

    await deliverAdminEphemeralReply(
      config,
      {
        userId: "U1",
        responseUrl: "https://hooks.slack.com/actions/T/1/2",
        channelId: "C1",
        replaceOriginal: true
      },
      "page 2"
    );

    expect(fetchMock).toHaveBeenCalled();
    expect(postUserFacingMessageMock).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
  });
});
