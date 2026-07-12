import type { DeckEntry } from "./legality";
import { assignRoles, isThreat } from "./roles";
import { buildSynergyProfile, type MechanicAxis } from "./generator/synergyModel";
import {
  MACRO_LABELS,
  type MacroLabel,
  type ThemeId,
  isThemeId,
} from "./archetypeVocab";

/**
 * Macro archetype "spine" type. These TitleCase labels are the canonical macro
 * display names (see {@link MACRO_LABELS}); every Record<Archetype, …> table in
 * the generator/scoring/benchmark layers keys off exactly these values plus the
 * detection-only `Unknown` sentinel.
 *
 * NOTE: pre-Wave-1 saved decks may carry legacy macro values (Burn, Tokens,
 * Graveyard, Sacrifice). Use {@link migrateArchetype} to map those onto the
 * current taxonomy before feeding them to any table lookup.
 */
export type Archetype = MacroLabel | "Unknown";

/** Legacy macro values that no longer exist as standalone macros. */
const LEGACY_ARCHETYPE_MIGRATION: Record<string, Archetype> = {
  Burn: "Aggro", // burn is now a theme; its decks are aggro on the macro axis
  Tokens: "Midrange", // tokens is a theme; go-wide decks are aggro/midrange
  Graveyard: "Midrange", // graveyard value is a theme
  Sacrifice: "Midrange", // aristocrats is a theme
};

/** Themes that a legacy macro value implies, for migration of saved state. */
const LEGACY_ARCHETYPE_THEMES: Record<string, ThemeId> = {
  Burn: "burn",
  Tokens: "tokens",
  Graveyard: "graveyard",
  Sacrifice: "sacrifice",
};

const VALID_ARCHETYPES = new Set<string>([...MACRO_LABELS, "Unknown"]);

/**
 * Map any historical archetype string onto a valid current macro. Unknown
 * inputs fall back to "Midrange" (the neutral generation default) rather than
 * throwing, so old IndexedDB rows always load.
 */
export function migrateArchetype(value: string | null | undefined): Archetype {
  if (!value) return "Unknown";
  if (VALID_ARCHETYPES.has(value)) return value as Archetype;
  return LEGACY_ARCHETYPE_MIGRATION[value] ?? "Midrange";
}

/** If a legacy macro value implied a theme, return it so callers can preserve intent. */
export function legacyArchetypeTheme(value: string | null | undefined): ThemeId | undefined {
  if (!value) return undefined;
  return LEGACY_ARCHETYPE_THEMES[value];
}

export interface DetectedTheme {
  id: ThemeId;
  /** Detection confidence 0-1 for this theme. */
  score: number;
}

export interface ArchetypeDetectionResult {
  /** Detected macro archetype. Kept under `archetype` for backward compatibility. */
  archetype: Archetype;
  /** Alias of `archetype` — the macro classification. */
  macro: Archetype;
  /** Macro detection confidence 0-1. */
  confidence: number;
  /** Multi-label strategy themes detected on the deck, scored descending. */
  themes: DetectedTheme[];
  /** Human-readable detection signals. */
  signals: string[];
  /**
   * Per-macro fitness score (0–14 scale, same as internal `score()` function).
   * Lets callers see how competitive each archetype is for this deck composition.
   * Useful for building confidence breakdowns in the UI and for seed analysis.
   */
  archetypeScores: Partial<Record<Archetype, number>>;
}

export interface RoleComposition {
  threats: number;
  removal: number;
  boardWipes: number;
  counterspells: number;
  cardDraw: number;
  ramp: number;
  lands: number;
  total: number;
}

export const ARCHETYPE_BENCHMARKS: Record<Archetype, Partial<RoleComposition>> = {
  Aggro:    { threats: 26, removal: 6,  boardWipes: 0, counterspells: 1,  cardDraw: 2,  ramp: 0,  lands: 21 },
  Midrange: { threats: 18, removal: 10, boardWipes: 2, counterspells: 2,  cardDraw: 6,  ramp: 2,  lands: 23 },
  Control:  { threats: 8,  removal: 14, boardWipes: 4, counterspells: 10, cardDraw: 12, ramp: 0,  lands: 25 },
  Tempo:    { threats: 16, removal: 8,  boardWipes: 0, counterspells: 6,  cardDraw: 6,  ramp: 0,  lands: 22 },
  Combo:    { threats: 10, removal: 6,  boardWipes: 0, counterspells: 2,  cardDraw: 8,  ramp: 4,  lands: 23 },
  Ramp:     { threats: 10, removal: 6,  boardWipes: 2, counterspells: 0,  cardDraw: 6,  ramp: 10, lands: 24 },
  Prison:   { threats: 6,  removal: 10, boardWipes: 4, counterspells: 4,  cardDraw: 8,  ramp: 2,  lands: 24 },
  Unknown:  {},
};

export function getRoleComposition(entries: DeckEntry[]): RoleComposition {
  let threats = 0, removal = 0, boardWipes = 0, counterspells = 0, cardDraw = 0, ramp = 0, lands = 0;

  for (const entry of entries) {
    const qty = entry.quantity;
    const tl = entry.card.typeLine;
    if (tl.includes("Land")) { lands += qty; continue; }

    const roles = assignRoles(entry.card);
    if (isThreat(roles)) threats += qty;
    if (roles.includes("Removal")) removal += qty;
    if (roles.includes("BoardWipe")) boardWipes += qty;
    if (roles.includes("Counterspell")) counterspells += qty;
    if (roles.includes("CardDraw")) cardDraw += qty;
    if (roles.includes("Ramp")) ramp += qty;
  }

  const total = entries.reduce((s, e) => s + e.quantity, 0);
  return { threats, removal, boardWipes, counterspells, cardDraw, ramp, lands, total };
}

function score(comp: RoleComposition, archetype: Archetype): number {
  const bench = ARCHETYPE_BENCHMARKS[archetype];
  if (!bench || archetype === "Unknown") return 0;

  let s = 0;
  const keys: Array<keyof RoleComposition> = ["threats", "removal", "boardWipes", "counterspells", "cardDraw", "ramp", "lands"];
  for (const k of keys) {
    const target = bench[k] ?? 0;
    const actual = comp[k] ?? 0;
    if (target === 0) continue;
    const ratio = actual / target;
    s += ratio >= 0.8 && ratio <= 1.4 ? 2 : ratio >= 0.6 ? 1 : 0;
  }
  return s;
}

// ── Theme detection ────────────────────────────────────────────────────────

interface AxisCounts {
  sources: number;
  payoffs: number;
}

/**
 * Count source/payoff coverage per mechanic axis across the deck, using the
 * single canonical synergy model (the same patterns the generator scores on).
 */
function tallyAxes(entries: DeckEntry[]): Map<MechanicAxis, AxisCounts> {
  const counts = new Map<MechanicAxis, AxisCounts>();
  const bump = (axis: MechanicAxis, kind: "sources" | "payoffs", qty: number) => {
    const c = counts.get(axis) ?? { sources: 0, payoffs: 0 };
    c[kind] += qty;
    counts.set(axis, c);
  };
  for (const e of entries) {
    if (e.card.typeLine.includes("Land")) continue;
    const profile = buildSynergyProfile(e.card);
    for (const axis of profile.sourceTags) bump(axis, "sources", e.quantity);
    for (const axis of profile.payoffTags) bump(axis, "payoffs", e.quantity);
  }
  return counts;
}

/**
 * Detect multi-label strategy themes. Thresholds follow the research doc's
 * "Detection Algorithm Summary": each theme requires a minimum number of source
 * and/or payoff cards. Returns themes sorted by descending confidence.
 *
 * Internal-only axes (`draw`, `etb`, `selfMill`) are never reported as themes.
 */
export function detectThemes(entries: DeckEntry[]): DetectedTheme[] {
  const axes = tallyAxes(entries);
  const get = (a: MechanicAxis): AxisCounts => axes.get(a) ?? { sources: 0, payoffs: 0 };
  const detected: DetectedTheme[] = [];

  const add = (id: ThemeId, met: boolean, strength: number) => {
    if (met && isThemeId(id)) detected.push({ id, score: Math.max(0, Math.min(1, strength)) });
  };

  const lifegain = get("lifegain");
  add("lifegain", lifegain.sources >= 6 && lifegain.payoffs >= 4, (lifegain.sources + lifegain.payoffs) / 16);

  const mill = get("mill");
  add("mill", mill.sources >= 6, mill.sources / 10);

  const tokens = get("tokens");
  add("tokens", tokens.sources >= 10 || tokens.payoffs >= 6, (tokens.sources + tokens.payoffs) / 18);

  const sacrifice = get("sacrifice");
  add("sacrifice", sacrifice.sources >= 4 && sacrifice.payoffs >= 4, (sacrifice.sources + sacrifice.payoffs) / 12);

  const reanimator = get("reanimator");
  add("reanimator", reanimator.sources >= 3, (reanimator.sources + reanimator.payoffs) / 8);

  const graveyard = get("graveyard");
  add("graveyard", graveyard.sources + graveyard.payoffs >= 8, (graveyard.sources + graveyard.payoffs) / 16);

  const spellslinger = get("spellslinger");
  add("spellslinger", spellslinger.sources >= 4 || spellslinger.payoffs >= 4, (spellslinger.sources + spellslinger.payoffs) / 10);

  const burn = get("burn");
  add("burn", burn.sources >= 6, burn.sources / 10);

  const typal = get("typal");
  add("typal", typal.sources >= 8 && typal.payoffs >= 2, (typal.sources + typal.payoffs) / 18);

  const enchantress = get("enchantress");
  add("enchantress", enchantress.sources >= 12 || enchantress.payoffs >= 2, (enchantress.sources + enchantress.payoffs) / 16);

  const artifacts = get("artifacts");
  add("artifacts", artifacts.sources >= 6 && artifacts.payoffs >= 2, (artifacts.sources + artifacts.payoffs) / 16);

  const counters = get("counters");
  add("counters", counters.sources >= 8 || counters.payoffs >= 3, (counters.sources + counters.payoffs) / 14);

  const blink = get("blink");
  add("blink", blink.sources >= 4 && blink.payoffs >= 6, (blink.sources + blink.payoffs) / 12);

  const landfall = get("landfall");
  add("landfall", landfall.sources >= 6 || landfall.payoffs >= 4, (landfall.sources + landfall.payoffs) / 10);

  const domain = get("domain");
  add("domain", domain.sources + domain.payoffs >= 4, (domain.sources + domain.payoffs) / 6);

  const energy = get("energy");
  add("energy", energy.sources + energy.payoffs >= 6, (energy.sources + energy.payoffs) / 10);

  const vehicles = get("vehicles");
  add("vehicles", vehicles.sources >= 6, vehicles.sources / 8);

  const stax = get("stax");
  add("stax", stax.sources >= 6, stax.sources / 8);

  const discard = get("discard");
  add("discard", discard.sources >= 8, discard.sources / 12);

  const storm = get("storm");
  add("storm", storm.sources >= 4 || storm.payoffs >= 2, (storm.sources + storm.payoffs) / 8);

  // Delirium: payoff cards with delirium/escape/delve keyword text signal + graveyard enablers
  const deliriumPayoffs = entries.filter(e => {
    const t = (e.card.oracleText ?? "").toLowerCase();
    return t.includes("delirium") || t.includes("escape—") || t.includes("threshold");
  }).reduce((s, e) => s + e.quantity, 0);
  const deliriumEnablers = (graveyard.sources + get("mill").sources);
  add("delirium",
    deliriumPayoffs >= 4 && deliriumEnablers >= 4,
    (deliriumPayoffs + deliriumEnablers) / 16,
  );

  return detected.sort((a, b) => b.score - a.score);
}

// ── Macro detection ──────────────────────────────────────────────────────────

const SCORED_MACROS: Archetype[] = ["Aggro", "Midrange", "Control", "Tempo", "Combo", "Ramp", "Prison"];

/**
 * Minimum macro-fitness score (out of a 0–14 scale) required to hand back a
 * confident macro classification rather than the `Unknown` hybrid bucket.
 *
 * The ratio-based `score()` awards ~2 "free" points to essentially any deck that
 * runs a normal (~22–25) land count, so a structurally incoherent pile — e.g. a
 * homebrew with almost no real threat base — can still score 3–4 on a macro it
 * does not actually play (its points coming from land ratio + one incidental
 * role). Classifying such decks confidently propagates into
 * {@link ./mythicViability.computeMetaPositioningPillar}, whose per-macro base
 * viability lookup is optimistic (Midrange 80, Aggro 75). Below this floor we
 * return `Unknown`, which that pillar treats conservatively. Genuine archetype
 * decks match several role targets and clear the floor comfortably.
 */
const MIN_MACRO_FITNESS = 5;

/**
 * Single unified detector. Returns the macro archetype (under both `archetype`
 * and `macro`), a confidence, the multi-label themes, and the signal trace.
 */
export function detectArchetype(entries: DeckEntry[]): ArchetypeDetectionResult {
  const comp = getRoleComposition(entries);
  const nonlands = entries.filter((e) => !e.card.typeLine.includes("Land"));
  const nonlandQty = nonlands.reduce((s, e) => s + e.quantity, 0);
  const avgCmc = nonlandQty > 0
    ? nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / nonlandQty
    : 0;

  const themes = detectThemes(entries);
  const themeIds = new Set(themes.map((t) => t.id));
  const signals: string[] = [];

  if (avgCmc > 0 && avgCmc < 2.2) signals.push(`Low avg MV (${avgCmc.toFixed(1)}) — aggressive curve`);
  if (avgCmc > 3.5) signals.push(`High avg MV (${avgCmc.toFixed(1)}) — late game curve`);
  if (comp.counterspells >= 8) signals.push("Heavy counterspell suite");
  if (comp.ramp >= 8) signals.push("Heavy ramp suite");
  for (const t of themes.slice(0, 4)) {
    signals.push(`Theme: ${t.id} (${Math.round(t.score * 100)}%)`);
  }

  // Compute per-macro scores upfront (used for archetypeScores in result).
  const archetypeScores: Partial<Record<Archetype, number>> = {};
  for (const arch of SCORED_MACROS) {
    archetypeScores[arch] = score(comp, arch);
  }

  // Strong macro overrides driven by unambiguous structural signals.
  if (themeIds.has("stax") || (comp.boardWipes >= 4 && themeIds.has("stax"))) {
    return finalize("Prison", 0.7, themes, signals, archetypeScores);
  }
  if (comp.ramp >= 10 && avgCmc >= 3.0) {
    return finalize("Ramp", 0.75, themes, signals, archetypeScores);
  }

  // Score-based detection across all macros.
  let bestArchetype: Archetype = "Unknown";
  let bestScore = 0;
  for (const arch of SCORED_MACROS) {
    const s = archetypeScores[arch] ?? 0;
    if (s > bestScore) { bestScore = s; bestArchetype = arch; }
  }

  const confidence = Math.min(bestScore / 14, 1);

  // Minimum-fitness gate (issue #4 / 13a): hand back the explicit hybrid bucket
  // instead of an over-confident macro when no archetype fits well enough.
  if (bestScore < MIN_MACRO_FITNESS) {
    signals.push(`Unclassified: best macro fit ${bestScore}/14 below coherence floor (${MIN_MACRO_FITNESS})`);
    return finalize("Unknown", confidence, themes, signals, archetypeScores);
  }

  return finalize(bestArchetype, confidence, themes, signals, archetypeScores);
}

function finalize(
  macro: Archetype,
  confidence: number,
  themes: DetectedTheme[],
  signals: string[],
  archetypeScores: Partial<Record<Archetype, number>> = {},
): ArchetypeDetectionResult {
  return { archetype: macro, macro, confidence, themes, signals, archetypeScores };
}
