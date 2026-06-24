import { describe, expect, it } from "vitest";
import {
  buildQueuedAdminAck,
  buildQueuedSelfAck,
  isSlackAdminUser,
  parseSelfCommandText,
  parseSlackCommandAction,
  parseSlackCommandPayload
} from "./command";
import type { AppConfig } from "../config";

const config: AppConfig = {
  stateKv: {} as KVNamespace,
  runEndpointToken: "",
  debugEndpointsEnabled: false,
  slackBotToken: "xoxb-test",
  slackSigningSecret: "secret",
  timezone: "Asia/Tokyo",
  adminUserIds: ["U_ADMIN"],
  listAccessChannelIds: []
};

describe("slash command parsers", () => {
  it("parseSlackCommandPayload returns payload when required fields exist", () => {
    const body = new URLSearchParams({
      command: "/pasr-admin",
      text: "run",
      user_id: "U1",
      team_id: "T1",
      channel_id: "C1",
      trigger_id: "tr1",
      response_url: "https://hooks.slack.com/commands/1/2/3"
    }).toString();
    expect(parseSlackCommandPayload(body)).toEqual({
      command: "/pasr-admin",
      text: "run",
      userId: "U1",
      teamId: "T1",
      channelId: "C1",
      triggerId: "tr1",
      responseUrl: "https://hooks.slack.com/commands/1/2/3"
    });
  });

  it("parseSlackCommandPayload returns undefined when trigger_id is missing", () => {
    const body = new URLSearchParams({
      command: "/pasr-admin",
      user_id: "U1",
      team_id: "T1"
    }).toString();
    expect(parseSlackCommandPayload(body)).toBeUndefined();
  });

  it("parseSlackCommandAction defaults to help for empty text", () => {
    expect(parseSlackCommandAction("")).toBe("help");
    expect(parseSlackCommandAction("migrate extra")).toBe("migrate");
  });

  it("buildQueuedAdminAck returns action-specific messages", () => {
    expect(buildQueuedAdminAck("run")).toContain("通知処理");
    expect(buildQueuedAdminAck("migrate")).toContain("migrate");
    expect(buildQueuedAdminAck("prune")).toContain("prune");
    expect(buildQueuedAdminAck("unknown")).toContain("処理を実行中");
  });

  it("buildQueuedSelfAck returns list message", () => {
    expect(buildQueuedSelfAck()).toContain("一覧");
  });

  it("parseSelfCommandText parses list settings update date and item id", () => {
    expect(parseSelfCommandText("list")).toEqual({ kind: "list" });
    expect(parseSelfCommandText("settings")).toEqual({ kind: "settings" });
    expect(parseSelfCommandText("update")).toEqual({ kind: "update_list" });
    expect(parseSelfCommandText("update 2026-06-10")).toEqual({ kind: "update_date", startDate: "2026-06-10" });
    expect(parseSelfCommandText("update Rec0123ABC")).toEqual({ kind: "update_item", itemId: "Rec0123ABC" });
    expect(parseSelfCommandText("update bad-date")).toEqual({ kind: "update_item", itemId: "bad-date" });
    expect(parseSelfCommandText("update 2026-13-40")).toEqual({ kind: "update_invalid_date" });
  });

  it("isSlackAdminUser checks allowlist", () => {
    expect(isSlackAdminUser(config, "U_ADMIN")).toBe(true);
    expect(isSlackAdminUser(config, "U_OTHER")).toBe(false);
  });
});
