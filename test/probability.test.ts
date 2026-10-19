import { describe, expect, it } from "vitest";
import { expectedLevel, probabilityAtLeast, probabilityAtMost, probabilityOf } from "../src/probability.js";

const table = { probabilities: { 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4 } };

describe("probability helpers", () => {
  it("sums mass at or above a level", () => {
    expect(probabilityAtLeast(table, 2)).toBeCloseTo(0.7);
    expect(probabilityAtLeast(table, 0)).toBeCloseTo(1);
    expect(probabilityAtLeast(table, 4)).toBe(0);
  });
  it("sums mass at or below a level", () => {
    expect(probabilityAtMost(table, 1)).toBeCloseTo(0.3);
  });
  it("computes the expected level", () => {
    expect(expectedLevel(table)).toBeCloseTo(2.0);
  });
  it("ignores non-finite entries instead of returning NaN", () => {
    expect(probabilityAtLeast({ probabilities: { 0: Number.NaN, 1: 0.5 } }, 1)).toBe(0.5);
    expect(expectedLevel({ probabilities: { 1: Number.POSITIVE_INFINITY, 2: 0.5 } })).toBe(1);
  });
  it("sums Choice labels and treats missing labels as zero", () => {
    const c = { probabilities: { a: 0.6, b: 0.3, c: 0.1 } };
    expect(probabilityOf(c, "a", "b")).toBeCloseTo(0.9);
    expect(probabilityOf(c, "zzz")).toBe(0);
  });
});
