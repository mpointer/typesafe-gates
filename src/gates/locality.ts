/**
 * Locality: how local is an item to a place? One Score per item on a
 * four-level rubric, so code decides what a curator may choose from.
 *
 * Provenance: a curation prompt asked for "the most relevant, interesting,
 * and hyperlocal stories" and nothing enforced it. A 14-day audit scored 36%
 * of one Pennsylvania town's saved articles and 23% of another's as
 * statewide or farther. The policy that replaced it: local first, statewide
 * only as filler when local news is thin, rank rather than hard-drop.
 * Policy: fail-open.
 */
import { score, type ScoreResponse } from "@typesafe-ai/sdk";
import { defineGate } from "../gate.js";
import { expectedLevel, probabilityAtLeast } from "../probability.js";
import { probabilityThreshold, thresholdFromEnv } from "../threshold.js";

export const LOCALITY_LEVELS = [
  "Not local: about a place or subject far from the community. Another state or country, or national or world news with no particular tie to the community's area.",
  "Statewide or broad regional: about the state or a large region (for example statewide politics, policy, weather, or statewide sports) with no specific connection to the community or its county.",
  "Nearby: about a neighboring town or county within roughly an hour's drive, or a statewide or regional story that clearly and directly affects residents of the community's area.",
  "Hyperlocal: about the community itself, its county, its institutions, businesses, schools, teams, events, or residents.",
] as const;

export const NEARBY_LEVEL = 2;

export const LOCALITY_QUESTION = score(
  {
    question: "How local is `item` to the community described by `community` (its `name` and `state`)?",
    guidance: [
      "Judge where the story happens and whom it concerns, not the source's reputation: a statewide outlet can publish a hyperlocal story and a local outlet can republish a distant one.",
      "A named town or school in the item that is not the community, its county, or an immediate neighbor places the story elsewhere.",
    ],
  },
  LOCALITY_LEVELS,
);

export interface LocalityItem {
  title: string;
  source?: string | null;
  excerpt?: string | null;
}

export interface Community {
  name: string;
  state?: string | null;
  /** `city`, `region`, or `state`. */
  scope?: string | null;
}

export interface LocalityVerdict {
  /** Probability-weighted level, 0 to 3. */
  expected: number;
  /** P(level >= NEARBY_LEVEL). */
  pLocal: number;
}

const EXCERPT_CHARS = 400;

export function localityState(item: LocalityItem, community: Community) {
  return {
    community: { name: community.name, state: community.state ?? "", scope: community.scope ?? "city" },
    item: { title: item.title, source: item.source ?? "", summary: (item.excerpt ?? "").slice(0, EXCERPT_CHARS) },
  };
}

export function localityVerdict(res: Pick<ScoreResponse, "probabilities">): LocalityVerdict {
  return { expected: expectedLevel(res), pLocal: probabilityAtLeast(res, NEARBY_LEVEL) };
}

export const localityGate = defineGate({
  name: "locality",
  policy: "fail-open",
  questions: { locality: LOCALITY_QUESTION },
  state: (item: LocalityItem, community: Community) => localityState(item, community),
  interpret: (answers) => localityVerdict(answers.locality),
});

export const DEFAULT_LOCALITY_MIN_PROBABILITY = 0.5;
/** Pool size a curator picks from. Below 8 it cannot fill ten; above 30
 * filler outnumbers local items on a thin day. */
export const DEFAULT_LOCAL_POOL_TARGET = 12;
/** Filler is only drawn from items that are at least statewide-ish. Other
 * states and national stories are never filler. */
export const MIN_FILLER_LEVEL = 1;

export function localityMinProbability(env: Record<string, string | undefined> = process.env): number {
  return probabilityThreshold("LOCALITY_MIN_PROBABILITY", DEFAULT_LOCALITY_MIN_PROBABILITY, env);
}

export function localPoolTarget(env: Record<string, string | undefined> = process.env): number {
  return thresholdFromEnv(
    { name: "LOCALITY_POOL_TARGET", default: DEFAULT_LOCAL_POOL_TARGET, min: 8, max: 30, integer: true },
    env,
  );
}

export interface LocalFirstPick<T> {
  /** Original order preserved. */
  items: T[];
  local: number;
  filler: number;
}

/** The local-first pool: every item at P(nearby or closer) >= threshold,
 * topped up to `target` with the next-most-local items that are at least
 * statewide-ish. A slow news day yields a smaller pool, not an off-topic one.
 * `verdicts[i]` must be the verdict for `items[i]`; when the gate was
 * unavailable, skip this and keep the previous path instead. */
export function pickLocalFirst<T>(
  items: readonly T[],
  verdicts: readonly LocalityVerdict[],
  opts: { target?: number; minProbability?: number } = {},
): LocalFirstPick<T> {
  if (verdicts.length !== items.length) {
    throw new RangeError(`pickLocalFirst: ${items.length} items but ${verdicts.length} verdicts`);
  }
  const target = opts.target ?? localPoolTarget();
  const threshold = opts.minProbability ?? localityMinProbability();
  const local = new Set<number>();
  items.forEach((_, i) => {
    if ((verdicts[i]?.pLocal ?? 0) >= threshold) local.add(i);
  });
  const filler = items
    .map((_, i) => i)
    .filter((i) => !local.has(i) && (verdicts[i]?.expected ?? 0) >= MIN_FILLER_LEVEL)
    .sort((a, b) => (verdicts[b]?.expected ?? 0) - (verdicts[a]?.expected ?? 0))
    .slice(0, Math.max(0, target - local.size));
  const keep = new Set([...local, ...filler]);
  return { items: items.filter((_, i) => keep.has(i)), local: local.size, filler: filler.length };
}

// ── Source-level check ────────────────────────────────────────────────────────
// Article scoring ranks what a source publishes; it does not stop a source
// from being added. One town's active sources included a San Francisco Bay
// Area TV feed (129 articles about San Jose) because discovery only checked
// that a feed parses and is fresh. Judging a feed's recent headlines with the
// same rubric catches that at the door: statewide outlets average about level
// 1, a feed from another state near 0, so a bar of 0.5 rejects only the
// clearly elsewhere.

export const DEFAULT_SOURCE_LOCALITY_MIN_LEVEL = 0.5;
export const SOURCE_SAMPLE_TITLES = 5;

export function sourceLocalityMinLevel(env: Record<string, string | undefined> = process.env): number {
  return thresholdFromEnv(
    { name: "SOURCE_LOCALITY_MIN_LEVEL", default: DEFAULT_SOURCE_LOCALITY_MIN_LEVEL, min: 0, max: 3 },
    env,
  );
}

/** Mean expected level over sampled headlines, or `null` with too few to
 * judge (a source with few headlines is not rejected on them). */
export function meanLocality(verdicts: readonly LocalityVerdict[], minSamples = 3): number | null {
  if (verdicts.length < minSamples) return null;
  return verdicts.reduce((sum, v) => sum + v.expected, 0) / verdicts.length;
}
