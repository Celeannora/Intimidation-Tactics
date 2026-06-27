import type { Archetype } from "../archetype";

/**
 * scoringConfig.ts — Centralized scoring configuration
 *
 * Consolidates all tuneable constants, thresholds, and multipliers for the
 * card and deck scoring pipelines into a single source of truth.  Each format
 * and play environment can have its own profile; defaults reflect a balanced
 * Standard Bo1 competitive calibration.
 *
 * Coefficients have been rebalanced so that synergy, power, mana reliability,
 * role coverage, and curve all contribute at comparable magnitudes — preventing
 * any single dimension from overwhelming the objective.
 */

export type FormatProfile = "standard" | "explorer" | "historic" | "pioneer" | "modern" | "legacy" | "commander";
export type EnvironmentProfile = "bo1" | "bo3";

// ── Card-Level Scoring Coefficients ───────────────────────────────────────

export interface CardScoringConfig {
  /** Scalar applied to directional synergy contribution before density multiplier. */
  directionalScalar: number;

  /** After directional × density, cap the raw value via log1p beyond this linear zone. */
  directionalLinearCap: number;

  /** Log-slope multiplier for directional values above the linear cap. */
  directionalLogSlope: number;

  /** Hard upper bound on the directional contribution after rescaling (prevents runaway). */
  directionalMaxContribution: number;

  /** Scalar applied to composition bonus. */
  compositionScalar: number;

  /** Scalar applied to efficiency contribution. */
  efficiencyScalar: number;

  /** Scalar applied to flexibility contribution. */
  flexibilityScalar: number;

  /** Scalar applied to ladder/meta contribution. */
  ladderScalar: number;

  /** Log-slope for role power contribution above the linear cap. */
  rolePowerLogSlope: number;

  /** Role power contribution stays linear up to this value, then log-compressed. */
  rolePowerLinearCap: number;

  /** Base bonus for focus (pinned) cards. */
  focusCardBaseBonus: number;

  /** Base bonus for preferred (soft-pinned) cards. */
  preferCardBaseBonus: number;

  /** Bonus per matched keyword. */
  keywordBonusPerMatch: number;
}

// ── Castability & Mana Penalty Configuration ──────────────────────────────

export interface CastabilityConfig {
  /** No penalty when castability probability is at or above this threshold. */
  noPenaltyAbove: number;

  /** Maximum penalty applied when castability drops to zero (or below mildPenaltyStart). */
  maxPenalty: number;

  /** Penalty starts ramping up below this probability (convex growth). */
  mildPenaltyStart: number;
}

// ── Deck-Level Scoring Configuration ──────────────────────────────────────

export interface DeckScoringConfig {
  /** Multiplier for Wasserstein curve deviation penalty. */
  curveDeviationMultiplier: number;

  /** Multiplier for (1 - manaBaseCoverage) penalty. */
  manaCoverageMultiplier: number;

  /** Multiplier for role profile loss term. */
  roleProfileLossMultiplier: number;

  /** Multiplier for engine redundancy contribution. */
  redundancyMultiplier: number;

  /** Multiplier for meta performance contribution. */
  metaPerformanceMultiplier: number;
}

// ── CMC & Price Penalties ─────────────────────────────────────────────────

export interface PenaltyConfig {
  /** CMC overshoot multiplier (Aggro/Tempo). */
  cmcSlopeFast: number;

  /** CMC overshoot multiplier (Midrange/Control/Combo/Ramp). */
  cmcSlopeSlow: number;

  /** Fraction of total budget a single card can consume before penalty starts. */
  priceBudgetFraction: number;

  /** Multiplier for price overshoot beyond the fraction. */
  priceMultiplier: number;

  /** Cap on price penalty per card. */
  pricePenaltyCap: number;

  /** Penalty for 6+ CMC cards in non-Ramp/non-Control archetypes. */
  expensiveCardPenalty: number;

  /** Penalty for board wipes in Aggro/Tempo. */
  boardWipeInAggroPenalty: number;
}

// ── Meta-Aware Configuration ──────────────────────────────────────────────

export interface MetaConfig {
  /** Base weight for meta impact on power score. */
  metaImpactScalar: number;

  /** Weight adjustment ceiling for role multipliers driven by meta. */
  metaRoleAdjustmentCap: number;
}

// ── Full Scoring Profile ──────────────────────────────────────────────────

export interface ScoringProfile {
  card: CardScoringConfig;
  castability: CastabilityConfig;
  deck: DeckScoringConfig;
  penalty: PenaltyConfig;
  meta: MetaConfig;
}

// ── Default Profiles ──────────────────────────────────────────────────────

const DEFAULT_CARD: CardScoringConfig = {
  directionalScalar: 2.5,          // was 5.0 — halved so synergy doesn't dwarf power
  directionalLinearCap: 24,        // directional×density stays linear up to 24
  directionalLogSlope: 4.0,
  directionalMaxContribution: 120, // hard cap ~3× typical rolePowerScore
  compositionScalar: 0.8,
  efficiencyScalar: 1.2,
  flexibilityScalar: 0.9,
  ladderScalar: 0.8,
  rolePowerLogSlope: 6.0,
  rolePowerLinearCap: 35,
  focusCardBaseBonus: 14,
  preferCardBaseBonus: 55,
  keywordBonusPerMatch: 4,
};

const DEFAULT_CASTABILITY: CastabilityConfig = {
  noPenaltyAbove: 0.90,
  maxPenalty: 10,                  // was 5 — doubled so bad mana really hurts
  mildPenaltyStart: 0.80,
};

const DEFAULT_DECK: DeckScoringConfig = {
  curveDeviationMultiplier: 10.0,  // was 7.0 — stronger curve enforcement
  manaCoverageMultiplier: 16.0,   // was 10.0 — stronger mana enforcement
  roleProfileLossMultiplier: 4.0,  // new term for role coverage
  redundancyMultiplier: 2.5,       // new term for engine redundancy
  metaPerformanceMultiplier: 3.0,  // new term for meta positioning
};

const DEFAULT_PENALTY: PenaltyConfig = {
  cmcSlopeFast: 4,
  cmcSlopeSlow: 2,
  priceBudgetFraction: 0.05,
  priceMultiplier: 0.5,
  pricePenaltyCap: 15,
  expensiveCardPenalty: 3,
  boardWipeInAggroPenalty: 5,
};

const DEFAULT_META: MetaConfig = {
  metaImpactScalar: 0.5,
  metaRoleAdjustmentCap: 0.3,
};

// ── Environment overrides ─────────────────────────────────────────────────

const STANDARD_BO1: ScoringProfile = {
  card: { ...DEFAULT_CARD },
  castability: { ...DEFAULT_CASTABILITY },
  deck: { ...DEFAULT_DECK },
  penalty: { ...DEFAULT_PENALTY },
  meta: { ...DEFAULT_META },
};

const STANDARD_BO3: ScoringProfile = {
  ...STANDARD_BO1,
  deck: {
    ...DEFAULT_DECK,
    metaPerformanceMultiplier: 5.0, // sideboard matters more in Bo3
  },
};

const COMMANDER: ScoringProfile = {
  card: {
    ...DEFAULT_CARD,
    directionalScalar: 3.0, // synergy more important in Commander
    preferCardBaseBonus: 40, // smaller bonus in 100-card singleton
    focusCardBaseBonus: 10,
  },
  castability: { ...DEFAULT_CASTABILITY },
  deck: {
    ...DEFAULT_DECK,
    curveDeviationMultiplier: 6.0,
    manaCoverageMultiplier: 12.0,
    roleProfileLossMultiplier: 3.0,
    redundancyMultiplier: 3.0,
  },
  penalty: { ...DEFAULT_PENALTY },
  meta: { ...DEFAULT_META },
};

// ── Lookup ────────────────────────────────────────────────────────────────

const PROFILES: Record<string, ScoringProfile> = {
  "standard-bo1": STANDARD_BO1,
  "standard-bo3": STANDARD_BO3,
  "explorer-bo1": STANDARD_BO1,
  "explorer-bo3": STANDARD_BO3,
  "historic-bo1": STANDARD_BO1,
  "historic-bo3": STANDARD_BO3,
  "pioneer-bo1": STANDARD_BO1,
  "pioneer-bo3": STANDARD_BO3,
  "modern-bo1": STANDARD_BO1,
  "modern-bo3": STANDARD_BO3,
  "legacy-bo1": STANDARD_BO1,
  "legacy-bo3": STANDARD_BO3,
  "commander-bo1": COMMANDER,
  "commander-bo3": COMMANDER,
};

/**
 * Retrieve the full scoring profile for a format and play environment.
 * Defaults to standard-bo1 when no match is found.
 */
export function getScoringProfile(
  format?: string,
  environment?: string,
): ScoringProfile {
  const fmt = (format ?? "standard").toLowerCase();
  const env = (environment ?? "bo1").toLowerCase();
  const key = `${fmt}-${env}`;
  return PROFILES[key] ?? STANDARD_BO1;
}

/**
 * Re-export individual accessors for convenience.
 */
export function getCardConfig(format?: string, environment?: string): CardScoringConfig {
  return getScoringProfile(format, environment).card;
}

export function getCastabilityConfig(format?: string, environment?: string): CastabilityConfig {
  return getScoringProfile(format, environment).castability;
}

export function getDeckConfig(format?: string, environment?: string): DeckScoringConfig {
  return getScoringProfile(format, environment).deck;
}

export function getPenaltyConfig(format?: string, environment?: string): PenaltyConfig {
  return getScoringProfile(format, environment).penalty;
}

export function getMetaConfig(format?: string, environment?: string): MetaConfig {
  return getScoringProfile(format, environment).meta;
}
// ── Keyword value matrix (sonar.md Part 6) ─────────────────────────────────────

/**
 * MTG keywords that have differential value across archetypes.
 * Used by applyKeywordValueMatrix in generator/weights.ts.
 */
export type MTGKeyword =
  | "flying" | "menace" | "trample" | "haste" | "lifelink"
  | "deathtouch" | "vigilance" | "flash" | "reach" | "first_strike"
  | "double_strike" | "hexproof" | "indestructible" | "ward"
  | "surveil" | "mill" | "self_mill" | "token_gen" | "sacrifice";
export type KeywordValueMatrix = Partial<Record<Archetype, Partial<Record<MTGKeyword, number>>>>;

/**
 * Per-archetype keyword multipliers.
 * Values >1.0 = higher value in this archetype, <1.0 = lower value.
 * 1.0 = neutral (same as default weighting).
 */
export const KEYWORD_VALUE_MATRIX: KeywordValueMatrix = {
  Aggro: {
    haste: 1.5,      // gets value immediately; critical for aggro
    trample: 1.4,    // forces through damage
    menace: 1.3,     // hard to double-block small bodies
    flying: 1.2,     // evasion enables racing
    lifelink: 0.8,   // less relevant when racing
    ward: 0.8,       // usually too slow to matter
    vigilance: 0.9,
    deathtouch: 1.1,
    first_strike: 1.2,
    double_strike: 1.4,
  },
  Midrange: {
    flying: 1.3,     // evasion on bigger bodies closes games
    lifelink: 1.3,   // stabilizes after trading
    deathtouch: 1.2, // excellent on midrange bodies
    vigilance: 1.2,  // attack AND block
    ward: 1.2,       // protects key threats
    trample: 1.2,
    hexproof: 1.3,
    indestructible: 1.3,
    haste: 1.1,
    token_gen: 1.3,
  },
  Control: {
    flying: 1.5,     // finishers need evasion to close
    flash: 1.5,      // key for draw-go play
    hexproof: 1.4,   // protect your finisher
    ward: 1.4,       // tax the opponent's removal
    lifelink: 1.3,   // stabilize while controlling
    indestructible: 1.3,
    vigilance: 1.1,
    haste: 0.7,      // irrelevant for control finishers
    menace: 0.8,
    trample: 0.9,
    mill: 1.2,       // alternate win condition
  },
  Tempo: {
    flying: 1.4,     // evasive threats that stick
    flash: 1.5,      // play on opponent's turn
    haste: 1.3,      // tempo swing
    menace: 1.2,
    first_strike: 1.2,
    hexproof: 1.3,   // protects your threat investment
    lifelink: 1.0,
    token_gen: 1.1,
    deathtouch: 1.1,
  },
  Combo: {
    haste: 1.3,      // combo pieces that attack same turn
    surveil: 1.4,    // filter for combo pieces
    self_mill: 1.4,  // fill graveyard for combo
    flash: 1.2,
    flying: 1.0,
    sacrifice: 1.3,  // aristocrats combos
    token_gen: 1.2,
    mill: 1.1,
  },
  Ramp: {
    flying: 1.4,     // big finishers need evasion
    trample: 1.5,    // force through damage with big bodies
    haste: 1.3,      // immediately relevant when cast big
    indestructible: 1.3, // protect expensive investments
    lifelink: 1.2,   // stabilize while ramping
    ward: 1.2,
    hexproof: 1.2,
    vigilance: 1.1,
  },
  Prison: {
    flash: 1.3,      // instant-speed lock pieces
    flying: 1.1,
    lifelink: 1.2,   // stabilize while locking
    ward: 1.3,       // protect lock pieces
    indestructible: 1.4, // lock pieces that can't be removed
    hexproof: 1.3,
    vigilance: 1.1,
    haste: 0.7,
    menace: 0.8,
    trample: 0.8,
  },
};