/**
 * Thresholds are numbers the code owns, not prompt wording. Keeping them in
 * environment variables means a gate can be loosened or tightened without
 * a deploy, and an invalid or out-of-range value falls back to the default
 * rather than silently disabling the gate.
 */

export interface ThresholdSpec {
  /** Environment variable name, for example `RELEVANCE_MIN_PROBABILITY`. */
  name: string;
  default: number;
  /** Inclusive lower bound. Default 0. */
  min?: number;
  /** Inclusive upper bound. Default 1. */
  max?: number;
  /** When true, the lower bound is exclusive (a probability threshold of 0
   * would keep everything, which is never what an operator meant). */
  exclusiveMin?: boolean;
  integer?: boolean;
}

export function thresholdFromEnv(
  spec: ThresholdSpec,
  env: Record<string, string | undefined> = process.env,
): number {
  const raw = env[spec.name];
  if (raw === undefined || raw.trim() === "") return spec.default;
  const v = Number(raw);
  const min = spec.min ?? 0;
  const max = spec.max ?? 1;
  if (!Number.isFinite(v)) return spec.default;
  if (spec.integer && !Number.isInteger(v)) return spec.default;
  if (spec.exclusiveMin ? v <= min : v < min) return spec.default;
  if (v > max) return spec.default;
  return v;
}

/** A probability keep-threshold in (0, 1]. */
export function probabilityThreshold(
  name: string,
  defaultValue: number,
  env: Record<string, string | undefined> = process.env,
): number {
  return thresholdFromEnv({ name, default: defaultValue, min: 0, max: 1, exclusiveMin: true }, env);
}

/** Indices whose value meets the threshold, in input order. `NaN` is never
 * kept: `!(p >= t)` style comparisons are the one place a silent NaN would
 * otherwise flip a gate open. */
export function keptIndices(values: readonly number[], threshold: number): Set<number> {
  const keep = new Set<number>();
  values.forEach((p, i) => {
    if (p >= threshold) keep.add(i);
  });
  return keep;
}

/** Indices of `items` that pass `keep`, ordered by `rank` descending with
 * ties broken by input order, cut to `limit`. Fewer than `limit`, including
 * zero, is a valid result: the caller asked for the best, not for ten. */
export function rankIndices<T>(
  items: readonly T[],
  rank: (item: T, index: number) => number,
  opts: { limit?: number; keep?: (item: T, index: number) => boolean } = {},
): number[] {
  const keep = opts.keep ?? (() => true);
  const ranked = items
    .map((item, i) => ({ i, r: rank(item, i), ok: keep(item, i) }))
    .filter((x) => x.ok)
    .sort((a, b) => b.r - a.r || a.i - b.i)
    .map((x) => x.i);
  return opts.limit === undefined ? ranked : ranked.slice(0, opts.limit);
}
