/**
 * Fact check of generated prose against the evidence the writer was given.
 * Three yes/no questions per section, asked together in one request:
 * unsupported (reports a fact absent from the evidence), contradicts (says
 * something the evidence disagrees with), personal (asserts the writer's
 * own experience as fact).
 *
 * Provenance: a backtest over 148 generated issues found embellished
 * specifics at a low but real rate and invented first-person anecdotes in
 * about 18% of blocks. Precision at the 0.7 flag threshold was roughly
 * half, so this is a reviewer's pointer, not an auto-publish gate, until it
 * is calibrated against review decisions. Policy: fail-open; nothing is
 * blocked or edited, and an outage stores the draft unverified.
 */
import { noul } from "@typesafe-ai/sdk";
import { defineGate } from "../gate.js";
import { probabilityThreshold } from "../threshold.js";

export const UNSUPPORTED_QUESTION = noul(
  "Does `block.text` report any fact about the news itself (who did what, when, where, how many, what was decided or found) that does not appear in any of the `evidence` items?",
  {
    true: "A claim about the reported event or finding was added, embellished, or changed relative to the evidence. Example: a vote count, a named person, a quoted line, a date, or a result that the evidence never states.",
    false:
      "Everything the text reports about the news is in the evidence. Ignore the writer's own commentary entirely: opinions, jokes, advice, recommendations, rhetorical remarks, personal anecdotes or memories, local color, scene-setting, greetings and sign-offs are not reports about the news and never make this true. Paraphrasing and light reordering of evidence is fine.",
  },
);

export const CONTRADICTS_QUESTION = noul(
  "Does `block.text` say something that conflicts with the `evidence` (a different number, date, name, or outcome than the evidence gives)?",
  {
    true: "A claim directly disagrees with what the evidence says.",
    false: "Nothing in the text disagrees with the evidence; claims are either consistent or simply not covered.",
  },
);

export const PERSONAL_QUESTION = noul(
  "Does `block.text` assert a personal experience, memory, relationship, or first-hand observation of the writer as fact (for example 'my grandfather...', 'I was there when...', 'you could smell the fries from three blocks off')?",
  {
    true: "States something the writer personally experienced, remembers, or observed.",
    false: "No first-person experience or first-hand observation is asserted; at most a general opinion or recommendation.",
  },
);

/** Any JSON-serializable evidence item: what the writer was actually given,
 * since only that can support a claim. */
export type EvidenceItem = Record<string, string | number | boolean | null>;

export interface Section {
  title: string;
  text: string;
}

export interface SectionVerdict {
  unsupported: number;
  contradicts: number;
  personal: number;
}

export const DEFAULT_UNSUPPORTED_THRESHOLD = 0.7;
export const CONTRADICTS_THRESHOLD = 0.5;
export const PERSONAL_NOTE_THRESHOLD = 0.8;
/** Greetings and sign-offs have nothing to verify. */
export const MIN_SECTION_CHARS = 120;

export function unsupportedThreshold(env: Record<string, string | undefined> = process.env): number {
  return probabilityThreshold("FACT_CHECK_MIN_PROBABILITY", DEFAULT_UNSUPPORTED_THRESHOLD, env);
}

export function isFlagged(v: Pick<SectionVerdict, "unsupported" | "contradicts">, threshold: number): boolean {
  return v.unsupported >= threshold || v.contradicts >= CONTRADICTS_THRESHOLD;
}

export function flagReason(v: SectionVerdict, threshold: number): string {
  const parts: string[] = [];
  if (v.contradicts >= CONTRADICTS_THRESHOLD) parts.push("may contradict its sources");
  if (v.unsupported >= threshold) parts.push("may include details its sources don't state");
  return parts.join("; ");
}

/** Indices of the sections worth verifying: body copy with enough text. */
export function verifiableIndices(sections: readonly Section[], minChars = MIN_SECTION_CHARS): number[] {
  return sections
    .map((s, i) => ({ s, i }))
    .filter(({ s }) => s.text.trim().length >= minChars)
    .map(({ i }) => i);
}

export const factCheckGate = defineGate({
  name: "fact_check",
  policy: "fail-open",
  questions: { unsupported: UNSUPPORTED_QUESTION, contradicts: CONTRADICTS_QUESTION, personal: PERSONAL_QUESTION },
  state: (section: Section, evidence: readonly EvidenceItem[]) => ({
    block: { text: `${section.title}\n\n${section.text}` },
    evidence: [...evidence],
  }),
  interpret: (answers): SectionVerdict => ({
    unsupported: answers.unsupported.noul,
    contradicts: answers.contradicts.noul,
    personal: answers.personal.noul,
  }),
});
