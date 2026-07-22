import { describe, expect, it } from "vitest";
import {
  normalizeStatusDefaultTextInput,
  normalizeStatusEmojiInput,
  resolveStatusEmoji,
  resolveStatusText,
  validateStatusDefaultText,
  validateStatusEmoji
} from "./status-profile";

describe("status-profile", () => {
  it("resolves status text with note > user > org priority", () => {
    expect(
      resolveStatusText({
        note: "通院",
        userDefaultText: "休暇",
        orgDefaultText: "不在"
      })
    ).toBe("通院");
    expect(
      resolveStatusText({
        userDefaultText: "休暇",
        orgDefaultText: "不在"
      })
    ).toBe("休暇");
    expect(resolveStatusText({ orgDefaultText: "不在" })).toBe("不在");
  });

  it("resolves status emoji with user > org priority", () => {
    expect(resolveStatusEmoji({ userEmoji: ":beach:", orgEmoji: ":date:" })).toBe(":beach:");
    expect(resolveStatusEmoji({ orgEmoji: ":date:" })).toBe(":date:");
  });

  it("normalizes blank inputs to undefined", () => {
    expect(normalizeStatusDefaultTextInput("   ")).toBeUndefined();
    expect(normalizeStatusEmojiInput("   ")).toBeUndefined();
  });

  it("validates status default text length", () => {
    expect(validateStatusDefaultText("")).toBeUndefined();
    expect(validateStatusDefaultText("a".repeat(100))).toBeUndefined();
    expect(validateStatusDefaultText("a".repeat(101))).toContain("100");
  });

  it("validates status emoji formats", () => {
    expect(validateStatusEmoji("")).toBeUndefined();
    expect(validateStatusEmoji(":date:")).toBeUndefined();
    expect(validateStatusEmoji("🏖️")).toBeUndefined();
    expect(validateStatusEmoji("not-an-emoji")).toContain("絵文字");
  });
});
