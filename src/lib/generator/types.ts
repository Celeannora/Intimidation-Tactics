import type { Archetype } from "../archetype";
import type { ThemeId } from "../archetypeVocab";
import type { ManaColor, CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { MechanicAxis, AxisConfidence } from "./synergyModel";
import type { ConstructedFormat, PlayEnvironment } from "../formats";
import type { LiveWinRateDataset } from "../meta/liveWinRate";
import type { SeedSynergyGraph } from "../analysis/synergyGraph";

export type GenerationEngine = "offline" | "ai";
export type SpeedProfile = "fast" | "midrange" | "slow";
export type SpellRatio = "creature-heavy" | "balanced" | "spell-heavy";
export type TribalSupportMode = "recommended" | "exclusive";

/**
 * Semantic contract for how the generator treats seedEntries.
 *
 * - "locked-core"       Every seed card must appear in the final deck (barring colour-identity or
 *                       legality violations). The generator only *adds* cards around the locked core.
 *                       This is the default when seedEntries are provided and represents
 *                       "I want to use these cards — build around them."
 *
 * - "strong-preference" Seeds are very heavily weighted and the generator will try hard to keep them,
 *                       but may cut a small number that severely break viability (wrong colour after
 *                       expansion, extreme curve outlier, etc.). Any cut is logged in diagnostics.
 *
 * - "inspiration"       Seeds are used as intent evidence for archetype/axis/colour inference only.
 *                       The generator may freely diverge from the specific cards listed.
 *                       Use this for "build me something *like* this deck."
 */
export type SeedPolicy = "locked-core" | "strong-preference" | "inspiration";
export type KeywordFocus =
  | "Flying"
  | "Trample"
  | "Tokens"
  | "Go-Wide Tokens"
  | "Sacrifice"
  | "Aristocrats"
  | "Graveyard"
  | "Reanimator"
  | "Mill"
  | "Lifegain"
  | "Counters"
  | "+1/+1 Counters"
  | "Discard"
  | "Hand Disruption"
  | "Self-Discard/Looting"
  | "Spellslinger"
  | "Prowess"
  | "ETB/Blink"
  | "Enchantress"
  | "Artifacts"
  | "Ramp"
  | "Tribal Support"
  | "Voltron/Auras"
  | "Stompy"
  | "Big Mana"
  | "Flash/Draw-Go"
  | "Evasion Tempo"
  | "Artifacts/Tokens"
  | "Draw-Go Control";

export interface TribalSupportOptions {
  /** Creature type to prefer/restrict toward, e.g. Human, Vampire, Zombie. */
  tribe: string;
  /** Recommended boosts tribal cards; exclusive restricts nonland candidates toward the tribe. */
  mode: TribalSupportMode;
}

export interface GenerateOptions {
  engine: GenerationEngine;
  /** Constructed legality/card-pool target. */
  format?: ConstructedFormat;
  /** Ladder/metagame environment used by competitive weights. */
  playEnvironment?: PlayEnvironment;
  /** Primary strategic archetype. */
  archetype: Archetype;
  /** Optional secondary archetypes blended into role targets for broader playstyles. */
  secondaryArchetypes?: Archetype[];
  /** Multi-select strategy themes (canonical ThemeIds) the deck should lean into. */
  themes?: ThemeId[];
  colors: ManaColor[];

  /** If false/default, selected colors are a hard identity constraint. */
  allowSeedColorExpansion?: boolean;

  /** Cards already in the deck. Counted toward role budgets, never swapped out. */
  seedEntries?: DeckEntry[];
  /** Build-around cards. Generator chooses appropriate quantities instead of locking current counts. */
  focusEntries?: DeckEntry[];
  /** Soft-preferred cards: not forced into the deck but receive a strong score bonus so the optimizer is likely to pick them. */
  preferEntries?: DeckEntry[];
  /** With lock-exact seeding: allow the optimizer to drop up to N seed copies (lowest-scoring first), letting it swap them for better options. 0 = strict lock. */
  seedFuzzSwaps?: number;
  /**
   * How the generator treats seedEntries.
   * - "locked-core" (default when seeds present): all seed cards must appear; generator only adds around them.
   * - "strong-preference": seeds are very heavily weighted but the generator may cut a small number that
   *   badly break viability; any cuts are logged in diagnostics.reasoning.
   * - "inspiration": seeds are intent evidence only; generator may freely diverge from specific card choices.
   * Has no effect when seedEntries is empty.
   */
  seedPolicy?: SeedPolicy;


  /** Total deck budget cap (USD). Penalize cards that push deck over this. */
  totalBudgetUsd?: number;
  /** Max USD per individual card (hard exclude). */
  maxCardPriceUsd?: number;

  /** Curve preference (overrides archetype default). */
  speed?: SpeedProfile;
  /** Bias the threat slot toward creatures vs noncreature spells. */
  spellRatio?: SpellRatio;
  /** Boost synergy for selected deck architectures / mechanical focuses. */
  keywordFocus?: KeywordFocus[];
  /**
   * Meta archetype ids (see src/lib/meta) the deck should be weighted to beat.
   * Currently a no-op hook: threaded through to scoring but not yet consumed.
   * TODO(meta): apply counter-weighting against these targets' key cards.
   */
  metaTargets?: string[];
  /** Optional chosen-tribe support used by the Tribal Support architecture. */
  tribalSupport?: TribalSupportOptions;

  /** Target mainboard size. Competitive Standard default is 60. */
  mainboardSize?: number;
  /** Hard maximum mainboard size. Defaults to mainboardSize/default 60. */
  maxMainboardSize?: number;

  /** Generate a 15-card sideboard against typical meta archetypes. */
  generateSideboard?: boolean;
  /** Number of decks to produce (1–3). Sequential. */
  variants?: number;
  /** Optimization passes for the offline annealing loop (default 200). */
  optimizationIterations?: number;
  /** AI engine only: number of self-refinement passes (1 = single shot, 2–4 = auto-research style). */
  aiIterations?: number;
  /** AI engine only: freeform user instructions/context appended to the LLM prompt. */
  userContext?: string;
  /** Color-pie strictness multiplier on the color-affinity factor. 0 = disabled, 1 = default, 2 = aggressive. */
  colorPieStrength?: number;
  /** AI engine only: treat AI's nonland picks as locked build-around entries (guaranteed in final deck) instead of soft preferences. When true the AI has full rebuilding authority over nonland selection. */
  aiPicksAsFinal?: boolean;
  /**
   * AI engine only (requires seedEntries): instead of a single one-shot generation,
   * run a sequential improvement chain. Each step the AI sees the current partial
   * deck (already-locked cards) plus a re-scored candidate pool, proposes the next
   * batch of additions, and those become seeds for the next step — continuing until
   * the nonland budget is satisfied.
   *
   * Accepts either:
   *   - A single number  — uniform step size for every pass (2–10). E.g. `4`.
   *   - An array of numbers — per-step schedule. Step N uses index N-1; the last
   *     entry repeats for any remaining steps. E.g. `[3, 5, 2]` means step 1 adds
   *     3 cards, step 2 adds 5, all subsequent steps add 2.
   *
   * Set to 0 / undefined to disable (default one-shot behaviour).
   */
  aiSequentialStepSize?: number | number[];

  /**
   * Pre-fetched live per-archetype win-rate dataset for the target format,
   * used by Track 2 competitive-strength scoring. The main thread fetches this
   * (cache-first, see meta/liveWinRate) and threads it in so generateDecks()
   * stays pure/worker-safe. When absent, competitive strength reports
   * "data not loaded" rather than synthesizing a number.
   */
  liveWinRate?: LiveWinRateDataset | null;
}


export interface GenerationDiagnostic {
  /** Per-step human-readable trace. */
  reasoning: string[];
  /** Raw deck score from the offline weight model. */
  deckScore: number;
  /** Sum of per-card composite scores. */
  cardScoreSum: number;
  /** Distance from ideal CMC curve (lower = better). */
  curveDeviation: number;
  /** Color-source coverage by Frank-Karsten thresholds (0-1). */
  manaBaseCoverage: number;
  /** Iterations actually executed by the optimizer. */
  optimizerSteps: number;
  /** Mechanical axes used for directional source/payoff scoring. */
  primaryAxes: MechanicAxis[];
  /**
   * Per-axis confidence/coverage for the assembled deck's nonland cards,
   * strongest first. Lets consumers distinguish a dominant axis from a marginal
   * one rather than treating every entry in {@link primaryAxes} as equal.
   */
  axisConfidence?: AxisConfidence[];
}

export interface CardScoreContribution {
  oracleId: string;
  name: string;
  quantity: number;
  board: "main" | "side";
  perCopyScore: number;
  contribution: number;
  roleMultiplier: number;
  powerScore: number;
  rolePowerContribution: number;
  colorAffinity: number;
  synergyScore: number;
  synergyContribution: number;
  directionalScore: number;
  directionalContribution: number;
  synergyMultiplier?: number;
  compositionBonus?: number;
  signalScore: number;
  signalContribution: number;
  efficiencyContribution?: number;
  flexibilityContribution?: number;
  ladderContribution?: number;
  focusBonus: number;
  focusCardBonus: number;
  tribalBonus: number;
  cmcPenalty: number;
  pricePenalty: number;
}

export interface ScoreBreakdown {
  cardScores: CardScoreContribution[];
  totals: {
    cardScoreSum: number;
    curvePenalty: number;
    manaPenalty: number;
    /** Penalty for deviating from archetype's ideal role profile. */
    profilePenalty: number;
    /** Contribution from engine redundancy (sources × payoffs robustness). */
    redundancyContribution: number;
    finalScore: number;
  };
}

// ── Viability report (two explicit tracks) ─────────────────────────────────

/**
 * Track 1 — Structural soundness. Measurable from the decklist alone, with no
 * external data: mana-base coverage (Frank Karsten), curve shape, land ratio,
 * four-of density, and synergy/axis density. This is an honest quality signal
 * for the deck's construction, NOT a win-rate prediction.
 */
export interface StructuralSoundness {
  /** 0–100 aggregate structural score (weighted blend of the sub-scores). */
  score: number;
  /** 0–100 Frank-Karsten colour-source coverage. */
  manaBase: number;
  /** 0–100 curve-shape fit. */
  curve: number;
  /** 0–100 land-ratio fit. */
  landRatio: number;
  /** 0–100 four-of density (fourOfCount × 12.5, capped at 8 four-ofs). */
  fourOfDensity: number;
  /** 0–100 synergy / engine-role depth. */
  synergyDensity: number;
  /** Human-readable diagnostics for each structural sub-score. */
  notes: string[];
}

/** Why a competitive-strength signal is unavailable. */
export type CompetitiveUnavailableReason =
  | "no-market-data"     // deck did not match any tracked archetype
  | "data-not-loaded"    // no live dataset was supplied to the scorer
  | "format-unsupported"; // no live win-rate source exists for this format

/**
 * Track 2 — Competitive strength, grounded ONLY in real per-archetype win-rate
 * data. `matched` is true only when the deck matched a tracked archetype with
 * enough confidence; in that case `winRate` is a real measured number. When
 * unmatched (expected for most AI-generated/homebrew decks) NO percentage is
 * synthesized — `reason` explains the absence and the UI shows "no market data".
 */
export interface CompetitiveStrength {
  matched: boolean;
  /** Real win rate as a percentage in [0, 100] (only when matched). */
  winRate?: number;
  /** 95% confidence interval [low, high] as percentages (when available). */
  confidenceInterval?: [number, number];
  /** Sample size (games) backing the win rate. */
  sampleSize?: number;
  /** Display name of the matched tracked archetype. */
  sourceArchetype?: string;
  /** Fuzzy-match confidence 0–1 (only when matched). */
  matchConfidence?: number;
  /** Epoch ms the underlying live data was last refreshed. */
  lastUpdated?: number;
  /** Provenance host of the win-rate data. */
  source?: string;
  /** Explanation when `matched` is false. */
  reason?: CompetitiveUnavailableReason;
}

/**
 * Two-track viability assessment attached to every GenerateResult. Replaces the
 * old single blended "mythic viability %" (which mixed legitimate structural
 * math with an unvalidated static meta table). The two tracks are reported
 * distinctly so structural soundness is never confused with a win-rate claim.
 */
export interface MythicViabilityReport {
  structural: StructuralSoundness;
  competitive: CompetitiveStrength;
}

/**
 * A constraint that requires a minimum number of source cards to be present
 * in the deck whenever any payoff card for a given axis is included.
 * Oracle-text regex patterns are used to identify payoff and source cards.
 */
export interface SynergyPairConstraint {
  /** Unique identifier for the constraint (e.g. "sacrifice-outlets"). */
  id: string;
  /** Human-readable description of what the constraint enforces. */
  description: string;
  /**
   * Optional archetype filter: constraint only activates when deck archetype is
   * one of these. Omit to apply to all archetypes.
   */
  archetypes?: Archetype[];
  /** Regex patterns that match payoff card oracle text / type line. */
  payoffPatterns: RegExp[];
  /** Regex patterns that match source card oracle text / type line. */
  sourcePatterns: RegExp[];
  /** Minimum total source copies (sum of quantities) required when ≥1 payoff is present. */
  minSources: number;
}

/** A constraint violation returned by validateSynergyPairs. */
export interface SynergyViolation {
  /** ID of the constraint that was violated. */
  constraintId: string;
  /** Human-readable description of the violated constraint. */
  description: string;
  /** Names of payoff cards found in the deck (up to 5). */
  payoffCards: string[];
  /** Total source copies found in the deck. */
  sourceCount: number;
  /** Minimum sources required by the constraint. */
  requiredSources: number;
  /** "error" means zero sources — deck is non-functional; "warning" is underweight but functional. */
  severity: "error" | "warning";
}

export interface GenerateResult {
  entries: DeckEntry[];
  archetype: Archetype;
  totalCards: number;
  diagnostics: GenerationDiagnostic;
  /** Cards locked from the seed deck. Surface in the UI. */
  seededCards: CardRecord[];
  /** Build-around cards the generator intentionally included/tuned. */
  focusedCards: CardRecord[];
  /** Per-card concise explanations keyed by oracleId. */
  cardReasons: Record<string, string[]>;
  /** Numeric score details showing which cards contributed to the deck score. */
  scoreBreakdown: ScoreBreakdown;
  /** AI-engine only: free-form summary of the deck's identity (2–4 sentences). */
  aiSummary?: string;
  /** AI-engine only: free-form early/mid/late game plan (2–4 sentences). */
  aiGamePlan?: string;
  /** Mythic-viability three-pillar assessment. */
  mythicViability?: MythicViabilityReport;
  /** 0–100 tempo score: proactive pressure, flash + instant density. */
  tempoScore?: number;
  /** 0–100 card advantage score: draw spells, two-for-ones, cantrips. */
  cardAdvantageScore?: number;
  /** Synergy-pair violations produced by validateSynergyPairs. */
  synergyViolations?: SynergyViolation[];
  /**
   * Card↔card synergy relationships across the assembled deck's nonland cards
   * (source→payoff / mutual-engine / shared-axis edges with per-edge weights,
   * plus weighted density). Computed during generation to feed the reasoning
   * UI's synergy view. Absent when fewer than 2 nonland cards are present.
   */
  deckSynergyGraph?: SeedSynergyGraph;
  /**
   * AI-engine only: prominent, user-facing warnings that must NOT be buried in
   * diagnostics.reasoning. Surfaced when the pipeline silently degraded or could
   * not fully satisfy construction rules — e.g. JSON salvage was used, card
   * names were dropped as unresolved, a hard feasibility violation survived the
   * bounded re-prompt, or sequential mode fell back to the offline engine.
   */
  warnings?: string[];
  /**
   * AI-engine only, transient: signal the generation loop uses to decide whether
   * to spend its single bounded re-prompt (hard feasibility failure or
   * out-of-pool card names). Not intended for UI consumption.
   */
  repromptSignal?: AIRepromptSignal;
}

/** Feedback the AI generation loop uses to drive a single bounded re-prompt. */
export interface AIRepromptSignal {
  /** Hard feasibility rejection text to feed back to the model, if any. */
  rejectionSummary?: string;
  /** Names the resolver could not map to the legal pool (out-of-pool / hallucinated). */
  unresolvedNames: string[];
}

export interface GenerateMultiResult {
  variants: GenerateResult[];
  bestIndex: number;
}