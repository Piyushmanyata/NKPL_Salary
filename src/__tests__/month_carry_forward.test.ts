import { describe, expect, it } from "vitest";
import { pickCarrySource } from "../attendance";

/**
 * A new month inherits the previous month's roster and rates automatically —
 * the user never picks a month to copy from. `pickCarrySource` decides which
 * month that is.
 */
describe("month carry-forward source", () => {
  const months = ["June 2026", "July 2026", "May 2026"]; // deliberately unsorted

  it("picks the immediately preceding month", () => {
    expect(pickCarrySource(months, "August 2026")).toBe("July 2026");
    expect(pickCarrySource(months, "July 2026")).toBe("June 2026");
  });

  it("crosses a year boundary", () => {
    expect(pickCarrySource(["November 2025", "December 2025"], "January 2026")).toBe("December 2025");
  });

  it("skips gaps rather than giving up", () => {
    expect(pickCarrySource(["January 2026", "June 2026"], "December 2026")).toBe("June 2026");
  });

  it("back-filling an older month starts from the earliest month that exists", () => {
    expect(pickCarrySource(months, "February 2026")).toBe("May 2026");
  });

  it("returns empty when there is nothing to carry — the real first month", () => {
    expect(pickCarrySource([], "June 2026")).toBe("");
    expect(pickCarrySource(["June 2026"], "June 2026")).toBe("");
  });

  it("ignores unparseable labels instead of carrying from them", () => {
    expect(pickCarrySource(["not a month", "June 2026"], "July 2026")).toBe("June 2026");
    expect(pickCarrySource(["June 2026"], "not a month")).toBe("");
  });
});
