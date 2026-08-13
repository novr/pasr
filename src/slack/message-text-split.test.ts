import { describe, expect, it } from "vitest";
import { labelSplitTextParts, splitLinesByTextMax } from "./message-text-split";

describe("splitLinesByTextMax", () => {
  it("returns empty array for no lines", () => {
    expect(splitLinesByTextMax([], 100)).toEqual([]);
  });

  it("keeps short content in one chunk", () => {
    const lines = ["*2026-08-12 (水)*", "• <@U1> 通院"];
    expect(splitLinesByTextMax(lines, 200)).toEqual([lines.join("\n")]);
  });

  it("carries day header into the next chunk", () => {
    const lines = [
      "*2026-08-12 (水)*",
      "• <@U1> a",
      "• <@U2> b",
      "• <@U3> c"
    ];
    const chunks = splitLinesByTextMax(lines, 30);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[1]).toContain("*2026-08-12 (水)*");
  });

  it("truncates an oversized single line", () => {
    const line = "x".repeat(50);
    const chunks = splitLinesByTextMax([line], 20);
    expect(chunks).toHaveLength(1);
    expect(chunks[0]!.length).toBeLessThanOrEqual(20);
    expect(chunks[0]!.endsWith("…")).toBe(true);
  });
});

describe("labelSplitTextParts", () => {
  it("labels only when multiple parts exist", () => {
    expect(labelSplitTextParts(["a"])).toEqual(["a"]);
    expect(labelSplitTextParts(["a", "b"])).toEqual(["_1/2_\na", "_2/2_\nb"]);
  });
});
