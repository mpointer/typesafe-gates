/** A Score or Choice answer's probability table, keyed by level or label. */
export interface HasProbabilities {
  readonly probabilities: { readonly [key: string]: number } | { readonly [key: number]: number };
}

function entries(res: HasProbabilities): Array<[string, number]> {
  return Object.entries(res.probabilities as Record<string, number>);
}

/** Probability mass of a Score answer at or above `level`. Non-finite
 * entries are ignored rather than poisoning the sum. */
export function probabilityAtLeast(res: HasProbabilities, level: number): number {
  let p = 0;
  for (const [key, prob] of entries(res)) {
    const l = Number(key);
    if (Number.isFinite(l) && l >= level && Number.isFinite(prob)) p += prob;
  }
  return p;
}

/** Probability mass of a Score answer at or below `level`. */
export function probabilityAtMost(res: HasProbabilities, level: number): number {
  let p = 0;
  for (const [key, prob] of entries(res)) {
    const l = Number(key);
    if (Number.isFinite(l) && l <= level && Number.isFinite(prob)) p += prob;
  }
  return p;
}

/** Probability-weighted level of a Score answer. Equals the API's `score`
 * when the table is well formed; recomputed here so callers never depend on
 * a field they did not ask for. */
export function expectedLevel(res: HasProbabilities): number {
  let e = 0;
  for (const [key, prob] of entries(res)) {
    const l = Number(key);
    if (Number.isFinite(l) && Number.isFinite(prob)) e += l * prob;
  }
  return e;
}

/** Summed probability of one or more Choice labels, for example
 * `probabilityOf(answer, "ad_inquiry", "negotiation")`. Missing labels count
 * as zero. */
export function probabilityOf(res: HasProbabilities, ...labels: string[]): number {
  const table = res.probabilities as Record<string, number>;
  let p = 0;
  for (const label of labels) {
    const prob = table[label];
    if (Number.isFinite(prob)) p += prob as number;
  }
  return p;
}
