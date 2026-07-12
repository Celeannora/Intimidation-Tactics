/**
 * deckSchema.ts — Canonical structured-output schema for AI deck responses.
 *
 * All providers that support constrained JSON generation reuse this schema so
 * the model is forced to emit the exact `{summary, game_plan, main[], side[]}`
 * shape the parser expects, nearly eliminating parse failures and the regex
 * salvage fallback in aiGenerator.ts.
 */

import type { AIJsonSchema } from "./provider";

const CARD_LINE_SCHEMA = {
  type: "object",
  properties: {
    name: { type: "string", description: "Exact card name as listed in the pool." },
    qty: { type: "integer", minimum: 1, description: "Number of copies." },
    reason: { type: "string", description: "Short (≤20 words) justification citing role/synergy." },
  },
  required: ["name", "qty", "reason"],
  additionalProperties: false,
} as const;

/**
 * JSON Schema describing the deck-generation response. `strict` is enabled for
 * providers (OpenAI) that support strict structured outputs; providers that
 * only accept a raw schema (Ollama) receive `schema` directly.
 */
export const DECK_JSON_SCHEMA: AIJsonSchema = {
  name: "mtg_deck",
  strict: true,
  schema: {
    type: "object",
    properties: {
      summary: { type: "string", description: "2–4 sentences on deck identity and key synergies." },
      game_plan: { type: "string", description: "2–4 sentences on early/mid/late game and win path." },
      main: {
        type: "array",
        description: "Nonland mainboard core (spells/creatures/planeswalkers).",
        items: CARD_LINE_SCHEMA,
      },
      side: {
        type: "array",
        description: "Sideboard cards (empty array if none requested).",
        items: CARD_LINE_SCHEMA,
      },
    },
    required: ["summary", "game_plan", "main", "side"],
    additionalProperties: false,
  },
};
