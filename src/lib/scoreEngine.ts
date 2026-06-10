/**
 * scoreEngine.ts — Unified scoring pipeline
 *
 * Orchestrates the complete V2 scoring pipeline:
 *   axis tagging → role classification → synergy density → cross-axis bonus
 *   → castability penalty → role weight multiplier → power score → final composite
 *
 * Used by both the UI (via scoring.ts) and the deck generator (via weights.ts).
 */

import type { CardRecord } from "./types";
import type { DeckEntry } from "./legality";
import type { Archetype } from "./archetype";
import { assignRoles, isThreat } from "./roles";
import { computePowerScore } from "./powerScore";
import {
  buildSynergyProfile,
  inferPrimaryAxes,
  axisScore,
  summarizeSynergyConnections,
  synergyDensityMultiplier,
  crossAxisCompositionBonus,
  castabilityFeedbackPenalty,
  keywordFocusToAxes,
  type CardSynergyProfile,
  type SynergyConnectionSummary,
  type MechanicAxis,
} from "./generator/synergyModel";
import { roleMultiplier, keywordBonus, focusCardBonus, preferCardBonus } from "./generator/weights";
import type { GenerateOptions } from "./generator/types";

export interface CompositeScore {
  total: number;
  directionalScore: number;
  synergyMultiplier: number;
  compositionBonus: number;
  castabilityPenalty: number;
  rolePowerScore: number;
  roleMultiplier: number;
  powerScore: number;
  focusBonus: number;
  keywordBonus: number;
  preferBonus: number;
  synergyConnectionSummary: SynergyConnectionSummary;
  deckAxes: MechanicAxis[];
}

/**
 * Compute a composite score for a single card given the current deck.
 *
 * @param card - The candidate card.
 * @param deckEntries - Current deck entries (includes lands; nonlands used for profiling).
 * @param options - Generator options (archetype, keywordFocus, etc.).
 * @param castabilityProb - Optional per-card castability probability (0–1) for feedback.
 */
export function computeCompositeScore(
  card: CardRecord,
  deckEntries: DeckEntry[],
  options: {
    archetype: Archetype;
    keywordFocus?: GenerateOptions["keywordFocus"];
    focusEntries?: DeckEntry[];
    preferEntries?: DeckEntry[];
    totalBudgetUsd?: number;
  },
  castabilityProb?: number
): CompositeScore {
  const profile = buildSynergyProfile(card);
  const deckProfiles = deckEntries
    .filter((e) => !e.card.typeLine.includes("Land"))
    .map((e) => buildSynergyProfile(e.card));

  // Infer primary axes from the deck + this card
  const deckAxes = inferPrimaryAxes([profile, ...deckProfiles]);

  // Directional axis score (0–40)
  const directionalScore = deckAxes.length > 0
    ? axisScore(card, profile, deckAxes, deckProfiles)
    : 0;

  // Synergy density multiplier
  const summary = summarizeSynergyConnections(profile, deckProfiles);
  const synergyMultiplier = synergyDensityMultiplier(summary);

  // Cross-axis composition bonus (0–18)
  const compositionBonus = crossAxisCompositionBonus(profile, deckProfiles);

  // Castability feedback penalty (0–5)
  const castabilityPenalty = castabilityProb != null
    ? castabilityFeedbackPenalty(castabilityProb)
    : 0;

  // Role weight × power score (with log1p cap)
  const basePower = computePowerScore(card);
  const role = roleMultiplier(card, options.archetype);
  const rawRolePower = role * basePower;
  const rolePowerScore = rawRolePower <= 35
    ? rawRolePower
    : 35 + Math.log1p(rawRolePower - 35) * 6;

  // Bonus contributions
  const kwBonus = keywordBonus(card, options.keywordFocus);
  const focusCard = focusCardBonus(card, { focusEntries: options.focusEntries ?? [] } as GenerateOptions);
  const prefer = preferCardBonus(card, { preferEntries: options.preferEntries ?? [] } as GenerateOptions);
  const bonusTotal = kwBonus + focusCard + prefer;

  // Directional contribution with density multiplier
  const directionalContribution = 5.0 * directionalScore * synergyMultiplier;
  const compositionContribution = compositionBonus;

  // Composition bonus already 0–18; no multiplier applied.
  const total =
    rolePowerScore +
    directionalContribution +
    compositionContribution +
    bonusTotal -
    castabilityPenalty;

  return {
    total: Math.max(0, Math.round(total * 10) / 10),
    directionalScore,
    synergyMultiplier,
    compositionBonus,
    castabilityPenalty,
    rolePowerScore,
    roleMultiplier: role,
    powerScore: basePower,
    focusBonus: focusCard,
    keywordBonus: kwBonus,
    preferBonus: prefer,
    synergyConnectionSummary: summary,
    deckAxes,
  };
}

/**
 * Score multiple candidates against a deck, returning sorted results.
 */
export function scoreCandidates(
  candidates: CardRecord[],
  deckEntries: DeckEntry[],
  options: {
    archetype: Archetype;
    keywordFocus?: GenerateOptions["keywordFocus"];
    focusEntries?: DeckEntry[];
    preferEntries?: DeckEntry[];
    totalBudgetUsd?: number;
  },
  castabilityProbMap?: Map<string, number>
): Array<{ card: CardRecord; score: CompositeScore }> {
  return candidates
    .map((card) => ({
      card,
      score: computeCompositeScore(card, deckEntries, options, castabilityProbMap?.get(card.oracleId)),
    }))
    .sort((a, b) => b.score.total - a.score.total);
}