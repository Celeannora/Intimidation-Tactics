import type { Archetype } from "../archetype";
import type { ThemeId } from "../archetypeVocab";
import type { ManaColor, CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { MechanicAxis } from "./synergyModel";
import type { ConstructedFormat, PlayEnvironment } from "../formats";

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

// ── Mythic-viability report ────────────────────────────────────────────────

/** The three structural pillars from sonar.md's mythic-viability research. */
export interface MythicViabilityPillars {
  /** 0–100: Karsten mana satisfaction + curve smoothness. */
  consistency: number;
  /** 0–100: Rule-of-9 four-of density for key threat/engine slots. */
  redundancy: number;
  /** 0–100: Threat/interaction ratio vs archetype-ideal benchmark. */
  metaPositioning: number;
}

/**
 * Composite mythic-viability assessment attached to every GenerateResult.
 * Derived from the sonar.md 55–61% win-rate research: score ≥55 maps to the
 * mythic-viable band, ≥75 maps to a tier-1 projection.
 */
export interface MythicViabilityReport {
  /** 0–100 composite score (average of the three pillars). */
  score: number;
  /** Estimated win-rate proxy: 0.45 + (score / 100) × 0.2, clamped to [0.45, 0.65]. */
  winRateEstimate: number;
  pillars: MythicViabilityPillars;
  /** Human-readable tier label derived from score. */
  label: "not-viable" | "fringe" | "mythic-viable" | "tier-1";
  /** Diagnostic messages explaining each pillar's assessment. */
  notes: string[];
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
}

export interface GenerateMultiResult {
  variants: GenerateResult[];
  bestIndex: number;
}