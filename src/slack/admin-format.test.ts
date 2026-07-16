import { describe, expect, it } from "vitest";
import { ADMIN_EPHEMERAL_TEXT_MAX, formatAdminEphemeralMessage, formatEntityList } from "./admin-format";

describe("formatEntityList", () => {
  it("truncates visible entities", () => {
    expect(formatEntityList(["<#C1>", "<#C2>", "<#C3>"], "なし")).toBe("<#C1> <#C2> 他 1");
  });
});

describe("formatAdminEphemeralMessage", () => {
  it("keeps header and all lines when within limit", () => {
    const text = formatAdminEphemeralMessage("header", ["line1", "line2"], 0);
    expect(text).toBe("header\nline1\nline2");
  });

  it("adds hidden count beyond fetched lines", () => {
    const text = formatAdminEphemeralMessage("header", ["line1"], 3);
    expect(text).toBe("header\nline1\n… 他 3 件");
  });

  it("drops lines to stay within text max", () => {
    const longLine = "x".repeat(ADMIN_EPHEMERAL_TEXT_MAX);
    const text = formatAdminEphemeralMessage("header", [longLine, "line2"], 0);
    expect(text.length).toBeLessThanOrEqual(ADMIN_EPHEMERAL_TEXT_MAX);
    expect(text).not.toContain("line2");
    expect(text).toContain("… 他 2 件");
  });
});
