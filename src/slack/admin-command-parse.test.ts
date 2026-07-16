import { describe, expect, it } from "vitest";
import { parseAbsencesCommand, parseChannelConfigCommand, parseUsersCommand } from "./admin-command-parse";

describe("parseChannelConfigCommand", () => {
  it("parses empty on off default", () => {
    expect(parseChannelConfigCommand("channel-config empty on")).toEqual({ kind: "empty", value: "on" });
    expect(parseChannelConfigCommand("channel-config empty off")).toEqual({ kind: "empty", value: "off" });
    expect(parseChannelConfigCommand("channel-config empty default")).toEqual({
      kind: "empty",
      value: "default"
    });
  });

  it("parses list", () => {
    expect(parseChannelConfigCommand("channel-config list")).toEqual({ kind: "list" });
  });

  it("returns undefined for other admin actions", () => {
    expect(parseChannelConfigCommand("run")).toBeUndefined();
    expect(parseChannelConfigCommand("status")).toBeUndefined();
  });

  it("returns invalid for malformed input", () => {
    const result = parseChannelConfigCommand("channel-config empty maybe");
    expect(result?.kind).toBe("invalid");
  });
});

describe("parseUsersCommand", () => {
  it("parses flat users command as page 1", () => {
    expect(parseUsersCommand("users")).toEqual({ kind: "list", page: 1 });
  });

  it("parses page number", () => {
    expect(parseUsersCommand("users 2")).toEqual({ kind: "list", page: 2 });
    expect(parseUsersCommand("users page 3")).toEqual({ kind: "list", page: 3 });
  });

  it("rejects invalid page tokens", () => {
    const result = parseUsersCommand("users list");
    expect(result?.kind).toBe("invalid");
  });
});

describe("parseAbsencesCommand", () => {
  it("defaults to today page 1", () => {
    expect(parseAbsencesCommand("absences")).toEqual({ kind: "today", page: 1 });
    expect(parseAbsencesCommand("absences today")).toEqual({ kind: "today", page: 1 });
  });

  it("parses page number", () => {
    expect(parseAbsencesCommand("absences 2")).toEqual({ kind: "today", page: 2 });
    expect(parseAbsencesCommand("absences page 3")).toEqual({ kind: "today", page: 3 });
  });

  it("rejects range as unsupported", () => {
    const result = parseAbsencesCommand("absences range 2026-01-01 2026-01-31");
    expect(result?.kind).toBe("invalid");
    if (result?.kind === "invalid") {
      expect(result.message).toContain("未対応");
    }
  });

  it("rejects unknown subcommand", () => {
    const result = parseAbsencesCommand("absences foo");
    expect(result?.kind).toBe("invalid");
  });
});
