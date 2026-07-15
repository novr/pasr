import { describe, expect, it } from "vitest";
import { truncateStatusText, STATUS_TEXT_MAX_LEN } from "./status-text";

describe("truncateStatusText", () => {
  it("returns short text unchanged", () => {
    expect(truncateStatusText("午前通院")).toBe("午前通院");
  });

  it("truncates long text with ellipsis", () => {
    const long = "あ".repeat(STATUS_TEXT_MAX_LEN + 10);
    const result = truncateStatusText(long);
    expect(result.length).toBe(STATUS_TEXT_MAX_LEN);
    expect(result.endsWith("…")).toBe(true);
  });
});
