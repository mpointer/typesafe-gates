import { describe, expect, it } from "vitest";
import { noul } from "@typesafe-ai/sdk";
import { defineGate, verdictOrNull, verdictsOr, verdictsOrNull } from "../src/gate.js";
import { createJudge } from "../src/judge.js";
import { fakeClient, noulAnswer } from "./helpers.js";

const gate = defineGate({
  name: "spam",
  task: "spam_screen",
  policy: "fail-closed",
  questions: { spam: noul("Is `text` spam for `inbox`?", { true: "spam", false: "not spam" }) },
  state: (text: string, inbox: string) => ({ text, inbox }),
  interpret: (answers, text) => ({ text, pSpam: answers.spam.noul }),
});

describe("defineGate", () => {
  it("builds states from inputs and context, judges them, and interprets each answer", async () => {
    const client = fakeClient({ answers: [{ spam: noulAnswer(0.9) }, { spam: noulAnswer(0.1) }] });
    const judge = createJudge({ client, logger: null });
    const res = await gate.run(judge, ["buy now", "hello"], "sales@x");
    expect(res.status).toBe("judged");
    if (res.status !== "judged") return;
    expect(res.policy).toBe("fail-closed");
    expect(res.verdicts).toEqual([
      { text: "buy now", pSpam: 0.9 },
      { text: "hello", pSpam: 0.1 },
    ]);
    expect(client.calls[0]!.state).toEqual({ text: "buy now", inbox: "sales@x" });
    expect(gate.task).toBe("spam_screen");
  });

  it("carries the policy on an unavailable result and the helpers pick the fallback", async () => {
    const judge = createJudge({ client: null, logger: null });
    const res = await gate.run(judge, ["a", "b"], "inbox");
    expect(res.status).toBe("unavailable");
    expect(res.policy).toBe("fail-closed");
    expect(verdictsOrNull(res)).toBeNull();
    expect(verdictOrNull(res)).toBeNull();
    expect(verdictsOr(res, (reason) => [{ text: reason, pSpam: 1 }])).toEqual([{ text: "no_client", pSpam: 1 }]);
  });

  it("runOne judges a single input", async () => {
    const client = fakeClient({ answers: [{ spam: noulAnswer(0.4) }] });
    const res = await gate.runOne(createJudge({ client, logger: null }), "hi", "inbox");
    expect(verdictOrNull(res)).toEqual({ text: "hi", pSpam: 0.4 });
    expect(client.systemOne).toHaveBeenCalledOnce();
  });
});
