import { describe, expect, it } from "vitest";
import { escapeSlackCodeBlock, extractBuildError, getBuildStatus, isPasrBuildEvent } from "./helpers";
import { PASR_WORKER_NAME, type CloudflareEvent } from "./types";

const baseEvent = (overrides?: Partial<CloudflareEvent>): CloudflareEvent => ({
  type: "cf.workersBuilds.worker.build.succeeded",
  source: { type: "workersBuilds.worker", workerName: PASR_WORKER_NAME },
  payload: {
    buildUuid: "build-1",
    status: "stopped",
    buildOutcome: "success",
    createdAt: "2026-08-07T00:00:00.000Z",
    buildTriggerMetadata: {
      branch: "main",
      commitHash: "abc123456789",
      commitMessage: "Fix deploy",
      author: "dev@example.com",
      repoName: "pasr",
      providerAccountName: "novr",
      providerType: "github"
    }
  },
  metadata: {
    accountId: "acct",
    eventTimestamp: "2026-08-07T00:00:00.000Z"
  },
  ...overrides
});

describe("isPasrBuildEvent", () => {
  it("accepts pasr-absence-notifier builds", () => {
    expect(isPasrBuildEvent(baseEvent())).toBe(true);
  });

  it("rejects other workers", () => {
    const event = baseEvent();
    event.source.workerName = "other-worker";
    expect(isPasrBuildEvent(event)).toBe(false);
  });
});

describe("getBuildStatus", () => {
  it("detects failed builds", () => {
    const status = getBuildStatus(
      baseEvent({ type: "cf.workersBuilds.worker.build.failed", payload: {
        buildUuid: "build-1",
        status: "stopped",
        buildOutcome: "failure",
        createdAt: "2026-08-07T00:00:00.000Z"
      } })
    );
    expect(status.isFailed).toBe(true);
    expect(status.isSucceeded).toBe(false);
  });
});

describe("extractBuildError", () => {
  it("returns the first error line from logs", () => {
    expect(
      extractBuildError([
        "Installing dependencies",
        "✘ [ERROR] Build failed: module not found",
        "at build.js:1"
      ])
    ).toBe("✘ [ERROR] Build failed: module not found");
  });
});

describe("escapeSlackCodeBlock", () => {
  it("escapes triple backticks", () => {
    expect(escapeSlackCodeBlock("line with ``` fence")).toBe("line with ''' fence");
  });
});
