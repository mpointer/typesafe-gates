/** Token usage for one gate invocation, summed over every request it made. */
export interface UsageTotals {
  inputTokens: number;
  outputTokens: number;
  /** Requests that returned an answer. */
  requests: number;
}

/** One record per gate invocation, delivered to the host's `recordUsage`. */
export interface UsageRecord extends UsageTotals {
  /** The gate's task name, for cost telemetry grouped by call site. */
  task: string;
  /** Model id as the API reported it (for example `jev-1`), or the
   * requested model when no request completed. */
  model: string;
  provider: "typesafe";
  /** True when the invocation ended unavailable; the tokens were still billed. */
  failed: boolean;
  /** Wall-clock time of the invocation, from first request to result. */
  durationMs: number;
  estimatedCostUsd: number;
  /** Whatever the caller attached: tenant id, run id, request id. */
  meta: Record<string, unknown>;
}

export type UsageRecorder = (record: UsageRecord) => void | Promise<void>;

/** Published Jev rate at launch (2026-09): $0.042 per million input tokens,
 * output free. Override through `JudgeConfig.rates` when it changes. */
export const JEV_RATES = { inputUsdPerMillion: 0.042, outputUsdPerMillion: 0 } as const;

export interface Rates {
  inputUsdPerMillion: number;
  outputUsdPerMillion: number;
}

export function estimateCostUsd(usage: UsageTotals, rates: Rates = JEV_RATES): number {
  return (
    (usage.inputTokens * rates.inputUsdPerMillion + usage.outputTokens * rates.outputUsdPerMillion) /
    1_000_000
  );
}
