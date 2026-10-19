import { describe, expect, it } from "vitest";
import { createJudge } from "../src/judge.js";
import {
  AUTO_REPLY_MIN,
  decideInboundAction,
  inboundDecision,
  inboundScreenGate,
  inboundState,
  INJECTION_HOLD_AT,
} from "../src/gates/inbound-screen.js";
import { choiceAnswer, fakeClient, noulAnswer } from "./helpers.js";

const intents = (p: Partial<Record<string, number>>) =>
  choiceAnswer({ ad_inquiry: 0, negotiation: 0, complaint: 0, opt_out: 0, spam_phishing: 0, legal: 0, other: 0, ...p });

describe("decideInboundAction", () => {
  it("auto-replies only to a confident sales email with no injection signal", () => {
    const d = decideInboundAction({ intent: intents({ ad_inquiry: 0.5, negotiation: 0.3, other: 0.2 }), injection: noulAnswer(0.05) });
    expect(d).toMatchObject({ action: "auto_reply", pSales: 0.8, pInjection: 0.05 });
  });
  it("holds with an alert on an injection signal, even for a sales email", () => {
    const d = decideInboundAction({ intent: intents({ ad_inquiry: 0.95, other: 0.05 }), injection: noulAnswer(INJECTION_HOLD_AT) });
    expect(d).toMatchObject({ action: "hold", reason: "possible_injection", alert: true });
  });
  it("holds silently on confident spam", () => {
    const d = decideInboundAction({ intent: intents({ spam_phishing: 0.9, other: 0.1 }), injection: noulAnswer(0) });
    expect(d).toMatchObject({ action: "hold", reason: "spam", alert: false });
  });
  it("holds with an alert on anything else, naming the intent", () => {
    const d = decideInboundAction({ intent: intents({ legal: 0.7, other: 0.3 }), injection: noulAnswer(0) });
    expect(d).toMatchObject({ action: "hold", reason: "intent:legal", alert: true });
    const low = decideInboundAction({ intent: intents({ ad_inquiry: AUTO_REPLY_MIN - 0.01, other: 0.31 }), injection: noulAnswer(0) });
    expect(low).toMatchObject({ action: "hold", reason: "intent:ad_inquiry" });
  });
  it("holds when the screen was unavailable or the injection probability is NaN", () => {
    expect(decideInboundAction(null)).toMatchObject({ action: "hold", reason: "screen_unavailable", alert: true });
    const d = decideInboundAction({ intent: intents({ ad_inquiry: 1 }), injection: noulAnswer(Number.NaN) });
    expect(d).toMatchObject({ action: "hold", reason: "possible_injection" });
  });
});

describe("inboundScreenGate", () => {
  const email = { fromName: "A", fromEmail: "a@x.com", subject: "Ad rates?", body: "b".repeat(10_000), knownSender: false };
  const inbox = { name: "Example Weekly", purpose: "sales inbox; replies with a rate card" };

  it("truncates the body and labels sender history", () => {
    const s = inboundState(email, inbox);
    expect(s.email.body).toHaveLength(6_000);
    expect(s.email.senderHistory).toBe("first contact");
  });

  it("is fail-closed end to end: unavailable judge means hold", async () => {
    const res = await inboundScreenGate.runOne(createJudge({ client: null, logger: null }), email, inbox);
    expect(res.policy).toBe("fail-closed");
    expect(inboundDecision(res)).toMatchObject({ action: "hold", reason: "screen_unavailable" });
  });

  it("decides from a judged result", async () => {
    const client = fakeClient({ answers: [{ intent: intents({ ad_inquiry: 0.9, other: 0.1 }), injection: noulAnswer(0.01) }] });
    const res = await inboundScreenGate.runOne(createJudge({ client, logger: null }), email, inbox);
    expect(inboundDecision(res)).toMatchObject({ action: "auto_reply" });
  });
});
