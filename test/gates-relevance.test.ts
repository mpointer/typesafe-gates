import { describe, expect, it } from "vitest";
import { createJudge } from "../src/judge.js";
import {
  candidateGate,
  rankCandidates,
  relevanceGate,
  relevanceMinProbability,
  relevanceState,
  sourceRelevanceGate,
  substantiveProbability,
} from "../src/gates/relevance.js";
import { choiceAnswer, fakeClient, scoreAnswer } from "./helpers.js";

const subject = { name: "Example Band", about: "a four-piece indie rock band", kind: "entity" as const };

describe("relevance gate", () => {
  it("builds a state that includes the subject description and truncates the excerpt", () => {
    const s = relevanceState({ kind: "article", title: "t", excerpt: "x".repeat(900) }, subject);
    expect(s.publication.about).toBe("a four-piece indie rock band");
    expect(s.publication.kind).toMatch(/named subject/);
    expect(s.item.excerpt).toHaveLength(500);
  });

  it("verdict is P(level >= 2)", async () => {
    const client = fakeClient({ answers: [{ relevance: scoreAnswer({ 0: 0.1, 1: 0.2, 2: 0.3, 3: 0.4 }) }] });
    const res = await relevanceGate.runOne(createJudge({ client, logger: null }), { kind: "article", title: "t" }, subject);
    expect(res.status).toBe("judged");
    if (res.status === "judged") expect(res.verdicts[0]).toBeCloseTo(0.7);
    expect(substantiveProbability({ probabilities: { 2: 0.5 } })).toBe(0.5);
    expect(relevanceMinProbability({})).toBe(0.5);
    expect(relevanceMinProbability({ RELEVANCE_MIN_PROBABILITY: "0.7" })).toBe(0.7);
  });

  it("source gate reports P(related) and the expected level", async () => {
    const client = fakeClient({ answers: [{ relevance: scoreAnswer({ 0: 0.8, 1: 0.1, 2: 0.1 }) }] });
    const res = await sourceRelevanceGate.runOne(
      createJudge({ client, logger: null }),
      { name: "Lyrics Site", url: "https://x", type: "rss", recentTitles: ["a", "b"] },
      subject,
    );
    expect(res.status).toBe("judged");
    if (res.status === "judged") {
      expect(res.verdicts[0]!.pRelated).toBeCloseTo(0.2);
      expect(res.verdicts[0]!.level).toBeCloseTo(0.3);
    }
  });
});

describe("candidate gate and rankCandidates", () => {
  const gate = candidateGate({ news: "news", events: "events", other: "other" }, "other");

  it("interprets relevance, newsworthiness, filler probability, and a validated category", async () => {
    const client = fakeClient({
      answers: [
        {
          relevance: scoreAnswer({ 2: 0.4, 3: 0.6 }),
          newsworthiness: scoreAnswer({ 0: 0.1, 2: 0.9 }),
          category: choiceAnswer({ news: 0.9, events: 0.1, other: 0 }),
        },
        {
          relevance: scoreAnswer({ 0: 1 }),
          newsworthiness: scoreAnswer({ 0: 1 }),
          category: { choice: "bogus", confidence: 1, probabilities: {} },
        },
      ],
    });
    const res = await gate.run(createJudge({ client, logger: null }), [{ kind: "a", title: "x" }, { kind: "a", title: "y" }], subject);
    expect(res.status).toBe("judged");
    if (res.status !== "judged") return;
    expect(res.verdicts[0]).toMatchObject({ pRelevant: 1, category: "news" });
    expect(res.verdicts[0]!.newsworthiness).toBeCloseTo(1.8);
    expect(res.verdicts[0]!.pFiller).toBeCloseTo(0.1);
    expect(res.verdicts[1]).toMatchObject({ pRelevant: 0, pFiller: 1, category: "other" });
  });

  it("ranks by newsworthiness then relevance, drops off-subject and filler, and caps", () => {
    const v = (pRelevant: number, newsworthiness: number, pFiller = 0) => ({ pRelevant, newsworthiness, pFiller, category: "news" });
    const verdicts = [v(0.9, 1), v(0.9, 3), v(0.3, 3), v(0.95, 3), v(0.9, 2, 0.6)];
    expect(rankCandidates(verdicts, 0.5)).toEqual([3, 1, 0]);
    expect(rankCandidates(verdicts, 0.5, 1)).toEqual([3]);
    expect(rankCandidates([], 0.5)).toEqual([]);
  });
});
