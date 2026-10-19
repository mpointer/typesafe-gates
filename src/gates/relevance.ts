/**
 * Subject relevance: how specifically is an item about a publication's
 * subject? One Score judgment per item on a fixed four-level rubric; code
 * owns the keep rule, so the threshold is a number you can tune instead of
 * prompt wording you can only hope has the intended effect.
 *
 * Provenance: this replaced "one LLM call per batch returning a JSON list of
 * indices to keep", which had three failure modes in production: the parse
 * could fail (a whole batch silently dropped), the model could soft-refuse
 * on adult beats (a polite decline parses as nothing), and there was no
 * signal for how relevant an item was. Policy: fail-open. Without a
 * judgment the caller keeps its previous path for the whole batch.
 */
import { choice, score, type ChoiceResponse, type ScoreResponse } from "@typesafe-ai/sdk";
import { defineGate } from "../gate.js";
import { probabilityAtLeast } from "../probability.js";
import { probabilityThreshold, rankIndices } from "../threshold.js";

export interface Subject {
  /** The subject's name, for example a band, a field, or a cause. */
  name: string;
  /** One line on what the subject is. Required context: a bare name makes a
   * model guess what the subject is. */
  about?: string | null;
  /** How to read the name: a topic, a named entity, or an adult beat. */
  kind?: "topic" | "entity" | "adult";
}

export interface RelevanceItem {
  kind: string;
  title: string;
  excerpt?: string | null;
  source?: string | null;
}

export const SUBJECT_KIND: Record<NonNullable<Subject["kind"]>, string> = {
  topic: "a subject area (a hobby, field, industry, or cause), not a place",
  entity: "a specific named subject (a band, show, team, brand, or creator), not a place or a general topic",
  adult:
    "an adult-oriented beat for an age-gated 18+ publication (adult-industry business, the creator economy, platform policy, or an adult community), not a place",
};

/** Levels are concrete situations that stand on their own. Index = score. */
export const RELEVANCE_LEVELS = [
  "Unrelated: no real connection to the publication's subject. It only surfaced from a broad keyword search or a general feed, for example a generic business meetup, an unrelated online class, a listing from an unrelated organization, or news about unrelated people.",
  "Same broad category only: shares a general field, industry, or genre with the subject but is not about the subject or its specific niche, for example general science news for a physics publication, general business news for a cannabis-industry publication, or pop-music news about other artists for a band's publication.",
  "Same specific niche: substantively about the subject's own specific practice, craft, beat, or world, for example other creators doing the exact same thing, developments or trends specific to that niche, or work squarely inside the field, even if the subject is never named.",
  "Directly about the subject: the item is about the subject itself, or is hosted, run, published, or produced by them, or is core news of the subject area.",
] as const;

/** Items at or above this level are "substantively relevant". Level 1 is
 * the tangential case the old prompts told the model to exclude. */
export const SUBSTANTIVE_LEVEL = 2;

export const RELEVANCE_QUESTION = score(
  {
    question:
      "How specifically is `item` about the subject of `publication` (described by `publication.subject`, `publication.about`, and `publication.kind`)?",
    guidance: [
      "Judge the item's actual content, not the reputation or type of its source: being famous, being a celebrity, or appearing in the same kind of publication is never a connection on its own.",
      "An item can be squarely about a subject area without naming it (quantum tunneling microscopy is physics news).",
      "Sharing a word with the subject's name is not a connection when the item is about something else.",
    ],
  },
  RELEVANCE_LEVELS,
);

export function subjectState(subject: Subject) {
  return {
    subject: subject.name,
    about: subject.about ?? null,
    kind: SUBJECT_KIND[subject.kind ?? "topic"],
  };
}

export function relevanceState(item: RelevanceItem, subject: Subject) {
  return {
    publication: subjectState(subject),
    item: {
      type: item.kind,
      title: item.title,
      excerpt: item.excerpt ? item.excerpt.slice(0, 500) : null,
      source: item.source ?? null,
    },
  };
}

export const DEFAULT_RELEVANCE_MIN_PROBABILITY = 0.5;

/** Keep threshold on P(level >= SUBSTANTIVE_LEVEL), from
 * `RELEVANCE_MIN_PROBABILITY`. */
export function relevanceMinProbability(env: Record<string, string | undefined> = process.env): number {
  return probabilityThreshold("RELEVANCE_MIN_PROBABILITY", DEFAULT_RELEVANCE_MIN_PROBABILITY, env);
}

export function substantiveProbability(res: Pick<ScoreResponse, "probabilities">): number {
  return probabilityAtLeast(res, SUBSTANTIVE_LEVEL);
}

/** Verdict: P(substantively relevant). Compare to `relevanceMinProbability()`. */
export const relevanceGate = defineGate({
  name: "relevance",
  policy: "fail-open",
  questions: { relevance: RELEVANCE_QUESTION },
  state: (item: RelevanceItem, subject: Subject) => relevanceState(item, subject),
  interpret: (answers) => substantiveProbability(answers.relevance),
});

// ── Source-level check ────────────────────────────────────────────────────────
// Validation proves a proposed feed is live, parses, and is recent, not that
// it is about the right subject. A bare name once let fabricated-but-real
// lyrics and music-chart sources through for a wellness creator: every one
// validated fine. This judges what the source actually publishes. The keep
// rule only rejects clearly unrelated sources: a broad-field outlet stays
// because the per-item gate drops its off-topic items, and rejecting it here
// would starve niche subjects whose real coverage is industry press.

export interface SourceEvidence {
  name: string;
  url: string;
  type: string;
  title?: string | null;
  description?: string | null;
  recentTitles?: string[];
}

export const SOURCE_RELEVANCE_LEVELS = [
  "Unrelated: the source covers other subjects entirely. Nothing in its name, description, or recent output concerns the publication's subject or its wider field (for example a lyrics or music-chart site for a wellness creator, a sports blog for a physics publication, an unrelated company's news page).",
  "Same broad field: a general outlet in the subject's wider field, industry, or genre whose output only sometimes touches the subject's specific niche.",
  "Niche outlet: regularly covers the subject's specific niche, practice, or world.",
  "Dedicated: the subject's own site, channel, or feed, or an outlet devoted to the subject itself.",
] as const;

export const SOURCE_RELATED_LEVEL = 1;

export const SOURCE_RELEVANCE_QUESTION = score(
  {
    question:
      "How closely does `source` cover the subject of `publication` (described by `publication.subject`, `publication.about`, and `publication.kind`)?",
    guidance: [
      "Judge mainly from what the source actually publishes: `source.recentTitles` and `source.description` when present. Use its name and URL only as supporting evidence.",
      "A name match alone is not a connection: a site about a different person, band, or thing that shares the subject's name is unrelated.",
      "A subject area can be covered without naming it (a feed of quantum-optics papers covers physics).",
    ],
  },
  SOURCE_RELEVANCE_LEVELS,
);

export function sourceState(ev: SourceEvidence, subject: Subject) {
  return {
    publication: subjectState(subject),
    source: {
      name: ev.name,
      url: ev.url,
      type: ev.type,
      title: ev.title?.slice(0, 200) || null,
      description: ev.description?.slice(0, 500) || null,
      recentTitles: (ev.recentTitles ?? []).slice(0, 12).map((t) => t.slice(0, 200)),
    },
  };
}

export const DEFAULT_SOURCE_RELEVANCE_MIN_PROBABILITY = 0.5;

export function sourceRelevanceMinProbability(env: Record<string, string | undefined> = process.env): number {
  return probabilityThreshold("SOURCE_RELEVANCE_MIN_PROBABILITY", DEFAULT_SOURCE_RELEVANCE_MIN_PROBABILITY, env);
}

export interface SourceVerdict {
  /** P(level >= SOURCE_RELATED_LEVEL). Keep when at or above the threshold. */
  pRelated: number;
  /** Expected level 0 to 3, worth storing for later tuning. */
  level: number;
}

export const sourceRelevanceGate = defineGate({
  name: "source_relevance",
  policy: "fail-open",
  questions: { relevance: SOURCE_RELEVANCE_QUESTION },
  state: (ev: SourceEvidence, subject: Subject) => sourceState(ev, subject),
  interpret: (answers): SourceVerdict => ({
    pRelated: probabilityAtLeast(answers.relevance, SOURCE_RELATED_LEVEL),
    level: answers.relevance.score,
  }),
});

// ── Select instead of generate ────────────────────────────────────────────────
// A generator model used to receive the whole candidate batch and both pick
// the top ten and write their summaries. Here the per-item request the
// relevance gate already makes also asks how newsworthy the item is and which
// section it belongs in (independent questions over the same state ride in
// one request). Code picks the ten, the ranking is auditable, categories are
// always valid labels, and the generator's prompt shrinks to ten items.

export const NEWSWORTHINESS_LEVELS = [
  "Filler: not news for readers. Promotional or SEO copy, an ad, a job posting, a coupon, listicle bait, stale evergreen content, or a roundup with nothing new.",
  "Minor: a small or routine update most readers following this subject would skim past.",
  "Solid: a real, concrete development readers following this subject would want to know about.",
  "Major: significant, timely news. A big announcement, decision, release, result, or change with clear impact on this subject's audience.",
] as const;

export const NEWSWORTHINESS_QUESTION = score(
  {
    question: "How newsworthy is `item` for readers of `publication` right now?",
    guidance: [
      "Judge significance, timeliness, and concreteness, not how closely it matches the subject (that is judged separately).",
      "A substantive explainer or analysis can be Solid; a press release with no new facts is Filler or Minor.",
    ],
  },
  NEWSWORTHINESS_LEVELS,
);

export interface CandidateVerdict<Category extends string> {
  pRelevant: number;
  /** Expected newsworthiness level 0 to 3. */
  newsworthiness: number;
  pFiller: number;
  category: Category;
}

/** Filler this likely is dropped even when on-subject. */
export const MAX_FILLER_PROBABILITY = 0.5;

/**
 * Build the three-question candidate gate for your own section labels.
 * `categories` maps each label to a one-line description; `fallback` is the
 * label used if the model returns something outside the list.
 */
export function candidateGate<const C extends Record<string, string>>(categories: C, fallback: keyof C & string) {
  const labels = Object.keys(categories) as Array<keyof C & string>;
  return defineGate({
    name: "candidate",
    policy: "fail-open",
    questions: {
      relevance: RELEVANCE_QUESTION,
      newsworthiness: NEWSWORTHINESS_QUESTION,
      category: choice("Which section of `publication` does `item` belong in?", categories),
    },
    state: (item: RelevanceItem, subject: Subject) => relevanceState(item, subject),
    interpret: (answers): CandidateVerdict<keyof C & string> => {
      const cat = (answers.category as ChoiceResponse<C>).choice;
      return {
        pRelevant: substantiveProbability(answers.relevance),
        newsworthiness: answers.newsworthiness.score,
        pFiller: 1 - probabilityAtLeast(answers.newsworthiness, 1),
        category: labels.includes(cat) ? cat : fallback,
      };
    },
  });
}

/** Indices to publish, best first: relevant, not likely filler, ranked by
 * newsworthiness then relevance. Fewer than `limit`, even zero, is valid. */
export function rankCandidates<C extends string>(
  verdicts: readonly CandidateVerdict<C>[],
  threshold: number,
  limit = 10,
): number[] {
  return rankIndices(verdicts, (v) => v.newsworthiness * 10 + v.pRelevant, {
    limit,
    keep: (v) => v.pRelevant >= threshold && v.pFiller < MAX_FILLER_PROBABILITY,
  });
}
