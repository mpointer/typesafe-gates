# Changelog

## Unreleased

- **Breaking:** requires Node.js >= 22.12 (was >= 20). Node 20 is end of
  life, and the test toolchain (vitest 5) no longer supports it.
- **Breaking:** `inboundScreenGate` holds mail longer than it screens
  (subject over 300 or body over 6,000 characters) with reason
  `too_long_to_screen`. Padding an email past the cut used to hide injected
  instructions from the screen while the responder still read them.
- **Breaking:** `concurrency` must be a positive integer; `0`, negative or
  `NaN` now throws a `RangeError` instead of returning `request_failed`
  with no error.
- **Breaking:** `pickLocalFirst` throws a `RangeError` when `verdicts` and
  `items` differ in length, instead of silently dropping the unmatched items.
- `recordUsage` is no longer awaited, so a slow or hung recorder cannot
  hold a gate past its `budgetMs`.
- `UsageRecord.durationMs`: wall-clock time of the invocation.
- Works with `@typesafe-ai/sdk` 0.7 (`null` token counts count as 0); CI
  now tests both 0.6.0 and the newest 0.x SDK.

## 0.1.0

First release. Extracted from a production newsletter platform.

- `createJudge`: one request per state, concurrent, answers in input order,
  all-or-nothing batches, time budget, outer abort signal, usage accounting
  with cost estimate, lazy client from `TYPESAFE_API_KEY`.
- `defineGate` with a declared `fail-open` or `fail-closed` policy;
  `verdictsOrNull`, `verdictOrNull`, `verdictsOr`.
- Probability helpers (`probabilityAtLeast`, `probabilityAtMost`,
  `expectedLevel`, `probabilityOf`) and threshold helpers
  (`thresholdFromEnv`, `probabilityThreshold`, `keptIndices`, `rankIndices`).
- Reference gates under `typesafe-gates/gates`: relevance, source relevance,
  candidate (select instead of generate), locality with `pickLocalFirst`,
  menu page, inbound screen with `decideInboundAction`, fact check.
