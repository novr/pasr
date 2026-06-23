import { describe, expect, it } from "vitest";
import { isSkippableSlackLookupError, SlackApiError } from "./client";

describe("isSkippableSlackLookupError", () => {
  it("returns true for skippable Slack API errors", () => {
    expect(isSkippableSlackLookupError(new SlackApiError("files.list", "missing_scope"))).toBe(true);
    expect(isSkippableSlackLookupError(new SlackApiError("files.list", "unknown_method"))).toBe(true);
  });

  it("returns false for non-skippable errors", () => {
    expect(isSkippableSlackLookupError(new SlackApiError("files.list", "invalid_auth"))).toBe(false);
    expect(isSkippableSlackLookupError(new Error("other"))).toBe(false);
  });
});
