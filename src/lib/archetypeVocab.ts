/**
 * archetypeVocab.ts — Single canonical archetype vocabulary.
 *
 * This module is the one source of truth for the deck builder's two-level
 * archetype taxonomy, per the Wave 1 redesign:
 *
 *   Level 1 — MACRO archetype (single-select): how/when the deck wins.
 *   Level 2 — THEMES (multi-select): the synergy engines a deck exploits.
 *
 * The generator, both detectors, benchmarks, sideboard logic, and the UI all
 * key off the const arrays/maps exported here. A vocabulary-consistency test
 * (src/lib/__tests__/archetypeVocab.consistency.test.ts) asserts that every
 * downstream table covers exactly these ids, so the three historically
 * divergent vocabularies can never drift apart again.
 */

// ── Level 1: Macro archetypes ──────────────────────────────────────────────

/** Canonical macro ids (lowercase). Used as stable keys for sideboard/meta. */
export const MACRO_IDS = [
  "aggro",
  "midrange",
  "control",
  "tempo",
  "combo",
  "ramp",
  "prison",
] as const;

export type MacroId = (typeof MACRO_IDS)[number];

/**
 * Display labels for macro archetypes. These TitleCase strings double as the
 * {@link Archetype} union members (the historical "spine" type) so existing
 * Record<Archetype, …> tables keep working.
 */
export const MACRO_LABELS = [
  "Aggro",
  "Midrange",
  "Control",
  "Tempo",
  "Combo",
  "Ramp",
  "Prison",
] as const;

export type MacroLabel = (typeof MACRO_LABELS)[number];

/** Label → id and id → label maps. */
export const MACRO_LABEL_TO_ID: Record<MacroLabel, MacroId> = {
  Aggro: "aggro",
  Midrange: "midrange",
  Control: "control",
  Tempo: "tempo",
  Combo: "combo",
  Ramp: "ramp",
  Prison: "prison",
};

export const MACRO_ID_TO_LABEL: Record<MacroId, MacroLabel> = {
  aggro: "Aggro",
  midrange: "Midrange",
  control: "Control",
  tempo: "Tempo",
  combo: "Combo",
  ramp: "Ramp",
  prison: "Prison",
};

export interface MacroInfo {
  id: MacroId;
  label: MacroLabel;
  description: string;
}

export const MACRO_ARCHETYPES: MacroInfo[] = [
  { id: "aggro", label: "Aggro", description: "Win fast via cheap creatures and direct damage; curve tops at 3 mana." },
  { id: "midrange", label: "Midrange", description: "Efficiently-statted threats in the 3–5 range; grind incremental advantage." },
  { id: "control", label: "Control", description: "Answer everything; win late with card advantage or a single finisher." },
  { id: "tempo", label: "Tempo", description: "Cheap threats plus cheap interaction; stay ahead by being mana-efficient." },
  { id: "combo", label: "Combo", description: "Assemble 2–3 specific cards to win or generate overwhelming advantage." },
  { id: "ramp", label: "Ramp", description: "Accelerate mana to cast large threats two to three turns early." },
  { id: "prison", label: "Prison", description: "Deploy lock pieces that stop opponents from executing their game plan." },
];

// ── Level 2: Strategy themes (multi-select) ────────────────────────────────

/**
 * Canonical theme ids. These are intentionally identical to the
 * {@link MechanicAxis} union in generator/synergyModel.ts — the synergy model's
 * source/payoff detection IS the theme detector. Keep the two in lock-step.
 */
export const THEME_IDS = [
  "lifegain",
  "mill",
  "tokens",
  "sacrifice",
  "reanimator",
  "graveyard",
  "spellslinger",
  "burn",
  "typal",
  "enchantress",
  "artifacts",
  "counters",
  "blink",
  "landfall",
  "domain",
  "energy",
  "vehicles",
  "stax",
  "discard",
  "storm",
] as const;

export type ThemeId = (typeof THEME_IDS)[number];

export interface ThemeInfo {
  id: ThemeId;
  label: string;
  description: string;
}

export const THEMES: ThemeInfo[] = [
  { id: "lifegain", label: "Lifegain", description: "Gains life as a resource and triggers payoffs that scale with it." },
  { id: "mill", label: "Mill", description: "Depletes the opponent's library to win by deckout." },
  { id: "tokens", label: "Tokens", description: "Creates many creature tokens; wins by swarm or sacrifice." },
  { id: "sacrifice", label: "Aristocrats / Sacrifice", description: "Sacrifices its own creatures for repeated value and drain." },
  { id: "reanimator", label: "Reanimator", description: "Cheats large creatures into play from the graveyard." },
  { id: "graveyard", label: "Graveyard Value", description: "Uses the graveyard as a second hand (recursion, escape, delve)." },
  { id: "spellslinger", label: "Spellslinger", description: "Triggers prowess/Magecraft payoffs on each instant or sorcery." },
  { id: "burn", label: "Burn", description: "Deals direct damage to the opponent via spells." },
  { id: "typal", label: "Typal / Tribal", description: "Same-creature-type synergy backed by lords and type-matters cards." },
  { id: "enchantress", label: "Enchantress / Auras", description: "Builds an engine out of enchantment-cast payoffs." },
  { id: "artifacts", label: "Artifacts", description: "Leans on artifact synergies and affinity-style cost reductions." },
  { id: "counters", label: "+1/+1 Counters", description: "Accumulates counters and proliferates them onto threats." },
  { id: "blink", label: "Blink / Flicker", description: "Reuses enter-the-battlefield effects by flickering permanents." },
  { id: "landfall", label: "Landfall", description: "Triggers powerful effects on every land drop." },
  { id: "domain", label: "Domain", description: "Rewards controlling many basic land types." },
  { id: "energy", label: "Energy", description: "Banks energy counters and spends them on payoffs." },
  { id: "vehicles", label: "Vehicles", description: "Uses Vehicle artifacts with crew synergies." },
  { id: "stax", label: "Stax / Prison", description: "Deploys asymmetric lock pieces preventing opponent actions." },
  { id: "discard", label: "Discard / Madness", description: "Forces discard; rewards madness/hellbent synergies." },
  { id: "storm", label: "Storm / Spells-Chain", description: "Chains many spells in a single turn for storm payoffs." },
];

export const THEME_ID_TO_LABEL: Record<ThemeId, string> = Object.fromEntries(
  THEMES.map((t) => [t.id, t.label]),
) as Record<ThemeId, string>;

const THEME_ID_SET = new Set<string>(THEME_IDS);
const MACRO_ID_SET = new Set<string>(MACRO_IDS);

export function isThemeId(value: string): value is ThemeId {
  return THEME_ID_SET.has(value);
}

export function isMacroId(value: string): value is MacroId {
  return MACRO_ID_SET.has(value);
}

/**
 * Combine a color name + dominant theme/macro into a suggested archetype name,
 * matching the [Color Pair] + [Strategy] convention used by meta sites
 * (e.g. "Azorius Life-Mill", "Selesnya Landfall").
 */
export function suggestArchetypeName(colorName: string, themes: ThemeId[], macro: MacroLabel): string {
  const themeLabels = themes.slice(0, 2).map((t) => THEME_ID_TO_LABEL[t]).filter(Boolean);
  if (themeLabels.length === 0) return `${colorName} ${macro}`.trim();
  const joined = themeLabels.join("-");
  return `${colorName} ${joined}`.trim();
}
