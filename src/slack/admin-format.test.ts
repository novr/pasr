import { describe, expect, it } from "vitest";
import { ADMIN_EPHEMERAL_LIST_MAX } from "./admin-constants";
import {
  ADMIN_EPHEMERAL_TEXT_MAX,
  buildAdminEphemeralBlocks,
  formatAdminEphemeralMessage,
  formatEntityList
} from "./admin-format";

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

describe("buildAdminEphemeralBlocks", () => {
  it("includes section text when pagination is needed", () => {
    const body = "header\n• <@U1> active";
    const blocks = buildAdminEphemeralBlocks(
      body,
      "pasr_admin_users_page",
      "pasr_admin_users_pagination",
      1,
      2,
      ADMIN_EPHEMERAL_LIST_MAX + 1
    );
    expect(blocks).toBeDefined();
    const section = blocks?.[0] as { type?: string; text?: { text?: string } };
    expect(section.type).toBe("section");
    expect(section.text?.text).toBe(body);
    expect(blocks?.[1]?.type).toBe("actions");
  });

  it("returns undefined for single page", () => {
    expect(
      buildAdminEphemeralBlocks("body", "action", "block", 1, 1, 1)
    ).toBeUndefined();
  });
});
