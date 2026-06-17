/**
 * competitivePower.ts — Real competitive signal for card power.
 *
 * The legacy `powerScore.ts` rates cards from rarity + EDHREC rank (Commander
 * popularity) + a curated `gameChanger` flag. None of those reflect *constructed*
 * (e.g. Standard) power, so the generator systematically misvalues cards.
 *
 * This module supplies the missing anchor: a bundled, schema-versioned snapshot
 * of competitive play data (keyed by lowercased card name) that maps a card to a
 * 0–40 "competitive power" signal derived from how much winning decks actually
 * play it. When a card is absent from the snapshot, callers fall back to the
 * heuristic in `powerScore.ts`.
 *
 * The snapshot ships as `src/data/competitive/standard-snapshot.json`. Its values
 * are currently hand-seeded SAMPLES; replace them with aggregated top-decklist
 * data. The shape and wiring below are production-ready regardless.
 */

import type { CardRecord } from "./types";
import snapshot from "../data/competitive/standard-snapshot.json";

export interface CompetitiveCardEntry {
  name: string;
  /** Fraction of competitive decks running >=1 copy (0..1). */
  playRate: number;
  /** Average copies in decks that run it (0..4). */
  copiesAvg: number;
  /** Fraction of top-finishing lists featuring it (0..1). */
  topDeckPresence: number;
}

export interface CompetitiveSnapshot {
  schemaVersion: number;
  format: string;
  updatedAt: string;
  source: string;
  notes?: string;
  cards: CompetitiveCardEntry[];
}

/** Max value of the competitive signal, matched to powerScore's 0–40 scale. */
export const COMPETITIVE_POWER_MAX = 40;

/**
 * Weighting of the three competitive signals. topDeckPresence (does it show up
 * in *winning* lists) is weighted highest; copiesAvg is a mild "how core is it"
 * nudge. Sums are normalized so a ubiquitous 4-of staple approaches the cap.
 */
const SIGNAL_WEIGHTS = { topDeckPresence: 0.55, playRate: 0.35, copiesAvgNorm: 0.10 } as const;

function normalizeName(name: string): string {
  // Use the front face for DFC/split names; lowercase + trim for stable keys.
  const front = name.split("//")[0];
  return front.trim().toLowerCase();
}

function buildIndex(snap: CompetitiveSnapshot): Map<string, CompetitiveCardEntry> {
  const map = new Map<string, CompetitiveCardEntry>();
  for (const entry of snap.cards) {
    if (entry && typeof entry.name === "string") {
      map.set(normalizeName(entry.name), entry);
    }
  }
  return map;
}

let activeSnapshot: CompetitiveSnapshot = snapshot as CompetitiveSnapshot;
let index: Map<string, CompetitiveCardEntry> = buildIndex(activeSnapshot);

/**
 * Convert a competitive entry into a 0–40 power signal.
 */
export function entryToPower(entry: CompetitiveCardEntry): number {
  const copiesNorm = Math.max(0, Math.min(1, entry.copiesAvg / 4));
  const raw =
    SIGNAL_WEIGHTS.topDeckPresence * clamp01(entry.topDeckPresence) +
    SIGNAL_WEIGHTS.playRate * clamp01(entry.playRate) +
    SIGNAL_WEIGHTS.copiesAvgNorm * copiesNorm;
  return Math.round(COMPETITIVE_POWER_MAX * clamp01(raw) * 10) / 10;
}

/**
 * Returns a 0–40 competitive power signal for the card, or `null` when the card
 * is not present in the active snapshot (caller should fall back to heuristics).
 */
export function getCompetitivePower(card: CardRecord): number | null {
  const entry = index.get(normalizeName(card.name));
  return entry ? entryToPower(entry) : null;
}

/** Metadata about the currently loaded snapshot (for UI "last updated", tests). */
export function getCompetitiveSnapshotInfo(): { format: string; updatedAt: string; source: string; count: number } {
  return {
    format: activeSnapshot.format,
    updatedAt: activeSnapshot.updatedAt,
    source: activeSnapshot.source,
    count: activeSnapshot.cards.length,
  };
}

/**
 * Test/refresh seam: swap the active snapshot (e.g. a fetched remote update or a
 * fixture). Pass no argument to reset to the bundled snapshot.
 */
export function setCompetitiveSnapshot(snap?: CompetitiveSnapshot): void {
  activeSnapshot = snap ?? (snapshot as CompetitiveSnapshot);
  index = buildIndex(activeSnapshot);
}

function clamp01(n: number): number {
  if (!Number.isFinite(n)) return 0;
  return n < 0 ? 0 : n > 1 ? 1 : n;
}
