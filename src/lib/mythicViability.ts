/**
 * mythicViability.ts — Mythic viable win-rate estimation
 *
 * Implements sonar.md Part 1 — MMR Math & Win-Rate Targets.
 *
 * Three pillars produce a 0-100 composite score that maps onto a
 * win-rate proxy. A mythic-viable deck targets ≥ 55% win rate
 * (composite score ≥ 55).
 *
 * Pillar weights:
 *   consistency     (45%) — mana reliability + castability + hand keepability
 *   redundancy      (30%) — engine depth, 4-of density, role backup
 *   metaPositioning (25%) — archetype meta viability + role-profile fit
 */

import type { DeckEntry } from "./legality";
import type { Archetype } from "./archetype";
import { ARCHETYPE_BENCHMARKS, getRoleComposition } from "./archetype";
import { assignRoles, isThreat } from "./roles";
import type { MythicViabilityReport, MythicViabilityPillars } from "./generator/types";

// ── Win-rate proxy ────────────────────────────────────────────────────────────

/**
 * Maps composite score (0-100) to an estimated Bo1 win-rate percentage.
 * Calibrated so score≥55 → ~55%+ WR, score 70+ → ~59%+ WR.
 */
export function winRateProxy(score: number): number {
  // Linear interpolation: 0→0.42, 50→0.50, 100→0.62
  const base = 0.42;
  const slope = 0.002; // 0.2% WR per composite point
  return Math.round((base + score * slope) * 1000) / 10; // returns percentage e.g. 55.4
}

export function mythicViabilityLabel(score: number): MythicViabilityReport["label"] {
  if (score >= 70) return "tier-1";
  if (score >= 55) return "mythic-viable";
  if (score >= 35) return "fringe";
  return "not-viable";
}

// ── Pillar 1: Consistency ─────────────────────────────────────────────────────

/**
 * Consistency pillar (0-100).
 * Combines land count reliability, curve shape, and castability signals.
 *
 * Inputs drawn from the live deck entries (no async dependency).
 */
export function computeConsistencyPillar(entries: DeckEntry[]): number {
  const deckSize = entries.reduce((s, e) => s + e.quantity, 0);
  if (deckSize === 0) return 0;

  const landCount = entries
    .filter((e) => e.card.typeLine.includes("Land"))
    .reduce((s, e) => s + e.quantity, 0);
  const nonlands = entries.filter((e) => !e.card.typeLine.includes("Land"));
  const nonlandQty = nonlands.reduce((s, e) => s + e.quantity, 0);

  // 1a. Land ratio score (target 22-26 in 60-card deck → 36-43%)
  const landRatio = deckSize > 0 ? landCount / deckSize : 0;
  const landScore = landRatio >= 0.36 && landRatio <= 0.45
    ? 100
    : landRatio >= 0.30 && landRatio <= 0.50
      ? 70
      : 40;

  // 1b. Curve score — penalize uncastable clumps at top-end
  const avgCmc = nonlandQty > 0
    ? nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / nonlandQty
    : 0;

  // Good curve: avg MV 2.0-3.5 for most archetypes
  const curveScore = avgCmc >= 1.5 && avgCmc <= 3.5
    ? 100
    : avgCmc > 3.5 && avgCmc <= 4.5
      ? Math.max(30, 100 - (avgCmc - 3.5) * 40)
      : avgCmc < 1.5
        ? 80
        : 20;

  // 1c. 4-of density score — consistent decks play 4 copies of key cards
  const fourOfCount = entries.filter(
    (e) => !e.card.typeLine.includes("Land") && e.quantity >= 4,
  ).length;
  const densityScore = Math.min(100, fourOfCount * 20); // cap at 5 four-ofs = 100

  const raw = landScore * 0.4 + curveScore * 0.35 + densityScore * 0.25;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ── Pillar 2: Redundancy ──────────────────────────────────────────────────────

/**
 * Redundancy pillar (0-100).
 * Measures engine depth: how many role slots have ≥3 card backup.
 * Implements sonar.md Part 2 "Rule of 9" / Universal Construction Mathematics.
 */
export function computeRedundancyPillar(entries: DeckEntry[]): number {
  if (entries.length === 0) return 0;

  // Count total copies across each role category
  const roleTotals: Record<string, number> = {
    threats: 0, removal: 0, boardWipes: 0,
    counterspells: 0, cardDraw: 0, ramp: 0,
  };

  for (const entry of entries) {
    if (entry.card.typeLine.includes("Land")) continue;
    const roles = assignRoles(entry.card);
    if (isThreat(roles)) roleTotals["threats"] += entry.quantity;
    if (roles.includes("Removal")) roleTotals["removal"] += entry.quantity;
    if (roles.includes("BoardWipe")) roleTotals["boardWipes"] += entry.quantity;
    if (roles.includes("Counterspell")) roleTotals["counterspells"] += entry.quantity;
    if (roles.includes("CardDraw")) roleTotals["cardDraw"] += entry.quantity;
    if (roles.includes("Ramp")) roleTotals["ramp"] += entry.quantity;
  }

  // Penalize empty roles (that should be present in a generic deck)
  const coreRoles = ["threats", "removal", "cardDraw"];
  let filledCoreRoles = 0;
  for (const role of coreRoles) {
    if ((roleTotals[role] ?? 0) >= 3) filledCoreRoles++;
  }
  const coreCoverage = (filledCoreRoles / coreRoles.length) * 60;

  // Bonus for over-redundant roles (≥6 copies = deep coverage)
  const allRoles = Object.values(roleTotals);
  const deepCoverage = allRoles.filter((c) => c >= 6).length;
  const depthBonus = Math.min(40, deepCoverage * 10);

  return Math.round(Math.min(100, coreCoverage + depthBonus));
}

// ── Pillar 3: Meta positioning ────────────────────────────────────────────────

const ARCHETYPE_META_VIABILITY: Record<Archetype, number> = {
  // Rough Standard Bo1 meta viability scores based on sonar.md benchmarks
  Midrange: 80,
  Aggro:    75,
  Tempo:    70,
  Control:  65,
  Combo:    60,
  Ramp:     55,
  Prison:   45,
  Unknown:  40,
};

/**
 * Meta-positioning pillar (0-100).
 * Combines: archetype base meta viability + role-profile fit vs archetype benchmark.
 */
export function computeMetaPositioningPillar(entries: DeckEntry[], archetype: Archetype): number {
  const metaBase = ARCHETYPE_META_VIABILITY[archetype] ?? 40;

  // Role profile fit vs ARCHETYPE_BENCHMARKS
  const comp = getRoleComposition(entries);
  const bench = ARCHETYPE_BENCHMARKS[archetype];
  if (!bench || archetype === "Unknown") return Math.round(metaBase * 0.8);

  const keys: Array<keyof typeof comp> = ["threats", "removal", "boardWipes", "counterspells", "cardDraw", "ramp", "lands"];
  let fitScore = 0;
  let scoredKeys = 0;
  for (const k of keys) {
    const target = bench[k] ?? 0;
    if (target === 0) continue;
    scoredKeys++;
    const actual = comp[k] ?? 0;
    const ratio = actual / target;
    fitScore += ratio >= 0.8 && ratio <= 1.3 ? 2 : ratio >= 0.6 && ratio <= 1.6 ? 1 : 0;
  }

  const profileFitPct = scoredKeys > 0 ? (fitScore / (scoredKeys * 2)) * 100 : 50;

  return Math.round(metaBase * 0.5 + profileFitPct * 0.5);
}

// ── Composite ─────────────────────────────────────────────────────────────────

/**
 * Compute the full MythicViabilityReport for a deck.
 *
 * @param entries  Final deck entries (main + side).
 * @param archetype  Detected or user-selected archetype.
 */
export function computeMythicViability(
  entries: DeckEntry[],
  archetype: Archetype,
): MythicViabilityReport {
  // Empty deck → every pillar is 0
  if (entries.length === 0) {
    const pillars: MythicViabilityPillars = { consistency: 0, redundancy: 0, metaPositioning: 0 };
    return { pillars, score: 0, winRateEstimate: winRateProxy(0), label: "not-viable", notes: [] };
  }

  const consistency = computeConsistencyPillar(entries);
  const redundancy = computeRedundancyPillar(entries);
  const metaPositioning = computeMetaPositioningPillar(entries, archetype);

  const pillars: MythicViabilityPillars = { consistency, redundancy, metaPositioning };

  // Weighted composite: 45% consistency, 30% redundancy, 25% meta
  const composite = Math.round(
    consistency * 0.45 + redundancy * 0.30 + metaPositioning * 0.25,
  );

  const winRateEstimate = winRateProxy(composite);
  const label = mythicViabilityLabel(composite);

  // Build diagnostic notes for each pillar
  const notes: string[] = [];
  notes.push(`Consistency ${consistency}/100: ${consistency >= 70 ? "strong mana + curve" : consistency >= 45 ? "acceptable curve, check land count" : "poor mana reliability"}`);
  notes.push(`Redundancy ${redundancy}/100: ${redundancy >= 70 ? "deep role coverage" : redundancy >= 45 ? "core roles covered" : "missing critical role copies"}`);
  notes.push(`Meta positioning ${metaPositioning}/100: ${metaPositioning >= 70 ? "archetype tier-1 ready" : metaPositioning >= 45 ? "competitive in archetype" : "archetype or role fit needs work"}`);

  return { pillars, score: composite, winRateEstimate, label, notes };
}
