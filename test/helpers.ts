import { vi } from "vitest";
import type { SystemOneClient } from "../src/client.js";

export type FakeAnswers = Record<string, unknown>;

export interface FakeClientOptions {
  /** Answers per request, by call order. A function receives the state. */
  answers: FakeAnswers[] | ((state: unknown, callIndex: number) => FakeAnswers);
  /** Call indices that reject instead of answering. */
  failAt?: number[];
  /** Per-call delay in ms. */
  delayMs?: number | ((callIndex: number) => number);
  inputTokens?: number;
  model?: string;
}

export interface FakeClient extends SystemOneClient {
  calls: Array<{ state: unknown; signal: AbortSignal | undefined; model: string | undefined }>;
  systemOne: ReturnType<typeof vi.fn>;
}

/** A `systemOne` stand-in: no network, honours abort signals, counts calls. */
export function fakeClient(opts: FakeClientOptions): FakeClient {
  const calls: FakeClient["calls"] = [];
  const systemOne = vi.fn(async (request: { state: unknown; model?: string }, options?: { signal?: AbortSignal }) => {
    const i = calls.length;
    calls.push({ state: request.state, signal: options?.signal, model: request.model });
    const delay = typeof opts.delayMs === "function" ? opts.delayMs(i) : (opts.delayMs ?? 0);
    if (delay > 0) {
      await new Promise<void>((resolve, reject) => {
        const t = setTimeout(resolve, delay);
        options?.signal?.addEventListener(
          "abort",
          () => {
            clearTimeout(t);
            reject(new Error("aborted"));
          },
          { once: true },
        );
      });
    }
    if (options?.signal?.aborted) throw new Error("aborted");
    if (opts.failAt?.includes(i)) throw new Error(`boom ${i}`);
    const answers = typeof opts.answers === "function" ? opts.answers(request.state, i) : opts.answers[i];
    if (answers === undefined) throw new Error(`no fake answer for call ${i}`);
    return {
      model: opts.model ?? "jev-1",
      answers,
      usage: { input_tokens: opts.inputTokens ?? 100, output_tokens: 0 },
    };
  });
  return { calls, systemOne } as unknown as FakeClient;
}

export function scoreAnswer(probabilities: Record<number, number>) {
  let score = 0;
  for (const [k, p] of Object.entries(probabilities)) score += Number(k) * p;
  const best = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0];
  return { score, confidence: best?.[1] ?? 0, legend: {}, probabilities };
}

export function choiceAnswer<L extends string>(probabilities: Record<L, number>) {
  const best = (Object.entries(probabilities) as Array<[L, number]>).sort((a, b) => b[1] - a[1])[0]!;
  return { choice: best[0], confidence: best[1], probabilities };
}

export function noulAnswer(p: number) {
  return { noul: p };
}
