import { describe, expect, it } from "vitest";
import {
  allowanceTerms,
  normalizeAllowanceExpression,
  parseAllowanceExpression,
} from "../salary";

// The monthly allowance is typed as the running sum of the raises that built
// it ("400+500+600") so the row keeps showing by how much it was raised.

describe("allowance expression", () => {
  it("sums the raises", () => {
    expect(parseAllowanceExpression("400+500+600")).toBe(1500);
    expect(parseAllowanceExpression("1500")).toBe(1500);
    expect(parseAllowanceExpression("400 + 500")).toBe(900);
    expect(parseAllowanceExpression("400.5+0.5")).toBeCloseTo(401, 2);
  });

  it("tolerates a trailing + and empty terms while typing", () => {
    expect(parseAllowanceExpression("400+")).toBe(400);
    expect(parseAllowanceExpression("400++500")).toBe(900);
    expect(parseAllowanceExpression("")).toBe(0);
    expect(parseAllowanceExpression(undefined)).toBe(0);
  });

  it("never lets a negative term reduce the allowance", () => {
    expect(parseAllowanceExpression("400+-500")).toBe(400);
  });

  it("normalizes to a storage form without whitespace or empty terms", () => {
    expect(normalizeAllowanceExpression(" 400 + 500 +")).toBe("400+500");
    expect(normalizeAllowanceExpression("+")).toBe("");
  });

  it("exposes the terms for display, most recent raise last", () => {
    expect(allowanceTerms("400+500+600")).toEqual([400, 500, 600]);
    expect(allowanceTerms("1500")).toEqual([1500]);
    expect(allowanceTerms("")).toEqual([]);
  });
});
