/**
 * Focus group configuration for the preview feedback round.
 *
 * Pure constants — safe to import from both client and server code.
 */

/** Identifier for the current feedback round; namespaces localStorage keys. */
export const FOCUS_GROUP_ROUND = "round-1";

/** ISO date the round opens; null means no open gate. */
export const OPEN_DATE: string | null = null;

/** ISO date the round closes; null means no close gate. */
export const CLOSE_DATE: string | null = null;

/** Maximum number of automatic prompts shown per device per round. */
export const MAX_AUTO_PROMPTS = 2;

/** Maximum length of a free-text response (mirrors the DB CHECK constraint). */
export const MAX_TEXT_LENGTH = 2000;

/** Routes where focus group prompts are never shown. */
export const HIDDEN_ROUTES: ReadonlySet<string> = new Set([
  "/about",
  "/terms",
  "/privacy",
]);

/** Prompt key used for gate/window checks rather than a real question. */
export const TEST_KEY = "TEST_gate_check";

/** One focus group question definition. */
export interface FocusGroupQuestion {
  id: string;
  text: string;
  options?: string[];
  multi?: boolean;
  freeTextLabel?: string;
  freeTextOnly?: boolean;
  repeatable?: boolean;
}

const FEATURE_OPTIONS = [
  "Weather",
  "River gauge",
  "Tides",
  "Alerts",
  "Bacteria level",
  "Trip planner",
  "Adding my own sites",
];

/** The round-1 question set, in display order. */
export const QUESTIONS: FocusGroupQuestion[] = [
  {
    id: "use_before_trip",
    text: "Of what the app shows now, which would you actually use before a trip?",
    options: FEATURE_OPTIONS,
    multi: true,
  },
  {
    id: "matters_most",
    text: "Which one matters most?",
    options: FEATURE_OPTIONS,
  },
  {
    id: "unclear_or_trust",
    text: "Was anything unclear, or hard to trust?",
    freeTextOnly: true,
  },
  {
    id: "add_one_thing",
    text: "If we could add one thing, which would change whether your community uses this?",
    options: [
      "Wind forecast",
      "Water access details",
      "Camping and shuttle info",
      "Barometric pressure",
      "Storm risk",
      "Same-day photos or video",
      "Difficulty or suitability level",
      "Other",
    ],
    freeTextLabel: "Why that one?",
  },
  {
    id: "would_share",
    text: "Would your organization share this with your community?",
    options: ["Yes", "Maybe", "No"],
    freeTextLabel: "What would need to be true?",
  },
  {
    id: "answering_for",
    text: "Who are you answering for?",
    options: [
      "Paddlers",
      "Anglers",
      "Swimmers",
      "Rowing or crew",
      "Youth or education programs",
      "Organization or program",
      "Other",
    ],
  },
  {
    id: "check_today",
    text: "Before someone in your community gets on the water today, what do they check, and where?",
    freeTextOnly: true,
  },
  {
    id: "data_we_should_show",
    text: "Do you collect, or know of, data we should be showing?",
    freeTextOnly: true,
  },
  {
    id: "comments",
    text: "Any other comments?",
    freeTextOnly: true,
    repeatable: true,
  },
];
