import { describe, expect, it } from "vitest";
import { createJudge } from "../src/judge.js";
import { factCheckGate, flagReason, isFlagged, unsupportedThreshold, verifiableIndices } from "../src/gates/fact-check.js";
import { MENU_PAGE_MAX_CHARS, menuMinProbability, menuPageGate, menuState } from "../src/gates/menu-page.js";
import { fakeClient, noulAnswer } from "./helpers.js";

describe("menu page gate", () => {
  it("caps page text and returns P(menu)", async () => {
    const page = { venue: "Cafe", url: "https://x/menu", text: "m".repeat(20_000) };
    expect(menuState(page).page.text).toHaveLength(MENU_PAGE_MAX_CHARS);
    const client = fakeClient({ answers: [{ is_menu: noulAnswer(0.83) }] });
    const res = await menuPageGate.runOne(createJudge({ client, logger: null }), page, undefined);
    expect(res.status).toBe("judged");
    if (res.status === "judged") expect(res.verdicts[0]).toBe(0.83);
    expect(menuMinProbability({})).toBe(0.4);
  });
});

describe("fact check gate", () => {
  it("skips short sections", () => {
    const sections = [{ title: "Hi", text: "Welcome back." }, { title: "News", text: "x".repeat(200) }];
    expect(verifiableIndices(sections)).toEqual([1]);
  });

  it("flags on unsupported or contradicting probabilities with a readable reason", () => {
    expect(isFlagged({ unsupported: 0.7, contradicts: 0 }, 0.7)).toBe(true);
    expect(isFlagged({ unsupported: 0.2, contradicts: 0.5 }, 0.7)).toBe(true);
    expect(isFlagged({ unsupported: 0.69, contradicts: 0.49 }, 0.7)).toBe(false);
    expect(flagReason({ unsupported: 0.9, contradicts: 0.6, personal: 0 }, 0.7)).toBe(
      "may contradict its sources; may include details its sources don't state",
    );
    expect(unsupportedThreshold({ FACT_CHECK_MIN_PROBABILITY: "0.5" })).toBe(0.5);
  });

  it("sends the section with its evidence and returns three probabilities", async () => {
    const client = fakeClient({
      answers: [{ unsupported: noulAnswer(0.8), contradicts: noulAnswer(0.1), personal: noulAnswer(0.9) }],
    });
    const evidence = [{ title: "Council votes 5-2", url: "https://x" }];
    const res = await factCheckGate.runOne(createJudge({ client, logger: null }), { title: "Council", text: "The council voted 6-1." }, evidence);
    expect(client.calls[0]!.state).toEqual({ block: { text: "Council\n\nThe council voted 6-1." }, evidence });
    expect(res.status).toBe("judged");
    if (res.status === "judged") expect(res.verdicts[0]).toEqual({ unsupported: 0.8, contradicts: 0.1, personal: 0.9 });
  });
});
