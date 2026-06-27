import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";
import type { Archetype } from "../archetype";
import type { GenerateOptions, GenerateResult } from "./types";
import { assignRoles, isThreat } from "../roles";

/**
 * Explicit stage contract for the offline generator.
 *
 * The current generator implementation is still orchestrated in
 * `generator.ts`, but these contracts define the stable seam future refactors
 * should move toward. A stage is pure from the caller's perspective: all
 * mutable state must live in its input/output object rather than module-level
 * globals.
 */
export interface GeneratorStage<TInput, TOutput> {
  readonly id: string;
  readonly description: string;
  run(input: TInput): TOutput;
}

export interface GeneratorPipelineContext {
  readonly options: GenerateOptions;
  readonly allCards: CardRecord[];
  readonly targetMainboardSize: number;
  readonly reasoning: string[];
}

export interface PoolBuilderOutput extends GeneratorPipelineContext {
  readonly effectiveOptions: GenerateOptions;
  readonly pool: CardRecord[];
  readonly lockedEntries: DeckEntry[];
  readonly lockedOracleIds: Set<string>;
}

export interface RoleFillOutput extends PoolBuilderOutput {
  readonly entries: DeckEntry[];
  readonly targetAvgCmc: number;
}

export interface ManaBaseOutput extends RoleFillOutput {
  readonly landBudget: number;
}

export interface OptimizationOutput extends ManaBaseOutput {
  readonly optimizedEntries: DeckEntry[];
  readonly optimizerSteps: number;
}

export interface SideboardOutput extends OptimizationOutput {
  readonly finalEntries: DeckEntry[];
}

export interface ResultAssemblyOutput {
  readonly result: GenerateResult;
}

export type OfflineGeneratorStageId =
  | "pool-builder"
  | "role-fill"
  | "mana-base"
  | "optimizer"
  | "sideboard"
  | "result-assembly";

export const OFFLINE_GENERATOR_STAGE_ORDER: readonly OfflineGeneratorStageId[] = [
  "pool-builder",
  "role-fill",
  "mana-base",
  "optimizer",
  "sideboard",
  "result-assembly",
];

/**
 * Lightweight runtime assertion used by tests and future orchestration code to
 * prevent accidental stage reordering when the monolithic generator is split.
 */
export function assertOfflineStageOrder(stageIds: readonly OfflineGeneratorStageId[]): void {
  const expected = OFFLINE_GENERATOR_STAGE_ORDER.join(" → ");
  const actual = stageIds.join(" → ");
  if (actual !== expected) {
    throw new Error(`Offline generator stages must run in order: ${expected}. Received: ${actual}`);
  }
}

// ── Rule of Nine enforcement (sonar.md Part 2) ──────────────────────────────

type RoleSlotKey = "threats" | "removal" | "boardWipes" | "counterspells" | "cardDraw" | "ramp";

const CRITICAL_SLOTS: Record<Archetype, RoleSlotKey[]> = {
  Aggro:    ["threats", "removal"],
  Midrange: ["threats", "removal", "cardDraw"],
  Control:  ["removal", "boardWipes", "counterspells", "cardDraw"],
  Tempo:    ["threats", "counterspells"],
  Combo:    ["cardDraw", "ramp"],
  Ramp:     ["ramp", "cardDraw"],
  Prison:   ["removal", "boardWipes", "counterspells"],
  Unknown:  ["threats", "removal"],
};

const MIN_CRITICAL_COPIES = 9; // "Rule of 9" — 9 cards across a role = ~3 unique spells × 3 copies each

/**
 * Enforce the Rule of Nine: any critical role slot for the archetype should
 * have ≥ MIN_CRITICAL_COPIES total card copies in the mainboard.
 *
 * Returns an array of warning strings for each slot that falls short.
 * Does NOT mutate the deck — warnings are advisory for the generator/UI.
 */
export function enforceRuleOfNine(entries: DeckEntry[], archetype: Archetype): string[] {
  const criticalSlots = CRITICAL_SLOTS[archetype] ?? CRITICAL_SLOTS.Unknown;
  const warnings: string[] = [];

  const mainboard = entries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"));

  const slotCounts: Record<RoleSlotKey, number> = {
    threats: 0, removal: 0, boardWipes: 0, counterspells: 0, cardDraw: 0, ramp: 0,
  };

  for (const entry of mainboard) {
    const roles = assignRoles(entry.card);
    if (isThreat(roles)) slotCounts["threats"] += entry.quantity;
    if (roles.includes("Removal")) slotCounts["removal"] += entry.quantity;
    if (roles.includes("BoardWipe")) slotCounts["boardWipes"] += entry.quantity;
    if (roles.includes("Counterspell")) slotCounts["counterspells"] += entry.quantity;
    if (roles.includes("CardDraw")) slotCounts["cardDraw"] += entry.quantity;
    if (roles.includes("Ramp")) slotCounts["ramp"] += entry.quantity;
  }

  for (const slot of criticalSlots) {
    const count = slotCounts[slot];
    if (count < MIN_CRITICAL_COPIES) {
      warnings.push(
        `Rule of Nine: ${slot} slot has only ${count} card${count !== 1 ? "s" : ""} — recommended ≥ ${MIN_CRITICAL_COPIES} for reliable access (${archetype}).`,
      );
    }
  }

  return warnings;
}
