import type { EntryType, Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { SystemOneClient } from "./client.js";
import { estimateCostUsd, JEV_RATES, type Rates, type UsageRecorder, type UsageTotals } from "./usage.js";

export type UnavailableReason = "no_client" | "request_failed" | "over_budget" | "aborted";

/** The judge could not deliver a complete set of answers. Which path the
 * caller takes from here is the gate's policy, never the judge's. */
export interface Unavailable {
  status: "unavailable";
  reason: UnavailableReason;
  error?: unknown;
  usage: UsageTotals;
}

export interface Judged<A> {
  status: "judged";
  /** One answer set per input state, in input order. */
  answers: A[];
  model: string;
  usage: UsageTotals;
}

export type JudgeResult<A> = Judged<A> | Unavailable;

export interface JudgeConfig {
  /** `null` means "not configured": every judgment is `unavailable` with
   * reason `no_client`. Omit to build one from `TYPESAFE_API_KEY` lazily. */
  client?: SystemOneClient | null;
  /** Receives one record per invocation, including failed ones (tokens spent
   * before a failure were still billed). Errors thrown here are swallowed:
   * telemetry must never fail a gate. */
  recordUsage?: UsageRecorder;
  /** Where "falling back" warnings go. `null` silences them. Default: console. */
  logger?: Pick<Console, "warn"> | null;
  /** Requests in flight per invocation. Default 8. */
  concurrency?: number;
  rates?: Rates;
  /** Model override for every request. */
  model?: string;
}

export interface JudgeOptions {
  /** Task name for usage telemetry, for example `relevance`. */
  task: string;
  /** Attached to the usage record untouched. */
  meta?: Record<string, unknown>;
  /** Wall-clock budget for the whole invocation. When it runs out, every
   * request still in flight is aborted and the result is `over_budget`. */
  budgetMs?: number;
  signal?: AbortSignal;
  concurrency?: number;
  model?: string;
}

/** Answers for `questions` over each of `states`, or an `Unavailable`. */
export type Judge = <const Q extends Questions>(
  states: readonly EntryType[],
  questions: Q,
  opts: JudgeOptions,
) => Promise<JudgeResult<SystemOneResult<Q>["answers"]>>;

const DEFAULT_CONCURRENCY = 8;

/**
 * Build a judge: one request per state, the same questions asked of every
 * state, answers returned in input order.
 *
 * Each state is its own evidence. Batching several items into one state
 * would let them bleed into each other's judgments, so the judge never does
 * that; it runs requests concurrently instead.
 *
 * Batches are all-or-nothing. If any request fails, the rest are aborted and
 * the whole invocation is `unavailable`, so one outage never mixes two
 * judges' standards (TypeSafe for half the batch, a fallback for the other
 * half) inside a single decision.
 */
export function createJudge(config: JudgeConfig = {}): Judge {
  let resolvedClient: SystemOneClient | null | undefined = config.client;
  const logger = config.logger === undefined ? console : config.logger;
  const rates = config.rates ?? JEV_RATES;

  async function getClient(): Promise<SystemOneClient | null> {
    if (resolvedClient !== undefined) return resolvedClient;
    const { clientFromEnv } = await import("./client.js");
    resolvedClient = clientFromEnv();
    return resolvedClient;
  }

  return async function judge(states, questions, opts) {
    const client = await getClient();
    const usage: UsageTotals = { inputTokens: 0, outputTokens: 0, requests: 0 };
    const requestedModel = opts.model ?? config.model ?? "";

    async function record(model: string, failed: boolean): Promise<void> {
      if (!config.recordUsage) return;
      if (usage.inputTokens + usage.outputTokens <= 0 && usage.requests === 0) return;
      try {
        await config.recordUsage({
          task: opts.task,
          model: model || requestedModel || "jev-latest",
          provider: "typesafe",
          failed,
          estimatedCostUsd: estimateCostUsd(usage, rates),
          meta: opts.meta ?? {},
          ...usage,
        });
      } catch (err) {
        logger?.warn(`[typesafe-gates:${opts.task}] usage recorder threw`, err instanceof Error ? err.message : err);
      }
    }

    if (!client) return { status: "unavailable", reason: "no_client", usage };
    if (states.length === 0) return { status: "judged", answers: [], model: requestedModel, usage };

    const abort = new AbortController();
    const onOuterAbort = () => abort.abort();
    opts.signal?.addEventListener("abort", onOuterAbort, { once: true });
    if (opts.signal?.aborted) abort.abort();

    let budgetHit = false;
    const budgetTimer =
      opts.budgetMs !== undefined
        ? setTimeout(() => {
            budgetHit = true;
            abort.abort();
          }, opts.budgetMs)
        : undefined;

    const answers = new Array<SystemOneResult<typeof questions>["answers"]>(states.length);
    let model = "";
    let next = 0;
    let failure: unknown = undefined;
    let failed = false;

    async function worker(): Promise<void> {
      while (!failed && !abort.signal.aborted && next < states.length) {
        const i = next++;
        try {
          const request = requestedModel
            ? { state: states[i] as EntryType, questions, model: requestedModel }
            : { state: states[i] as EntryType, questions };
          const res = await client!.systemOne(request, { signal: abort.signal });
          answers[i] = res.answers;
          usage.inputTokens += res.usage.input_tokens;
          usage.outputTokens += res.usage.output_tokens;
          usage.requests += 1;
          model ||= res.model;
        } catch (err) {
          if (!failed) {
            failed = true;
            failure = err;
            abort.abort();
          }
        }
      }
    }

    const width = Math.min(opts.concurrency ?? config.concurrency ?? DEFAULT_CONCURRENCY, states.length);
    try {
      await Promise.all(Array.from({ length: width }, () => worker()));
    } finally {
      if (budgetTimer !== undefined) clearTimeout(budgetTimer);
      opts.signal?.removeEventListener("abort", onOuterAbort);
    }

    const incomplete = failed || abort.signal.aborted || usage.requests < states.length;
    await record(model, incomplete);

    if (incomplete) {
      const reason: UnavailableReason = budgetHit
        ? "over_budget"
        : opts.signal?.aborted
          ? "aborted"
          : "request_failed";
      logger?.warn(
        `[typesafe-gates:${opts.task}] judgment ${reason}; caller falls back`,
        failure instanceof Error ? failure.message : failure,
      );
      return failure === undefined
        ? { status: "unavailable", reason, usage }
        : { status: "unavailable", reason, error: failure, usage };
    }
    return { status: "judged", answers, model, usage };
  };
}
