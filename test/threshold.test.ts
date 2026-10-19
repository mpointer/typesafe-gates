import { describe, expect, it } from "vitest";
import { keptIndices, probabilityThreshold, rankIndices, thresholdFromEnv } from "../src/threshold.js";

describe("thresholdFromEnv", () => {
  const spec = { name: "T", default: 0.5 };
  it("uses the default when unset or blank", () => {
    expect(thresholdFromEnv(spec, {})).toBe(0.5);
    expect(thresholdFromEnv(spec, { T: "  " })).toBe(0.5);
  });
  it("parses a valid value", () => {
    expect(thresholdFromEnv(spec, { T: "0.8" })).toBe(0.8);
  });
  it("falls back on garbage, NaN, and out-of-range values", () => {
    expect(thresholdFromEnv(spec, { T: "abc" })).toBe(0.5);
    expect(thresholdFromEnv(spec, { T: "NaN" })).toBe(0.5);
    expect(thresholdFromEnv(spec, { T: "1.5" })).toBe(0.5);
    expect(thresholdFromEnv(spec, { T: "-0.1" })).toBe(0.5);
  });
  it("honours integer and exclusive-min specs", () => {
    expect(thresholdFromEnv({ name: "N", default: 12, min: 8, max: 30, integer: true }, { N: "9.5" })).toBe(12);
    expect(thresholdFromEnv({ name: "N", default: 12, min: 8, max: 30, integer: true }, { N: "20" })).toBe(20);
    expect(probabilityThreshold("P", 0.5, { P: "0" })).toBe(0.5);
    expect(probabilityThreshold("P", 0.5, { P: "1" })).toBe(1);
  });
});

describe("keptIndices", () => {
  it("keeps values at or above the threshold and never NaN", () => {
    expect([...keptIndices([0.2, 0.5, Number.NaN, 0.9], 0.5)]).toEqual([1, 3]);
  });
});

describe("rankIndices", () => {
  it("ranks descending with input-order ties, filters, and limits", () => {
    const items = [1, 3, 3, 0, 2];
    expect(rankIndices(items, (x) => x)).toEqual([1, 2, 4, 0, 3]);
    expect(rankIndices(items, (x) => x, { limit: 2 })).toEqual([1, 2]);
    expect(rankIndices(items, (x) => x, { keep: (x) => x > 1, limit: 10 })).toEqual([1, 2, 4]);
    expect(rankIndices(items, (x) => x, { keep: () => false })).toEqual([]);
  });
});
