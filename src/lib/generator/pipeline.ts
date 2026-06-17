import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";
import type { GenerateOptions, GenerateResult } from "./types";

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