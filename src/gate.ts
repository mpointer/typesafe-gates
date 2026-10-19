import type { EntryType, Questions, SystemOneResult } from "@typesafe-ai/sdk";
import type { Judge, JudgeOptions, Unavailable, UnavailableReason } from "./judge.js";
import type { UsageTotals } from "./usage.js";

/**
 * What a gate does when the judge is unavailable. This is declared, not
 * inferred, because the two cases have opposite safe defaults:
 *
 * - `fail-open`: the gate filters or ranks; without it, keep everything and
 *   let the previous path decide. Losing a relevance check for one batch is
 *   recoverable. Dropping a whole batch because a judgment service was down
 *   is not what anyone meant.
 * - `fail-closed`: the gate guards an irreversible action (an automatic
 *   send, a payment, a publish). Without it, hold for a human. Acting on
 *   attacker-controlled input because the screen was down is the failure
 *   that cannot be undone.
 */
export type GatePolicy = "fail-open" | "fail-closed";

export interface GateSpec<Input, Context, Q extends Questions, Verdict> {
  name: string;
  /** Usage telemetry task name. Defaults to `name`. */
  task?: string;
  policy: GatePolicy;
  questions: Q;
  /** The evidence sent for one input. Keep it small and explicit: a bare
   * name makes a model guess what the subject is; a 50 KB thread bills in
   * full for a judgment that needed its first 6 KB. */
  state: (input: Input, context: Context) => EntryType;
  /** Turn one answer set into the gate's verdict for that input. Pure. */
  interpret: (answers: SystemOneResult<Q>["answers"], input: Input, context: Context) => Verdict;
}

export interface GateJudged<Verdict> {
  status: "judged";
  verdicts: Verdict[];
  model: string;
  usage: UsageTotals;
  policy: GatePolicy;
}

export interface GateUnavailable extends Unavailable {
  policy: GatePolicy;
}

export type GateResult<Verdict> = GateJudged<Verdict> | GateUnavailable;

export type GateRunOptions = Omit<JudgeOptions, "task"> & { task?: string };

export interface Gate<Input, Context, Q extends Questions, Verdict> {
  readonly name: string;
  readonly task: string;
  readonly policy: GatePolicy;
  readonly questions: Q;
  state(input: Input, context: Context): EntryType;
  interpret(answers: SystemOneResult<Q>["answers"], input: Input, context: Context): Verdict;
  /** Judge every input in one all-or-nothing invocation. */
  run(judge: Judge, inputs: readonly Input[], context: Context, opts?: GateRunOptions): Promise<GateResult<Verdict>>;
  /** Judge a single input. */
  runOne(judge: Judge, input: Input, context: Context, opts?: GateRunOptions): Promise<GateResult<Verdict>>;
}

export function defineGate<Input, Context, const Q extends Questions, Verdict>(
  spec: GateSpec<Input, Context, Q, Verdict>,
): Gate<Input, Context, Q, Verdict> {
  const task = spec.task ?? spec.name;
  const gate: Gate<Input, Context, Q, Verdict> = {
    name: spec.name,
    task,
    policy: spec.policy,
    questions: spec.questions,
    state: spec.state,
    interpret: spec.interpret,
    async run(judge, inputs, context, opts = {}) {
      const states = inputs.map((input) => spec.state(input, context));
      const result = await judge(states, spec.questions, { ...opts, task: opts.task ?? task });
      if (result.status === "unavailable") return { ...result, policy: spec.policy };
      return {
        status: "judged",
        verdicts: result.answers.map((answers, i) => spec.interpret(answers, inputs[i] as Input, context)),
        model: result.model,
        usage: result.usage,
        policy: spec.policy,
      };
    },
    async runOne(judge, input, context, opts) {
      return gate.run(judge, [input], context, opts);
    },
  };
  return gate;
}

/** Verdicts, or `null` when unavailable: the fail-open idiom. Callers keep
 * their previous path for the whole batch. */
export function verdictsOrNull<V>(result: GateResult<V>): V[] | null {
  return result.status === "judged" ? result.verdicts : null;
}

/** The single verdict of a `runOne`, or `null` when unavailable. */
export function verdictOrNull<V>(result: GateResult<V>): V | null {
  return result.status === "judged" ? (result.verdicts[0] ?? null) : null;
}

/** Verdicts, or what the fallback returns for the unavailable reason: the
 * fail-closed idiom, where the fallback is the conservative action (hold,
 * reject, route to a human) for every input. */
export function verdictsOr<V>(result: GateResult<V>, fallback: (reason: UnavailableReason) => V[]): V[] {
  return result.status === "judged" ? result.verdicts : fallback(result.reason);
}
