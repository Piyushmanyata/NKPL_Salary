import { describe, expect, it } from "vitest";
import { describeChanges } from "../monthDiff";

describe("describeChanges", () => {
  it("names each changed field per person", () => {
    expect(
      describeChanges(
        [{ id: "1", name: "Laltu Malik", daysWorked: 25, advance: null }],
        [{ id: "1", name: "Laltu Malik", daysWorked: 24, advance: 7500 }],
      ),
    ).toEqual(["Laltu Malik: Days 25 → 24", "Laltu Malik: Advance blank → 7,500"]);
  });

  it("lists people added and removed", () => {
    expect(
      describeChanges([{ id: "1", name: "Gokul" }], [{ id: "2", name: "Surya" }]),
    ).toEqual(["Added Surya", "Removed Gokul"]);
  });

  it("finds nothing when only key order differs", () => {
    expect(describeChanges([{ id: "1", a: 1, b: 2 }], [{ b: 2, id: "1", a: 1 }])).toEqual([]);
  });
});
