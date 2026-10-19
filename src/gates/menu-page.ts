/**
 * Is this page a restaurant's food or drink menu? One yes/no question per
 * fetched page.
 *
 * Provenance: a heuristic pre-classifier confirmed any page scoring 70 or
 * more without a model call. An audit of 371 confirmed pages found that band
 * about 59% right: chain location pages, ordering-app shells, and venue
 * pages with no menu text were confirmed, extracted nothing, and kept
 * burning fetches. Jev agreed with the extraction outcome about 87% of the
 * time and, at a 0.4 threshold, would have kept 144 of 147 pages that did
 * extract while dropping 77 of 101 that came back empty. At Jev's price it
 * is cheap enough to judge every candidate. Policy: fail-open; an outage
 * never rejects pages.
 */
import { noul } from "@typesafe-ai/sdk";
import { defineGate } from "../gate.js";
import { probabilityThreshold } from "../threshold.js";

/** Menu signal shows up early; capping keeps requests small and cheap. */
export const MENU_PAGE_MAX_CHARS = 8_000;
export const DEFAULT_MENU_MIN_PROBABILITY = 0.4;

export const MENU_QUESTION = noul(
  "Is `page.text` a restaurant's food or drink menu page: does it present dishes, drinks or specials that the venue serves (`page.venue`)?",
  {
    true: "Lists or describes specific food or drink items the venue serves, with or without prices, including a short menu, a drinks-only list, a specials board, or a page for a single dish or product on the venue's ordering site.",
    false:
      "Not a menu: a homepage or about page that only mentions food in passing, a login or ordering app shell, an events or reservations page, a gift-card or catering inquiry form, navigation or footer text, or an error page.",
  },
);

export interface MenuPage {
  venue: string;
  url: string;
  text: string;
}

export function menuMinProbability(env: Record<string, string | undefined> = process.env): number {
  return probabilityThreshold("MENU_MIN_PROBABILITY", DEFAULT_MENU_MIN_PROBABILITY, env);
}

export function menuState(page: MenuPage) {
  return { page: { venue: page.venue, url: page.url, text: page.text.slice(0, MENU_PAGE_MAX_CHARS) } };
}

/** Verdict: P(page is a menu). */
export const menuPageGate = defineGate({
  name: "menu_classify",
  policy: "fail-open",
  questions: { is_menu: MENU_QUESTION },
  state: (page: MenuPage, _ctx: void) => menuState(page),
  interpret: (answers) => answers.is_menu.noul,
});
