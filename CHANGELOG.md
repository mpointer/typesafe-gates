# Changelog

## Unreleased

- **Breaking:** requires Node.js >= 22.12 (was >= 20). Node 20 is end of
  life, and the test toolchain (vitest 5) no longer supports it.

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
