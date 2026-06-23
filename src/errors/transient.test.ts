import { describe, expect, it } from "vitest";
import { TransientAdminTaskError, isTransientError } from "./transient";
import { SlackApiError } from "../slack/client";

describe("isTransientError", () => {
  it("returns true for TransientAdminTaskError", () => {
    expect(isTransientError(new TransientAdminTaskError("migration already in progress"))).toBe(true);
  });

  it("returns true for TypeError", () => {
    expect(isTransientError(new TypeError("fetch failed"))).toBe(true);
  });

  it("classifies SlackApiError codes", () => {
    expect(isTransientError(new SlackApiError("chat.postMessage", "rate_limited"))).toBe(true);
    expect(isTransientError(new SlackApiError("chat.postMessage", "invalid_auth"))).toBe(false);
  });

  it("classifies Slack HTTP status messages", () => {
    expect(isTransientError(new Error("Slack API HTTP error (files.list): 429"))).toBe(true);
    expect(isTransientError(new Error("Slack API HTTP error (files.list): 500"))).toBe(true);
    expect(isTransientError(new Error("Slack API HTTP error (files.list): 404"))).toBe(false);
  });

  it("returns false for subrequest limit and unknown values", () => {
    expect(
      isTransientError(
        new Error(
          "Too many subrequests by single Worker invocation. To configure this limit, refer to https://developers.cloudflare.com/workers/wrangler/configuration/#limits"
        )
      )
    ).toBe(false);
    expect(isTransientError("boom")).toBe(false);
  });
});
