import { describe, expect, it } from "vitest";
import { pickListField, toBooleanValue, toStringArray, toStringValue } from "./slack-list-value";

describe("slack-list-value", () => {
  it("toStringValue reads nested user value", () => {
    expect(toStringValue({ user: [{ id: "U123" }] })).toBe("U123");
  });

  it("toStringValue returns empty string for nullish values", () => {
    expect(toStringValue(null)).toBe("");
    expect(toStringValue([])).toBe("");
  });

  it("toBooleanValue parses string booleans", () => {
    expect(toBooleanValue("true")).toBe(true);
    expect(toBooleanValue("false")).toBe(false);
    expect(toBooleanValue("maybe")).toBeUndefined();
  });

  it("toStringArray reads selected_conversations", () => {
    expect(toStringArray({ selected_conversations: ["C1", "C2"] })).toEqual(["C1", "C2"]);
  });

  it("pickListField reads from fields array and values map", () => {
    expect(
      pickListField({ fields: [{ key: "target_user", user: ["U1"] }] }, "target_user")
    ).toEqual({ key: "target_user", user: ["U1"] });
    expect(pickListField({ values: { target_user: "U2" } }, "target_user")).toBe("U2");
  });
});
