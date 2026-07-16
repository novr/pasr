import { describe, expect, it } from "vitest";
import {
  parseAbsencesCommand,
  parseAdminCommandText,
  parseChannelConfigCommand,
  parseUsersCommand,
  DEFERRED_ADMIN_COMMAND_KINDS
} from "./admin-command-parse";

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

describe("parseAdminCommandText", () => {
  it("parses top-level admin actions", () => {
    expect(parseAdminCommandText("")).toEqual({ kind: "help" });
    expect(parseAdminCommandText("help")).toEqual({ kind: "help" });
    expect(parseAdminCommandText("status")).toEqual({ kind: "status" });
    expect(parseAdminCommandText("run")).toEqual({ kind: "run" });
  });

  it("delegates users absences and channel-config", () => {
    expect(parseAdminCommandText("users 2")).toEqual({ kind: "users", page: 2 });
    expect(parseAdminCommandText("absences today")).toEqual({
      kind: "absences",
      scope: "today",
      page: 1
    });
    expect(parseAdminCommandText("channel-config list")).toEqual({
      kind: "channel-config",
      sub: { kind: "list" }
    });
  });

  it("returns invalid instead of unknown for bad subcommands", () => {
    const users = parseAdminCommandText("users list");
    expect(users.kind).toBe("invalid");
    const channel = parseAdminCommandText("channel-config empty maybe");
    expect(channel.kind).toBe("invalid");
  });

  it("returns unknown for unsupported top-level action", () => {
    expect(parseAdminCommandText("migrate")).toEqual({ kind: "unknown", action: "migrate" });
  });
});

describe("DEFERRED_ADMIN_COMMAND_KINDS", () => {
  it("lists deferred kinds only", () => {
    expect(DEFERRED_ADMIN_COMMAND_KINDS).toEqual(["users", "absences", "channel-config"]);
  });
});
