import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, it } from "vitest";
import {
  buildJpHolidaysJson,
  parseSyukujitsuCsvBuffer,
  parseSyukujitsuCsvDates,
  toIsoDateFromSyukujitsu
} from "./parse-syukujitsu-csv";

const fixturePath = resolve("scripts/fixtures/syukujitsu.sample.csv");

describe("parse-syukujitsu-csv", () => {
  it("normalizes YYYY/M/D to ISO date", () => {
    expect(toIsoDateFromSyukujitsu("2026/5/6")).toBe("2026-05-06");
    expect(toIsoDateFromSyukujitsu("2026/12/1")).toBe("2026-12-01");
  });

  it("parses fixture CSV dates", () => {
    const text = readFileSync(fixturePath, "utf8");
    expect(parseSyukujitsuCsvDates(text)).toEqual([
      "2026-01-01",
      "2026-01-12",
      "2026-02-11",
      "2026-05-04",
      "2026-05-05",
      "2026-05-06",
      "2027-01-01"
    ]);
  });

  it("builds rolling 3-year coverage window when target years are present", () => {
    const json = buildJpHolidaysJson(
      ["2025-12-31", "2026-01-01", "2028-12-31", "2029-01-01"],
      2026
    );
    expect(json.coverage).toEqual({ from: "2026-01-01", to: "2028-12-31" });
    expect(json.dates).toEqual(["2026-01-01", "2028-12-31"]);
  });

  it("caps coverage.to at the last year with holiday dates", () => {
    const json = buildJpHolidaysJson(["2026-01-01", "2027-11-23"], 2026);
    expect(json.coverage).toEqual({ from: "2026-01-01", to: "2027-12-31" });
    expect(json.dates).toEqual(["2026-01-01", "2027-11-23"]);
  });

  it("decodes Shift_JIS fixture buffer", () => {
    const buffer = readFileSync(fixturePath);
    const json = parseSyukujitsuCsvBuffer(buffer, 2026);
    expect(json.source).toBe("cao_syukujitsu");
    expect(json.dates).toContain("2026-05-06");
    expect(json.dates).toContain("2027-01-01");
  });
});
