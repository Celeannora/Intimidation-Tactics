/**
 * Consistency Report — combines hypergeometric analysis and Monte Carlo
 * simulation into a single human-readable report for a deck.
 *
 * Covers:
 *  - Turn-by-turn castability for every unique CMC in the deck
 *  - Opening hand statistics (avg lands, keep rate, screw/flood rates)
 *  - Per-card flagging when castability by natural turn is below threshold
 *  - Mana source sufficiency warnings
 */

import { castabilityByTurn } from "./hypergeometric";
import { simulateHands, deckToSimCards } from "./handSimulator";
import type { SimulationSummary } from "./handSimulator";

/**
 * Flat entry type for consistency analysis.
 * Prefer this over DeckEntry from legality.ts which nests CardRecord.
 */
export interface ConsistencyEntry {
  name: string;
  quantity: number;
  cmc: number;
  manaCost: string | null;
  typeLine: string;
  producedManaJson?: string;
}

export interface CastabilityData {
  oracleId: string;
  probOnNaturalTurn: number;
  flagged: boolean;
}

export interface CastabilityRow {
  cardName: string;
  cmc: number;
  copies: number;
  /** Probability of casting on the card's natural turn (turn == cmc, min 1) */
  probOnNaturalTurn: number;
  /** Full per-turn breakdown */
  byTurn: Array<{ turn: number; probDrawn: number; probMana: number; probCastable: number }>;
  /** True if probOnNaturalTurn < LOW_CASTABILITY_THRESHOLD */
  flagged: boolean;
  /** Human-readable warning if flagged */
  warning?: string;
}

export interface ManaSourceWarning {
  color: string;
  sources: number;
  required: number;
  message: string;
}

export interface ConsistencyReport {
  deckSize: number;
  landCount: number;
  nonLandCount: number;
  avgManaValue: number;

  /** Monte Carlo hand simulation summary */
  handStats: SimulationSummary;

  /** Per-unique-card castability rows, sorted by CMC ascending */
  castabilityRows: CastabilityRow[];

  /** Per-card castability data keyed by oracleId for scoring feedback */
  castabilityMap: Map<string, CastabilityData>;

  /** Cards flagged as hard to cast on curve */
  flaggedCards: CastabilityRow[];

  /** Mana source sufficiency warnings */
  manaWarnings: ManaSourceWarning[];

  /** Overall consistency grade A–F */
  grade: string;

  /** Natural-language summary */
  summary: string;
}

const LOW_CASTABILITY_THRESHOLD = 0.60;
const MIN_SOURCES_TWO_COLOR = 8;
const MIN_SOURCES_THREE_COLOR = 6;

/**
 * Counts how many lands in the deck can produce a given color.
 * Simple heuristic: if producedManaJson contains the color letter, it counts.
 */
function countColorSources(entries: ConsistencyEntry[], color: string): number {
  let count = 0;
  for (const e of entries) {
    if (!e.typeLine.toLowerCase().includes("land")) continue;
    const produced: string[] = e.producedManaJson
      ? (() => { try { return JSON.parse(e.producedManaJson); } catch { return []; } })()
      : [];
    if (produced.includes(color)) count += e.quantity;
  }
  return count;
}

/**
 * Determine which colors the deck actually needs based on mana costs.
 */
function requiredColors(entries: ConsistencyEntry[]): string[] {
  const colors = new Set<string>();
  for (const e of entries) {
    if (!e.manaCost) continue;
    const matches = e.manaCost.match(/[WUBRG]/g) ?? [];
    for (const c of matches) colors.add(c);
  }
  return [...colors];
}

/**
 * Compute a letter grade from 0-100 score.
 */
function scoreToGrade(score: number): string {
  if (score >= 85) return "A";
  if (score >= 75) return "B";
  if (score >= 62) return "C";
  if (score >= 50) return "D";
  return "F";
}

/**
 * Build a full consistency report for a deck.
 *
 * @param mainboard  Array of { name, quantity, cmc, manaCost, typeLine, producedManaJson }
 * @param trials     Monte Carlo iterations for hand simulation (default 10 000)
 * @param onDraw     Whether to model the player as being on the draw
 */
export function buildConsistencyReport(
  mainboard: ConsistencyEntry[],
  trials = 10_000,
  onDraw = true
): ConsistencyReport {
  const deckSize = mainboard.reduce((s, e) => s + e.quantity, 0);
  const landEntries = mainboard.filter(e => e.typeLine.toLowerCase().includes("land"));
  const nonLandEntries = mainboard.filter(e => !e.typeLine.toLowerCase().includes("land"));
  const landCount = landEntries.reduce((s, e) => s + e.quantity, 0);
  const nonLandCount = nonLandEntries.reduce((s, e) => s + e.quantity, 0);

  // Average mana value (nonland only)
  const totalCmc = nonLandEntries.reduce((s, e) => s + e.cmc * e.quantity, 0);
  const avgManaValue = nonLandCount > 0 ? parseFloat((totalCmc / nonLandCount).toFixed(2)) : 0;

  // ── Monte Carlo hand simulation ──────────────────────────────────────────
  const simCards = deckToSimCards(mainboard);
  const handStats = simulateHands(simCards, trials, 7);

  // ── Per-card castability (hypergeometric) ────────────────────────────────
  const castabilityRows: CastabilityRow[] = [];

  for (const entry of nonLandEntries) {
    const naturalTurn = Math.max(1, entry.cmc);
    const byTurn = castabilityByTurn(
      deckSize,
      entry.quantity,
      entry.cmc,
      landCount,
      Math.max(8, naturalTurn + 2),
      onDraw
    );

    const naturalTurnEntry = byTurn.find(r => r.turn === naturalTurn);
    const probOnNaturalTurn = naturalTurnEntry?.probCastable ?? 0;
    const flagged = probOnNaturalTurn < LOW_CASTABILITY_THRESHOLD;

    let warning: string | undefined;
    if (flagged) {
      const pct = Math.round(probOnNaturalTurn * 100);
      warning = `${entry.name} (CMC ${entry.cmc}) only castable by turn ${naturalTurn} with ${pct}% probability — consider more ramp or lowering the curve.`;
    }

    castabilityRows.push({
      cardName: entry.name,
      cmc: entry.cmc,
      copies: entry.quantity,
      probOnNaturalTurn: parseFloat(probOnNaturalTurn.toFixed(4)),
      byTurn,
      flagged,
      warning,
    });
  }

  castabilityRows.sort((a, b) => a.cmc - b.cmc || a.cardName.localeCompare(b.cardName));
  const flaggedCards = castabilityRows.filter(r => r.flagged);

  // Build castability map keyed by card name (fallback) — note: source entries lack oracleId
  const castabilityMap = new Map<string, CastabilityData>();
  for (const row of castabilityRows) {
    castabilityMap.set(row.cardName, {
      oracleId: row.cardName, // best available; consumers may need to resolve by name
      probOnNaturalTurn: row.probOnNaturalTurn,
      flagged: row.flagged,
    });
  }

  // ── Mana source sufficiency ──────────────────────────────────────────────
  const manaWarnings: ManaSourceWarning[] = [];
  const colors = requiredColors(mainboard);
  const colorCount = colors.length;
  const minSources = colorCount >= 3 ? MIN_SOURCES_THREE_COLOR : MIN_SOURCES_TWO_COLOR;

  for (const color of colors) {
    const sources = countColorSources(mainboard, color);
    if (sources < minSources) {
      manaWarnings.push({
        color,
        sources,
        required: minSources,
        message: `Only ${sources} ${color} source${sources !== 1 ? "s" : ""} detected — recommend at least ${minSources} for a ${colorCount}-color deck.`,
      });
    }
  }

  // ── Grade calculation ────────────────────────────────────────────────────
  // Score components (all 0-100):
  // 1. Keep rate contribution (target >= 0.75)
  const keepScore = Math.min(100, (handStats.keepRate / 0.75) * 40);
  // 2. Low screw rate contribution (target <= 0.15)
  const screwScore = Math.min(100, ((1 - handStats.screwRate) / 0.85) * 20);
  // 3. Low flood rate contribution (target <= 0.20)
  const floodScore = Math.min(100, ((1 - handStats.floodRate) / 0.80) * 20);
  // 4. Average castability of flagged cards (fewer flags = better)
  const flagPenalty = flaggedCards.length * 4;
  const castScore = Math.max(0, 20 - flagPenalty);

  const totalScore = keepScore + screwScore + floodScore + castScore;
  const grade = scoreToGrade(totalScore);

  // ── Summary text ─────────────────────────────────────────────────────────
  const keepPct = Math.round(handStats.keepRate * 100);
  const screwPct = Math.round(handStats.screwRate * 100);
  const floodPct = Math.round(handStats.floodRate * 100);
  const flagCount = flaggedCards.length;

  const summaryParts: string[] = [
    `${deckSize}-card deck with ${landCount} lands (avg MV ${avgManaValue}).`,
    `Opening hands: ${keepPct}% keepable, ${screwPct}% mana-screwed, ${floodPct}% flooded.`,
  ];
  if (flagCount > 0) {
    summaryParts.push(
      `${flagCount} card${flagCount !== 1 ? "s" : ""} flagged for low on-curve castability (<${Math.round(LOW_CASTABILITY_THRESHOLD * 100)}%).`
    );
  }
  if (manaWarnings.length > 0) {
    summaryParts.push(
      `${manaWarnings.length} color source warning${manaWarnings.length !== 1 ? "s" : ""}: ${manaWarnings.map(w => w.color).join(", ")}.`
    );
  }
  summaryParts.push(`Consistency grade: ${grade}.`);

  return {
    deckSize,
    landCount,
    nonLandCount,
    avgManaValue,
    handStats,
    castabilityRows,
    castabilityMap,
    flaggedCards,
    manaWarnings,
    grade,
    summary: summaryParts.join(" "),
  };
}
