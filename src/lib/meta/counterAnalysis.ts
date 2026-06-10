import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";
import type { Archetype } from "../archetype";
import { detectArchetype } from "../archetype";
import { suggestTechCardsV2 } from "../matchup";
import type {
  MetaSnapshot,
  MetaArchetype,
  MetaSpeed,
  CounterReport,
  CounterReportEntry,
  CounterPosture,
  CounterSuggestion,
} from "./types";

/**
 * Counter-analysis engine (scaffold).
 *
 * `analyzeCounters` compares a deck against a meta snapshot and produces a
 * per-archetype posture estimate plus tech-card suggestions. The posture
 * estimate is a deliberately naive speed/macro heuristic; the suggestion path
 * reuses the existing {@link suggestTechCardsV2} machinery where it is
 * trivially wirable. Everything beyond that is marked with `TODO(meta):` and
 * documented inline — this file is interface-complete, not algorithm-complete.
 */

/** Map the existing macro Archetype enum onto the snapshot's coarse speed clock. */
function macroSpeed(macro: Archetype): MetaSpeed {
  switch (macro) {
    case "Aggro":
    case "Tempo":
      return "fast";
    case "Control":
    case "Ramp":
    case "Prison":
      return "slow";
    default:
      return "medium";
  }
}

const SPEED_RANK: Record<MetaSpeed, number> = { fast: 0, medium: 1, slow: 2 };

/**
 * Naive matchup posture from relative speed.
 *
 * Heuristic only: a clearly faster deck is tentatively "favored", a clearly
 * slower deck "unfavored", equal speed "even". The "other" aggregate bucket and
 * decks we cannot classify return "unknown".
 *
 * TODO(meta): replace with a real model — weight key-card answers the deck can
 * present (commonInteraction coverage), goldfish-clock comparison, and historical
 * matchup win rates from stored MatchResults — instead of speed alone.
 */
function estimatePosture(deckMacro: Archetype, archetype: MetaArchetype): CounterPosture {
  if (deckMacro === "Unknown" || archetype.macro === "Unknown") return "unknown";
  const deckSpeed = macroSpeed(deckMacro);
  const diff = SPEED_RANK[deckSpeed] - SPEED_RANK[archetype.speed];
  if (diff < 0) return "favored";
  if (diff > 0) return "unfavored";
  return "even";
}

/**
 * Build counter suggestions for one target archetype.
 *
 * Wires the existing V2 tech engine: `suggestTechCardsV2` ranks the pool by
 * power × role-relevance + synergy against the deck, keyed on the target's
 * macro Archetype. We surface the top few as side-slot suggestions.
 *
 * TODO(meta): rank against this archetype's `keyCards`/`commonInteraction`
 * specifically (e.g. prefer graveyard hate vs Reanimator, artifact/enchantment
 * removal vs Azorius Prison) and decide main vs side per card, rather than
 * defaulting everything to "side".
 */
function buildSuggestions(
  deck: DeckEntry[],
  pool: CardRecord[],
  archetype: MetaArchetype,
  limit: number
): CounterSuggestion[] {
  // The "other" bucket is not a real deck; do not suggest tech against it.
  if (archetype.id === "other" || archetype.macro === "Unknown") return [];
  if (pool.length === 0) return [];

  const tech = suggestTechCardsV2(deck, pool, archetype.macro).slice(0, limit);
  return tech.map((card) => ({
    targetArchetypeId: archetype.id,
    card,
    // TODO(meta): expose suggestTechCardsV2's internal numeric score instead of this rank-derived placeholder.
    score: 1,
    reason: `Tech vs ${archetype.name} (${archetype.macro})`,
    slot: "side" as const,
  }));
}

export interface AnalyzeCountersOptions {
  /** Max tech suggestions per archetype. Default 3. */
  suggestionsPerArchetype?: number;
}

/**
 * Analyze a deck against a meta snapshot.
 *
 * Returns a structurally complete {@link CounterReport}: a deck summary plus a
 * per-archetype posture estimate and tech-card suggestions. Archetypes are
 * processed in snapshot order (conventionally descending meta share).
 */
export function analyzeCounters(
  deck: DeckEntry[],
  pool: CardRecord[],
  snapshot: MetaSnapshot,
  options: AnalyzeCountersOptions = {}
): CounterReport {
  const limit = options.suggestionsPerArchetype ?? 3;
  const detection = detectArchetype(deck);

  const perArchetype: CounterReportEntry[] = snapshot.archetypes.map((archetype) => ({
    archetype,
    estimatedPosture: estimatePosture(detection.archetype, archetype),
    suggestions: buildSuggestions(deck, pool, archetype, limit),
  }));

  const deckSummary =
    `Deck detected as ${detection.archetype} ` +
    `(confidence ${(detection.confidence * 100).toFixed(0)}%) ` +
    `analyzed vs ${snapshot.archetypes.length} ${snapshot.format} archetypes.`;

  return { deckSummary, perArchetype };
}
