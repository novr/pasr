import { describe, expect, it } from "vitest";
import { toStringValue } from "./slack-list-value";

describe("slack-list-value", () => {
  it("toStringValue reads nested user value", () => {
    expect(toStringValue({ user: [{ id: "U123" }] })).toBe("U123");
  });

  it("toStringValue returns empty string for nullish values", () => {
    expect(toStringValue(null)).toBe("");
    expect(toStringValue([])).toBe("");
  });
});
