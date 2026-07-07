import { describe, expect, it } from "vitest";
import { parseChannelConfigCommand } from "./admin-command-parse";

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
