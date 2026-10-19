import { describe, expect, it, vi } from "vitest";
import { noul, score } from "@typesafe-ai/sdk";
import { createJudge } from "../src/judge.js";
import type { UsageRecord } from "../src/usage.js";
import { fakeClient, noulAnswer, scoreAnswer } from "./helpers.js";

const QUESTIONS = { yes: noul("Is `x` positive?", { true: "yes", false: "no" }) };
const states = (n: number) => Array.from({ length: n }, (_, i) => ({ x: i }));

describe("createJudge", () => {
  it("returns one answer set per state, in input order, regardless of completion order", async () => {
    const client = fakeClient({
      answers: (state) => ({ yes: noulAnswer((state as { x: number }).x / 10) }),
      delayMs: (i) => (5 - i) * 4, // later calls finish first
    });
    const judge = createJudge({ client, logger: null });
    const res = await judge(states(5), QUESTIONS, { task: "t" });
    expect(res.status).toBe("judged");
    if (res.status !== "judged") return;
    expect(res.answers.map((a) => a.yes.noul)).toEqual([0, 0.1, 0.2, 0.3, 0.4]);
    expect(res.model).toBe("jev-1");
    expect(res.usage).toEqual({ inputTokens: 500, outputTokens: 0, requests: 5 });
  });

  it("is all-or-nothing: one failure aborts the rest and the result is unavailable", async () => {
    const client = fakeClient({
      answers: () => ({ yes: noulAnswer(0.5) }),
      failAt: [1],
      delayMs: (i) => (i === 0 ? 0 : i === 1 ? 5 : 60),
    });
    const records: UsageRecord[] = [];
    const judge = createJudge({ client, logger: null, recordUsage: (r) => void records.push(r) });
    const res = await judge(states(6), QUESTIONS, { task: "t", concurrency: 3 });
    expect(res.status).toBe("unavailable");
    if (res.status !== "unavailable") return;
    expect(res.reason).toBe("request_failed");
    expect((res.error as Error).message).toBe("boom 1");
    // The in-flight requests saw the abort; the never-started ones were never sent.
    expect(client.calls.length).toBeLessThan(6);
    expect(client.calls.every((c) => c.signal?.aborted)).toBe(true);
    // Tokens spent before the failure are still recorded, flagged failed.
    expect(res.usage.requests).toBe(1);
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({ task: "t", provider: "typesafe", failed: true, requests: 1 });
  });

  it("records usage with cost on success and attaches meta", async () => {
    const client = fakeClient({ answers: () => ({ yes: noulAnswer(1) }), inputTokens: 1_000_000 });
    const records: UsageRecord[] = [];
    const judge = createJudge({ client, logger: null, recordUsage: (r) => void records.push(r) });
    await judge(states(2), QUESTIONS, { task: "t", meta: { tenant: "a" } });
    expect(records).toHaveLength(1);
    expect(records[0]).toMatchObject({
      task: "t",
      model: "jev-1",
      failed: false,
      inputTokens: 2_000_000,
      requests: 2,
      meta: { tenant: "a" },
    });
    expect(records[0]!.estimatedCostUsd).toBeCloseTo(0.084, 6);
  });

  it("swallows a throwing usage recorder", async () => {
    const client = fakeClient({ answers: () => ({ yes: noulAnswer(1) }) });
    const warn = vi.fn();
    const judge = createJudge({
      client,
      logger: { warn },
      recordUsage: () => {
        throw new Error("telemetry down");
      },
    });
    const res = await judge(states(1), QUESTIONS, { task: "t" });
    expect(res.status).toBe("judged");
    expect(warn).toHaveBeenCalledOnce();
  });

  it("is unavailable with reason no_client when no client is configured", async () => {
    const recordUsage = vi.fn();
    const judge = createJudge({ client: null, logger: null, recordUsage });
    const res = await judge(states(3), QUESTIONS, { task: "t" });
    expect(res).toEqual({ status: "unavailable", reason: "no_client", usage: { inputTokens: 0, outputTokens: 0, requests: 0 } });
    expect(recordUsage).not.toHaveBeenCalled();
  });

  it("builds a client lazily from TYPESAFE_API_KEY and reports no_client when it is unset", async () => {
    const saved = process.env.TYPESAFE_API_KEY;
    delete process.env.TYPESAFE_API_KEY;
    try {
      const res = await createJudge({ logger: null })(states(1), QUESTIONS, { task: "t" });
      expect(res.status).toBe("unavailable");
      if (res.status === "unavailable") expect(res.reason).toBe("no_client");
    } finally {
      if (saved !== undefined) process.env.TYPESAFE_API_KEY = saved;
    }
  });

  it("judges an empty batch without a request", async () => {
    const client = fakeClient({ answers: [] });
    const res = await createJudge({ client, logger: null })([], QUESTIONS, { task: "t" });
    expect(res).toMatchObject({ status: "judged", answers: [] });
    expect(client.systemOne).not.toHaveBeenCalled();
  });

  it("aborts everything when the time budget runs out and reports over_budget", async () => {
    const client = fakeClient({ answers: () => ({ yes: noulAnswer(1) }), delayMs: (i) => (i === 0 ? 1 : 200) });
    const records: UsageRecord[] = [];
    const judge = createJudge({ client, logger: null, recordUsage: (r) => void records.push(r) });
    const started = Date.now();
    const res = await judge(states(4), QUESTIONS, { task: "t", budgetMs: 30 });
    expect(Date.now() - started).toBeLessThan(150);
    expect(res.status).toBe("unavailable");
    if (res.status !== "unavailable") return;
    expect(res.reason).toBe("over_budget");
    expect(res.usage.requests).toBe(1); // the one that finished before the budget
    expect(records[0]).toMatchObject({ failed: true, requests: 1 });
  });

  it("reports aborted when the caller's signal fires", async () => {
    const client = fakeClient({ answers: () => ({ yes: noulAnswer(1) }), delayMs: 200 });
    const ac = new AbortController();
    const judge = createJudge({ client, logger: null });
    const p = judge(states(2), QUESTIONS, { task: "t", signal: ac.signal });
    setTimeout(() => ac.abort(), 5);
    const res = await p;
    expect(res.status).toBe("unavailable");
    if (res.status === "unavailable") expect(res.reason).toBe("aborted");
  });

  it("respects concurrency and passes the model override", async () => {
    let inFlight = 0;
    let peak = 0;
    const client = fakeClient({
      answers: () => {
        return { yes: noulAnswer(1) };
      },
      delayMs: 5,
    });
    const original = client.systemOne.getMockImplementation()!;
    client.systemOne.mockImplementation(async (...args: unknown[]) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      try {
        return await (original as (...a: unknown[]) => Promise<unknown>)(...args);
      } finally {
        inFlight--;
      }
    });
    const judge = createJudge({ client, logger: null, concurrency: 2, model: "jev-2" });
    const res = await judge(states(6), QUESTIONS, { task: "t" });
    expect(res.status).toBe("judged");
    expect(peak).toBe(2);
    expect(client.calls.every((c) => c.model === "jev-2")).toBe(true);
  });

  it("works with Score questions and keeps the probability table", async () => {
    const q = { level: score("How much?", ["none", "some", "lots"]) };
    const client = fakeClient({ answers: [{ level: scoreAnswer({ 0: 0.1, 1: 0.2, 2: 0.7 }) }] });
    const res = await createJudge({ client, logger: null })([{ x: 1 }], q, { task: "t" });
    expect(res.status).toBe("judged");
    if (res.status === "judged") expect(res.answers[0]!.level.probabilities[2]).toBe(0.7);
  });
});
