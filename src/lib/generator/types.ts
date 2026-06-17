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
}

export interface GenerateMultiResult {
  variants: GenerateResult[];
  bestIndex: number;
}