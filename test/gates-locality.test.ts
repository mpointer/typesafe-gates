import { describe, expect, it } from "vitest";
import { createJudge } from "../src/judge.js";
import {
  localityGate,
  localityVerdict,
  localPoolTarget,
  meanLocality,
  pickLocalFirst,
  sourceLocalityMinLevel,
} from "../src/gates/locality.js";
import { fakeClient, scoreAnswer } from "./helpers.js";

const v = (expected: number, pLocal: number) => ({ expected, pLocal });

describe("locality gate", () => {
  it("verdict carries the expected level and P(nearby or closer)", async () => {
    const client = fakeClient({ answers: [{ locality: scoreAnswer({ 1: 0.2, 2: 0.3, 3: 0.5 }) }] });
    const res = await localityGate.runOne(createJudge({ client, logger: null }), { title: "t" }, { name: "Town", state: "PA" });
    expect(res.status).toBe("judged");
    if (res.status === "judged") {
      expect(res.verdicts[0]!.pLocal).toBeCloseTo(0.8);
      expect(res.verdicts[0]!.expected).toBeCloseTo(2.3);
    }
    expect(localityVerdict({ probabilities: { 3: 1 } })).toEqual({ expected: 3, pLocal: 1 });
  });

  it("env knobs validate and fall back", () => {
    expect(localPoolTarget({})).toBe(12);
    expect(localPoolTarget({ LOCALITY_POOL_TARGET: "50" })).toBe(12);
    expect(localPoolTarget({ LOCALITY_POOL_TARGET: "10" })).toBe(10);
    expect(sourceLocalityMinLevel({ SOURCE_LOCALITY_MIN_LEVEL: "1.2" })).toBe(1.2);
    expect(sourceLocalityMinLevel({ SOURCE_LOCALITY_MIN_LEVEL: "4" })).toBe(0.5);
  });
});

describe("pickLocalFirst", () => {
  it("keeps every local item and tops up with the most-local statewide items", () => {
    const items = ["a", "b", "c", "d", "e"];
    const verdicts = [v(3, 0.9), v(0.2, 0.05), v(1.4, 0.3), v(2.6, 0.7), v(1.1, 0.2)];
    const pick = pickLocalFirst(items, verdicts, { target: 3, minProbability: 0.5 });
    expect(pick.items).toEqual(["a", "c", "d"]);
    expect(pick).toMatchObject({ local: 2, filler: 1 });
  });

  it("never fills with items plainly elsewhere, so a thin day yields a small pool", () => {
    const items = ["a", "b", "c"];
    const verdicts = [v(0.1, 0), v(0.5, 0.1), v(0.9, 0.2)];
    const pick = pickLocalFirst(items, verdicts, { target: 12, minProbability: 0.5 });
    expect(pick.items).toEqual([]);
    expect(pick).toMatchObject({ local: 0, filler: 0 });
  });

  it("does not top up when local items already reach the target", () => {
    const items = ["a", "b", "c"];
    const verdicts = [v(3, 1), v(3, 1), v(1.5, 0.1)];
    expect(pickLocalFirst(items, verdicts, { target: 2, minProbability: 0.5 }).items).toEqual(["a", "b"]);
  });
});

describe("meanLocality", () => {
  it("needs a minimum sample and averages expected levels", () => {
    expect(meanLocality([v(1, 0), v(2, 0)])).toBeNull();
    expect(meanLocality([v(1, 0), v(2, 0), v(3, 0)])).toBeCloseTo(2);
  });
});
