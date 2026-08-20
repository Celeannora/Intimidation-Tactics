/**
 * scenarioTypes.ts — Shared type vocabulary for opponent-plan simulation.
 *
 * These types intentionally describe coarse, deterministic game-plan signals
 * rather than attempting to model complete Magic rules or board state.
 */

import type { Archetype } from "../archetype";

/** Coarse category of a scripted opponent action a candidate card may answer. */
export type ScenarioActionKind =
  | "deploy_small_threat"
  | "deploy_big_threat"
  | "hold_interaction"
  | "go_wide"
  | "graveyard_combo_setup"
  | "ramp";

export interface ScenarioTurn {
  /** One-indexed turn number. */
  turn: number;
  /** Scripted opponent action. */
  action: ScenarioActionKind;
  /** Rough creature-power signal, or zero for a non-threat action. */
  threatPower?: number;
  /** Whether a deployed threat is considered on board from this turn onward. */
  onBoard?: boolean;
  /** Short human-readable explanation of the scripted action. */
  note?: string;
}

export interface OpponentScenario {
  /** Stable kebab-case identifier. */
  id: string;
  /** Display name. */
  name: string;
  /** Meta archetypes from which this scenario was derived. */
  sourceArchetypeIds: string[];
  /** Coarse macro archetype. */
  macro: Archetype;
  /** Ordered turn script. */
  turns: ScenarioTurn[];
}

export interface CardScenarioResult {
  scenarioId: string;
  /** Whether the card has a plausible answer role in the turn script. */
  answered: boolean;
  /** Earliest scripted matching turn, when the card has a plausible answer. */
  turnAnswered?: number;
  /** Whether any matching turn arrives no earlier than the card's mana cost. */
  onTime: boolean;
}

export interface CardScenarioRobustness {
  perScenario: CardScenarioResult[];
  /** Number of distinct scenarios with an on-time answer. */
  scenariosAnsweredOnTime: number;
  /** Number of scenarios evaluated. */
  totalScenarios: number;
  /** True only when no scenario contains a plausible answer for this card. */
  zeroCoverage: boolean;
  /** Breadth-weighted raw score before any caller-owned scalar is applied. */
  rawScore: number;
}
