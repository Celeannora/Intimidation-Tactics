import type { Archetype } from "../archetype";
import type { ManaColor, CardRecord } from "../types";

/**
 * Meta-snapshot + counter-analysis type vocabulary.
 *
 * A "meta snapshot" is a versioned, bundled description of the current
 * competitive metagame: which archetypes are being played, how much of the
 * field they make up, and the key cards that identify them. Snapshots are
 * shipped as JSON (see {@link src/data/meta/standard-snapshot.json}) because no
 * public Standard meta source is CORS-accessible from a client-side PWA. An
 * optional remote refresh URL can be checked at runtime to update the bundled
 * copy (see {@link ../meta/snapshot}).
 *
 * The "counter-analysis" types describe the output of comparing a user's deck
 * against a snapshot to estimate matchup posture and suggest tech cards.
 */

/** Bumped whenever the snapshot JSON shape changes incompatibly. */
export type MetaSchemaVersion = 1;

/** Coarse clock describing how fast an archetype tends to close a game. */
export type MetaSpeed = "fast" | "medium" | "slow";

/**
 * One archetype within a meta snapshot.
 *
 * `macro` reuses the existing {@link Archetype} enum so downstream scoring,
 * role targets, and curve profiles can key off it without a parallel
 * vocabulary. `keyCards` follow the Badaro/MTGOArchetypeParser convention of
 * naming the specific cards that uniquely identify the archetype (used later
 * for key-card classification — see docs/META.md).
 */
export interface MetaArchetype {
  /** Stable kebab-case identifier, e.g. "izzet-prowess". */
  id: string;
  /** Display name, e.g. "Izzet Prowess". */
  name: string;
  /** Color identity of the archetype's core (WUBRG subset). */
  colors: ManaColor[];
  /** Macro play-pattern, reusing the canonical Archetype enum. */
  macro: Archetype;
  /** Share of the field as a fraction in [0, 1], e.g. 0.18 = 18%. */
  metaShare: number;
  /** Badaro-style identifying card names (the cards that "name" the deck). */
  keyCards: string[];
  /** Card names / effects this deck commonly uses to interact (removal, counters, etc.). */
  commonInteraction: string[];
  /** How fast the deck typically wins. */
  speed: MetaSpeed;
  /** Optional editorial note (tech, recent shifts, mirrors, etc.). */
  notes?: string;
}

/**
 * A complete, versioned snapshot of one format's metagame at a point in time.
 */
export interface MetaSnapshot {
  schemaVersion: MetaSchemaVersion;
  /** Only "standard" is modeled today; widen the union when more formats land. */
  format: "standard";
  /** ISO 8601 timestamp the snapshot describes (not when it was loaded). */
  updatedAt: string;
  /** Provenance string, e.g. "manual snapshot — refresh before ship". */
  source: string;
  /** The tracked archetypes, conventionally sorted by descending metaShare. */
  archetypes: MetaArchetype[];
}

/** Where a counter card is intended to live. */
export type CounterSlot = "main" | "side";

/** Estimated standing of the user's deck in a given matchup. */
export type CounterPosture = "favored" | "even" | "unfavored" | "unknown";

/**
 * A single suggested card to improve a specific matchup, with a normalized
 * score and a short human-readable rationale.
 */
export interface CounterSuggestion {
  /** {@link MetaArchetype.id} this suggestion targets. */
  targetArchetypeId: string;
  card: CardRecord;
  /** Higher = stronger recommendation. Not yet range-normalized (see TODO in counterAnalysis). */
  score: number;
  reason: string;
  slot: CounterSlot;
}

/** Counter-analysis result for one meta archetype. */
export interface CounterReportEntry {
  archetype: MetaArchetype;
  estimatedPosture: CounterPosture;
  suggestions: CounterSuggestion[];
}

/**
 * Full counter-analysis report: a short summary of the analyzed deck plus a
 * per-archetype breakdown of posture and tech suggestions.
 */
export interface CounterReport {
  deckSummary: string;
  perArchetype: CounterReportEntry[];
}
