/**
 * mythicViability.ts — Two-track deck viability assessment.
 *
 * This module deliberately does NOT emit a single blended "mythic viability %".
 * That old design mixed legitimate structural math with a static, never-
 * validated meta table and presented the result as a win-rate prediction —
 * which made AI/homebrew decks look as strong as netdecks even though they lose
 * in real play. Instead we report two explicit, honestly-labelled tracks:
 *
 *   Track 1 — Structural soundness: measurable from the decklist alone
 *     (Frank-Karsten mana coverage, curve, land ratio, four-of density,
 *     synergy/engine depth). A construction-quality signal, not a win rate.
 *
 *   Track 2 — Competitive strength: grounded ONLY in real per-archetype
 *     win-rate data (see ./meta/liveWinRate + ./meta/archetypeMatch). If the
 *     deck matches a tracked archetype we surface the real win rate + interval;
 *     if not, we report "no comparable market data" rather than inventing a
 *     number.
 */

import type { DeckEntry } from "./legality";
import type { Archetype } from "./archetype";
import type { ManaColor } from "./types";
import type { ConstructedFormat, PlayEnvironment } from "./formats";
import type {
  MythicViabilityReport,
  StructuralSoundness,
  CompetitiveStrength,
} from "./generator/types";
import { manaBaseCoverage } from "./generator/weights";
import { assignRoles, isThreat } from "./roles";
import { matchArchetype } from "./meta/archetypeMatch";
import { isFormatSupported, type LiveWinRateDataset } from "./meta/liveWinRate";

// ── Track 1 sub-scores ─────────────────────────────────────────────────────

/** 0–100 land-ratio fit (target ~36–45% lands in a 60-card deck). */
export function landRatioScore(entries: DeckEntry[]): number {
  const deckSize = entries.reduce((s, e) => s + e.quantity, 0);
  if (deckSize === 0) return 0;
  const landCount = entries
    .filter((e) => e.card.typeLine.includes("Land"))
    .reduce((s, e) => s + e.quantity, 0);
  const ratio = landCount / deckSize;
  if (ratio >= 0.36 && ratio <= 0.45) return 100;
  if (ratio >= 0.30 && ratio <= 0.50) return 70;
  return 40;
}

/** 0–100 curve-shape fit based on average nonland MV. */
export function curveScore(entries: DeckEntry[]): number {
  const nonlands = entries.filter((e) => !e.card.typeLine.includes("Land"));
  const nonlandQty = nonlands.reduce((s, e) => s + e.quantity, 0);
  if (nonlandQty === 0) return 0;
  const avgCmc = nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / nonlandQty;
  if (avgCmc >= 1.5 && avgCmc <= 3.5) return 100;
  if (avgCmc > 3.5 && avgCmc <= 4.5) return Math.max(30, 100 - (avgCmc - 3.5) * 40);
  if (avgCmc < 1.5) return 80;
  return 20;
}

/**
 * 0–100 four-of density. Fixed per issue #5 / old Priority 7c: score is
 * `fourOfCount × 12.5`, capped at 8 four-ofs (=100). The previous
 * `fourOfCount × 20` capped at 5 saturated far too early, giving thin decks
 * full marks for four four-ofs.
 */
export function fourOfDensityScore(entries: DeckEntry[]): number {
  const fourOfCount = entries.filter(
    (e) => !e.card.typeLine.includes("Land") && e.quantity >= 4,
  ).length;
  return Math.min(100, fourOfCount * 12.5);
}

/**
 * 0–100 synergy / engine-role depth: how many core role slots have ≥3-card
 * backup, plus a bonus for deeply-redundant roles (≥6 copies).
 */
export function synergyDensityScore(entries: DeckEntry[]): number {
  if (entries.length === 0) return 0;

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

  const coreRoles = ["threats", "removal", "cardDraw"];
  let filledCoreRoles = 0;
  for (const role of coreRoles) if ((roleTotals[role] ?? 0) >= 3) filledCoreRoles++;
  const coreCoverage = (filledCoreRoles / coreRoles.length) * 60;

  const deepCoverage = Object.values(roleTotals).filter((c) => c >= 6).length;
  const depthBonus = Math.min(40, deepCoverage * 10);

  return Math.round(Math.min(100, coreCoverage + depthBonus));
}

/**
 * Compute Track 1 — structural soundness — from the decklist alone.
 * Weighted blend of the five sub-scores (weights sum to 1.0):
 *   manaBase 0.25, synergyDensity 0.25, curve 0.20, landRatio 0.15, fourOf 0.15
 */
export function computeStructuralSoundness(entries: DeckEntry[]): StructuralSoundness {
  if (entries.length === 0) {
    return {
      score: 0, manaBase: 0, curve: 0, landRatio: 0, fourOfDensity: 0, synergyDensity: 0,
      notes: ["Empty deck — no structural signal."],
    };
  }

  const manaBase = Math.round(manaBaseCoverage(entries) * 100);
  const curve = Math.round(curveScore(entries));
  const landRatio = Math.round(landRatioScore(entries));
  const fourOfDensity = Math.round(fourOfDensityScore(entries));
  const synergyDensity = Math.round(synergyDensityScore(entries));

  const score = Math.round(
    manaBase * 0.25 +
    synergyDensity * 0.25 +
    curve * 0.20 +
    landRatio * 0.15 +
    fourOfDensity * 0.15,
  );

  const notes: string[] = [
    `Mana base ${manaBase}/100 (Frank-Karsten coverage): ${manaBase >= 90 ? "colour sources sufficient" : manaBase >= 70 ? "minor colour gaps" : "under-sourced — expect colour screw"}`,
    `Curve ${curve}/100: ${curve >= 80 ? "healthy curve" : curve >= 40 ? "acceptable curve" : "top-heavy / clumped curve"}`,
    `Land ratio ${landRatio}/100: ${landRatio >= 100 ? "ideal land count" : landRatio >= 70 ? "workable land count" : "land count off-target"}`,
    `Four-of density ${fourOfDensity}/100: ${fourOfDensity >= 75 ? "consistent 4-of core" : fourOfDensity >= 40 ? "some redundancy" : "few 4-ofs — inconsistent draws"}`,
    `Synergy depth ${synergyDensity}/100: ${synergyDensity >= 70 ? "deep role coverage" : synergyDensity >= 45 ? "core roles covered" : "missing role redundancy"}`,
  ];

  return { score, manaBase, curve, landRatio, fourOfDensity, synergyDensity, notes };
}

// ── Track 2 — competitive strength (real data only) ─────────────────────────

/**
 * Resolve Track 2 from a fuzzy match against real win-rate data. Never
 * synthesizes a percentage: when the deck doesn't match a tracked archetype
 * (or no dataset is available) it returns an explicit unavailable state.
 */
export function resolveCompetitiveStrength(
  archetype: Archetype,
  colors: ManaColor[],
  dataset: LiveWinRateDataset | null | undefined,
  format: ConstructedFormat | undefined,
): CompetitiveStrength {
  if (!dataset) {
    return {
      matched: false,
      reason: isFormatSupported(format) ? "data-not-loaded" : "format-unsupported",
    };
  }

  const match = matchArchetype({ archetype, colors }, dataset);
  if (!match.matched || !match.candidate) {
    return {
      matched: false,
      reason: "no-market-data",
      lastUpdated: dataset.lastUpdated,
      source: dataset.source,
    };
  }

  const c = match.candidate;
  return {
    matched: true,
    winRate: c.winRate,
    confidenceInterval: c.confidenceInterval,
    sampleSize: c.sampleSize,
    sourceArchetype: c.name,
    matchConfidence: Math.round(match.confidence * 100) / 100,
    lastUpdated: dataset.lastUpdated,
    source: dataset.source,
  };
}

// ── Composite ─────────────────────────────────────────────────────────────────

/** Extra context needed for Track 2. Track 1 needs only the decklist. */
export interface ViabilityContext {
  colors?: ManaColor[];
  format?: ConstructedFormat;
  playEnvironment?: PlayEnvironment;
  /** Pre-fetched live win-rate dataset (see meta/liveWinRate). */
  liveWinRate?: LiveWinRateDataset | null;
}

/**
 * Compute the two-track viability report for a deck.
 *
 * @param entries    Mainboard deck entries.
 * @param archetype  Detected or user-selected macro archetype.
 * @param context    Colours/format + the pre-fetched live win-rate dataset.
 */
export function computeMythicViability(
  entries: DeckEntry[],
  archetype: Archetype,
  context: ViabilityContext = {},
): MythicViabilityReport {
  const structural = computeStructuralSoundness(entries);
  const colors = context.colors ?? deriveColors(entries);
  const competitive = resolveCompetitiveStrength(
    archetype,
    colors,
    context.liveWinRate,
    context.format,
  );
  return { structural, competitive };
}

/** Best-effort colour identity from the decklist when not supplied by caller. */
function deriveColors(entries: DeckEntry[]): ManaColor[] {
  const set = new Set<ManaColor>();
  for (const e of entries) {
    try {
      const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
      for (const c of ci) set.add(c);
    } catch {
      /* ignore malformed colour identity */
    }
  }
  return (["W", "U", "B", "R", "G"] as ManaColor[]).filter((c) => set.has(c));
}
