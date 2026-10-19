# typesafe-gates

Decision gates for LLM pipelines, built on [TypeSafe AI](https://typesafe.ai)'s
System One (Jev). A gate asks Jev one or more typed questions about each item
(a Score on a fixed rubric, a Choice from fixed labels, or a yes/no), gets back
a probability table instead of free text, and lets *your code* own the keep
rule, the threshold, and what happens when the judge is unavailable.

```ts
import { createJudge, verdictsOrNull } from "typesafe-gates";
import { relevanceGate, relevanceMinProbability } from "typesafe-gates/gates";

const judge = createJudge({ recordUsage: (r) => db.insert(aiUsage).values(r) });

const result = await relevanceGate.run(judge, items, {
  name: "Example Band",
  about: "a four-piece indie rock band from Pittsburgh",
  kind: "entity",
});

const probabilities = verdictsOrNull(result); // null when Jev was unavailable
const kept = probabilities
  ? items.filter((_, i) => probabilities[i]! >= relevanceMinProbability())
  : items; // fail-open: keep the previous path for the whole batch
```

Every gate in this package came out of a production newsletter platform where
"ask Claude to return the indices to keep" had three failure modes: the parse
could fail (a whole batch silently dropped), the model could soft-refuse (a
polite decline parses as nothing), and there was no signal for *how* relevant
an item was, so a threshold was prompt wording instead of a number.

## Install

```sh
npm install typesafe-gates @typesafe-ai/sdk
```

`@typesafe-ai/sdk` is a peer dependency (0.6 or later). Set `TYPESAFE_API_KEY`,
or pass your own client to `createJudge`.

## What a gate is

```ts
import { noul } from "@typesafe-ai/sdk";
import { defineGate } from "typesafe-gates";

export const spamGate = defineGate({
  name: "spam_screen",
  policy: "fail-closed",
  questions: {
    spam: noul("Is `message` unsolicited bulk mail to `inbox`?", {
      true: "bulk, automated, or scam mail",
      false: "written by a person to this inbox",
    }),
  },
  state: (message: string, inbox: string) => ({ message: message.slice(0, 4000), inbox }),
  interpret: (answers) => answers.spam.noul, // P(spam)
});
```

A gate declares four things:

- **questions**: SDK question builders (`score`, `choice`, `noul`). Several
  independent questions over the same state ride in one request.
- **state**: the evidence for one item. Keep it small and explicit. A bare name
  makes a model guess what the subject is; a 50 KB thread bills in full for a
  judgment that needed its first 6 KB.
- **interpret**: a pure function from one answer set to the verdict your code
  uses. This is where "P(level ≥ 2)" or "P(ad_inquiry) + P(negotiation)" lives.
- **policy**: `fail-open` or `fail-closed`. Declared, not inferred, because
  the two cases have opposite safe defaults.

`gate.run(judge, inputs, context)` returns either
`{ status: "judged", verdicts, model, usage, policy }` or
`{ status: "unavailable", reason, error?, usage, policy }` with `reason` one of
`no_client`, `request_failed`, `over_budget`, `aborted`. Three helpers cover
the common shapes: `verdictsOrNull` (fail-open), `verdictOrNull` (one item),
`verdictsOr(result, reason => fallback)` (fail-closed).

## The judge

`createJudge(config)` returns a function that asks the same questions of every
state, one request per state, concurrently (default 8), answers in input
order.

- **One request per item.** Batching items into one state lets them bleed
  into each other's judgments. The judge never does that.
- **All-or-nothing.** If any request fails, the rest are aborted and the whole
  invocation is `unavailable`. One outage never mixes two judges' standards
  (Jev for half the batch, a fallback for the other half) inside a single
  decision.
- **Time budget.** `budgetMs` aborts everything in flight and returns
  `over_budget`. Use it on request-path gates (a webhook with a 20 s limit).
- **Usage accounting.** `recordUsage` receives one record per invocation with
  tokens, request count, estimated cost, task name, model, and `failed`. It is
  called even when the invocation failed, because tokens spent before a
  failure were billed. A throwing recorder is logged and swallowed: telemetry
  never fails a gate.
- **No client, no judgment.** With `TYPESAFE_API_KEY` unset the judge returns
  `no_client`. It never decides what that means for a gate.

## Thresholds

`thresholdFromEnv` and `probabilityThreshold` read a number from an
environment variable with a validated fallback: garbage, out-of-range, a
non-integer where an integer is required, or a probability of exactly 0 all
fall back to the default rather than silently disabling the gate. A gate can
be loosened or tightened without a deploy.

`probabilityAtLeast`, `probabilityAtMost`, `expectedLevel`, `probabilityOf`
read Score and Choice probability tables. `rankIndices` and `keptIndices`
turn verdicts into an ordered selection; `NaN` is never kept.

## Reference gates (`typesafe-gates/gates`)

Each one shipped in production and carries the numbers from the audit that
motivated it. Rubrics are generic; put your own subject or community in the
context argument.

| Gate | Questions | Policy | Env knob (default) |
|---|---|---|---|
| `relevanceGate` | Score, 4 levels: unrelated / same broad category / same niche / directly about | fail-open | `RELEVANCE_MIN_PROBABILITY` (0.5) on P(level ≥ 2) |
| `sourceRelevanceGate` | Score, 4 levels, judged from a feed's recent titles | fail-open | `SOURCE_RELEVANCE_MIN_PROBABILITY` (0.5) on P(level ≥ 1) |
| `candidateGate(categories, fallback)` | relevance + newsworthiness (Score) + category (Choice) in one request; `rankCandidates` picks the top N | fail-open | as above; filler dropped at P ≥ 0.5 |
| `localityGate` | Score, 4 levels: not local / statewide / nearby / hyperlocal; `pickLocalFirst` builds a local-first pool | fail-open | `LOCALITY_MIN_PROBABILITY` (0.5), `LOCALITY_POOL_TARGET` (12, 8 to 30), `SOURCE_LOCALITY_MIN_LEVEL` (0.5) |
| `menuPageGate` | yes/no: is this page a restaurant's menu | fail-open | `MENU_MIN_PROBABILITY` (0.4) |
| `inboundScreenGate` | intent (Choice, 7 labels) + AI-directed-instruction injection (yes/no); `decideInboundAction` is the policy table | **fail-closed** | fixed: hold at P(injection) ≥ 0.3, auto-reply at P(sales) ≥ 0.7, silent spam at ≥ 0.8 |
| `factCheckGate` | unsupported + contradicts + personal (three yes/no) per section against the evidence the writer was given | fail-open | `FACT_CHECK_MIN_PROBABILITY` (0.7); contradicts at 0.5; personal note at 0.8 |

Provenance, briefly:

- **Relevance**: replaced a batch "return the indices to keep" prompt; the
  source-level check exists because a bare name once let real but unrelated
  lyrics and music-chart sources through validation for a wellness creator.
- **Locality**: a 14-day audit found 36% of one town's and 23% of another's
  saved articles were statewide or farther, under a prompt that asked for
  "hyperlocal". Policy: local first, statewide only as filler, rank rather
  than hard-drop.
- **Menu page**: a heuristic that confirmed pages scoring ≥ 70 was about 59%
  right over 371 pages. Jev agreed with the extraction outcome about 87% of
  the time; at 0.4 it would have kept 144 of 147 pages that extracted and
  dropped 77 of 101 that came back empty.
- **Inbound screen**: an auto-responder was acting on any sender's raw email.
  The screen runs before anything is stored, and an outage holds instead of
  sending, because the send is the irreversible action.
- **Fact check**: a backtest over 148 generated issues found embellished
  specifics at a low but real rate and invented first-person anecdotes in
  about 18% of blocks. Precision at 0.7 was roughly half, so it is a
  reviewer's pointer, not an auto-publish gate, until calibrated against
  review decisions.

## Cost

Jev's published rate at launch is $0.042 per million input tokens, output
free (`JEV_RATES`). A relevance judgment on a title plus a 500-character
excerpt is a few hundred tokens, so judging every candidate item is cheaper
than one generator call over a batch. Override `rates` in `createJudge` when
the price changes.

## Testing your gates

The judge takes any object with a compatible `systemOne` method, so tests
never touch the network. The package's own tests (`test/helpers.ts`) show a
fake client that honours abort signals, injects failures per call, and adds
latency.

## Design notes

- A probability table from a fixed rubric beats free text because the keep
  rule is a comparison, not a parse.
- Thresholds live in code and env, never in prompt wording.
- A gate's policy is part of its definition. Reading "what happens when the
  judge is down" out of a call site is how an outage silently publishes
  everything or silently holds everything.
- Store the expected level, not just the keep decision. Every threshold above
  was set from a stored score distribution, not from guesswork.

## License

MIT
