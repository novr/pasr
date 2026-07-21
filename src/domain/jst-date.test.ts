import { describe, expect, it } from "vitest";
import { getJstWeekday, isWeekdayInJst } from "./jst-date";

describe("isWeekdayInJst", () => {
  it("returns true on JST weekdays", () => {
    expect(isWeekdayInJst(new Date("2026-06-24T00:30:00.000Z"))).toBe(true);
  });

  it("returns false on JST weekends", () => {
    expect(isWeekdayInJst(new Date("2026-06-27T00:30:00.000Z"))).toBe(false);
    expect(isWeekdayInJst(new Date("2026-06-28T00:30:00.000Z"))).toBe(false);
  });
});

describe("getJstWeekday", () => {
  it("maps JST calendar day to Sunday=0", () => {
    expect(getJstWeekday(new Date("2026-06-28T00:30:00.000Z"))).toBe(0);
  });
});
