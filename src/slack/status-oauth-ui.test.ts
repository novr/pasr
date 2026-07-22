import { describe, expect, it } from "vitest";
import { buildStatusOAuthEphemeralText, STATUS_OAUTH_NOTICE_TEXT } from "./status-oauth-ui";

describe("buildStatusOAuthEphemeralText", () => {
  it("describes detail-first status resolution in the OAuth notice", () => {
    expect(STATUS_OAUTH_NOTICE_TEXT).toContain("詳細");
    expect(STATUS_OAUTH_NOTICE_TEXT).toContain("デフォルト");
    expect(buildStatusOAuthEphemeralText({ linked: false, startUrl: "https://example/oauth" })).toContain(
      "Slack Status を連携"
    );
  });
});
