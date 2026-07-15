import { describe, expect, it, vi } from "vitest";
import { buildOpsReportText, postOpsReport } from "./ops-report";
import { createMockKv, createTestConfig } from "../test/mock-kv";

const { postChannelMessageMock } = vi.hoisted(() => ({
  postChannelMessageMock: vi.fn(async () => ({ ok: true, ts: "123.456" }))
}));

vi.mock("../slack/api", () => ({
  slackApi: {
    postChannelMessage: postChannelMessageMock
  }
}));

describe("buildOpsReportText", () => {
  it("formats scheduled daily summary", () => {
    const text = buildOpsReportText(
      {
        runId: "run_1",
        trigger: "scheduled",
        day: "2026-06-24",
        todayAbsenceCount: 3,
        processed: 10,
        sent: 4,
        skipped: 1,
        errors: 0,
        deleted: 2,
        skipReasons: {
          missing_target_user: 0,
          missing_start_date: 0,
          missing_notify_channels: 1,
          invalid_date_range: 0,
          inactive_user_master: 0
        }
      },
      14,
      12
    );
    expect(text).toContain("本日の不在: 3件");
    expect(text).toContain("active 12 / 全 14");
    expect(text).toContain("missing_notify_channels=1");
  });

  it("includes status line when provided", () => {
    const text = buildOpsReportText(
      {
        runId: "run_1",
        trigger: "scheduled",
        day: "2026-06-24",
        todayAbsenceCount: 1,
        processed: 1,
        sent: 1,
        skipped: 0,
        errors: 0,
        deleted: 0,
        skipReasons: {
          missing_target_user: 0,
          missing_start_date: 0,
          missing_notify_channels: 0,
          invalid_date_range: 0,
          inactive_user_master: 0
        },
        statusSet: 2,
        statusSkipped: 1,
        statusErrors: 0
      },
      5,
      4
    );
    expect(text).toContain("status: set=2 skipped=1 errors=0");
  });

  it("omits status line when status fields are not provided", () => {
    const text = buildOpsReportText(
      {
        runId: "run_1",
        trigger: "scheduled",
        day: "2026-06-24",
        todayAbsenceCount: 0,
        processed: 0,
        sent: 0,
        skipped: 0,
        errors: 0,
        deleted: 0,
        skipReasons: {
          missing_target_user: 0,
          missing_start_date: 0,
          missing_notify_channels: 0,
          invalid_date_range: 0,
          inactive_user_master: 0
        }
      },
      1,
      1
    );
    expect(text).not.toContain("status:");
  });
});

describe("postOpsReport", () => {
  it("skips manual trigger and missing channel", async () => {
    const config = createTestConfig(createMockKv(), { opsChannelId: "C_OPS" });
    const input = {
      runId: "run_1",
      trigger: "manual" as const,
      day: "2026-06-24",
      todayAbsenceCount: 1,
      processed: 1,
      sent: 1,
      skipped: 0,
      errors: 0,
      deleted: 0,
      skipReasons: {
        missing_target_user: 0,
        missing_start_date: 0,
        missing_notify_channels: 0,
        invalid_date_range: 0,
        inactive_user_master: 0
      }
    };
    expect(await postOpsReport(config, input)).toEqual({ posted: false, errors: 0 });
    expect(postChannelMessageMock).not.toHaveBeenCalled();

    postChannelMessageMock.mockClear();
    const noChannel = createTestConfig(createMockKv(), { opsChannelId: "" });
    expect(await postOpsReport(noChannel, { ...input, trigger: "scheduled" })).toEqual({
      posted: false,
      errors: 0
    });
    expect(postChannelMessageMock).not.toHaveBeenCalled();
  });

  it("isolates post failure", async () => {
    postChannelMessageMock.mockRejectedValueOnce(new Error("not_in_channel"));
    const config = createTestConfig(createMockKv(), { opsChannelId: "C_OPS" });
    const result = await postOpsReport(config, {
      runId: "run_2",
      trigger: "scheduled",
      day: "2026-06-24",
      todayAbsenceCount: 0,
      processed: 0,
      sent: 0,
      skipped: 0,
      errors: 0,
      deleted: 0,
      skipReasons: {
        missing_target_user: 0,
        missing_start_date: 0,
        missing_notify_channels: 0,
        invalid_date_range: 0,
        inactive_user_master: 0
      }
    });
    expect(result).toEqual({ posted: false, errors: 1 });
  });
});
