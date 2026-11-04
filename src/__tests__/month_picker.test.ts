import { describe, expect, it } from "vitest";
import { pickerYears, shiftMonth } from "../months";

describe("month picker", () => {
  it("steps one month forward and back across a year end", () => {
    expect(shiftMonth("November 2026", 1)).toBe("December 2026");
    expect(shiftMonth("December 2026", 1)).toBe("January 2027");
    expect(shiftMonth("January 2026", -1)).toBe("December 2025");
  });

  it("offers three years back and one ahead, widened to the shown year", () => {
    expect(pickerYears(2026, 2026)).toEqual([2023, 2024, 2025, 2026, 2027]);
    expect(pickerYears(2019, 2026)).toEqual([2019, 2020, 2021, 2022, 2023, 2024, 2025, 2026, 2027]);
    expect(pickerYears(2029, 2026)).toEqual([2023, 2024, 2025, 2026, 2027, 2028, 2029]);
  });
});
