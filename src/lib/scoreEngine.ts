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
import { computePowerScore } from "./powerScore";
import { getCompetitivePower } from "./competitivePower";

import {
  buildSynergyProfile,
  inferPrimaryAxes,
  axisScore,
  summarizeSynergyConnections,
  synergyDensityMultiplier,
  crossAxisCompositionBonus,
  type SynergyConnectionSummary,
  type MechanicAxis,
} from "./generator/synergyModel";
import { roleMultiplier, keywordBonus, focusCardBonus, preferCardBonus } from "./generator/weights";
import type { GenerateOptions } from "./generator/types";
import { getCardConfig, getCastabilityConfig } from "./config/scoringConfig";

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

  // Load scoring configuration for current format/environment
  const cardCfg = getCardConfig();
  const castCfg = getCastabilityConfig();

  // Castability feedback penalty (config-driven, convex, 0–maxPenalty)
  const castabilityPenalty = castabilityProb != null
    ? computeCastabilityPenalty(castabilityProb, castCfg)
    : 0;

  // Role weight × power score (with log1p cap).
  // basePower is anchored to real competitive play data when available, falling
  // back to the heuristic for cards absent from the snapshot.
  const basePower = computePowerScore(card, getCompetitivePower(card));

  const role = roleMultiplier(card, options.archetype);
  const rawRolePower = role * basePower;
  const rolePowerScore = rawRolePower <= cardCfg.rolePowerLinearCap
    ? rawRolePower
    : cardCfg.rolePowerLinearCap + Math.log1p(rawRolePower - cardCfg.rolePowerLinearCap) * cardCfg.rolePowerLogSlope;

  // Bonus contributions
  const kwBonus = keywordBonus(card, options.keywordFocus);
  const focusCard = focusCardBonus(card, { focusEntries: options.focusEntries ?? [] } as GenerateOptions);
  const prefer = preferCardBonus(card, { preferEntries: options.preferEntries ?? [] } as GenerateOptions);
  const bonusTotal = kwBonus + focusCard + prefer;

  // Directional contribution with rebalanced scaling and log-compression
  const directionalContribution = computeDirectionalContribution(
    directionalScore,
    synergyMultiplier,
    cardCfg,
  );
  const compositionContribution = compositionBonus * cardCfg.compositionScalar;

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
 * Config-driven directional contribution with log-compression.
 * Prevents synergy from dwarfing role-power and mana terms.
 */
function computeDirectionalContribution(
  directionalScore: number,
  synergyMultiplier: number,
  cfg: ReturnType<typeof getCardConfig>,
): number {
  const raw = directionalScore * synergyMultiplier;
  let compressed: number;
  if (raw <= cfg.directionalLinearCap) {
    compressed = raw;
  } else {
    compressed = cfg.directionalLinearCap + Math.log1p(raw - cfg.directionalLinearCap) * cfg.directionalLogSlope;
  }
  return Math.min(cfg.directionalMaxContribution, cfg.directionalScalar * compressed);
}

/**
 * Config-driven castability penalty with convex growth.
 * Heavy penalties for low castability, mild/none for high.
 */
function computeCastabilityPenalty(
  prob: number,
  cfg: ReturnType<typeof getCastabilityConfig>,
): number {
  if (prob >= cfg.noPenaltyAbove) return 0;
  if (prob <= 0) return cfg.maxPenalty;
  // Convex ramp across the full [0, noPenaltyAbove] interval. The earlier
  // implementation used mildPenaltyStart as the denominator, which saturated
  // too quickly (e.g. 80% and 20% castability both hit max penalty). Keeping
  // the curve full-range preserves strong low-probability penalties while
  // remaining proportional for testability and diagnostics.
  const t = (cfg.noPenaltyAbove - prob) / cfg.noPenaltyAbove;
  return Math.min(cfg.maxPenalty, cfg.maxPenalty * t * t);
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