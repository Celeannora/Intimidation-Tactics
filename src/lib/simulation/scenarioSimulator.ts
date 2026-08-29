/**
 * scenarioSimulator.ts — Pure role-based card coverage against opponent plans.
 *
 * This is an explainable heuristic rather than a rules engine: it compares the
 * existing role classifier with coarse scripted actions and a simple mana clock.
 */

import type { CardRecord } from "../types";
import { assignRoles, type CardRole } from "../roles";
import type {
  CardScenarioResult,
  CardScenarioRobustness,
  OpponentScenario,
  ScenarioActionKind,
} from "./scenarioTypes";

const LATE_ANSWER_WEIGHT = 0.35;

/** Return the role signature that plausibly answers one coarse opponent action. */
export function answerSignature(kind: ScenarioActionKind): {
  roles: CardRole[];
  requiresInstantSpeedOrCheap?: boolean;
} {
  switch (kind) {
    case "deploy_small_threat":
      return { roles: ["Removal", "BoardWipe"] };
    case "deploy_big_threat":
      return { roles: ["Removal", "BoardWipe", "Counterspell"] };
    case "hold_interaction":
      return { roles: ["Counterspell", "Discard"] };
    case "go_wide":
      return { roles: ["BoardWipe"] };
    case "graveyard_combo_setup":
      return { roles: ["GraveyardHate", "Discard"] };
    case "ramp":
      return { roles: [] };
  }
}

/**
 * Simulate one candidate against one scripted opponent plan.
 *
 * On-time assumes the player makes one land drop per turn on the play, so a
 * card is available at turn `card.cmc` without modelling acceleration or color.
 */
export function simulateCardAgainstScenario(card: CardRecord, scenario: OpponentScenario): CardScenarioResult {
  if (card.typeLine.includes("Land")) {
    return { scenarioId: scenario.id, answered: false, onTime: false };
  }

  const roles = assignRoles(card);
  let earliestMatchingTurn: number | undefined;
  let onTime = false;

  for (const scenarioTurn of scenario.turns) {
    const signature = answerSignature(scenarioTurn.action);
    const matches = signature.roles.some((role) => roles.includes(role));
    if (!matches) continue;

    if (earliestMatchingTurn === undefined) earliestMatchingTurn = scenarioTurn.turn;
    if (card.cmc <= scenarioTurn.turn) onTime = true;
  }

  if (earliestMatchingTurn === undefined) {
    return { scenarioId: scenario.id, answered: false, onTime: false };
  }

  return {
    scenarioId: scenario.id,
    answered: true,
    turnAnswered: earliestMatchingTurn,
    onTime,
  };
}

/**
 * Aggregate scenario coverage for a card. The raw score is breadth-weighted:
 * on-time answers add 1.0 and late-only answers add 0.35, for an expected range
 * from 0 to the number of evaluated scenarios.
 */
export function computeScenarioRobustness(
  card: CardRecord,
  scenarios: OpponentScenario[],
): CardScenarioRobustness {
  const perScenario = scenarios.map((scenario) => simulateCardAgainstScenario(card, scenario));
  const scenariosAnsweredOnTime = perScenario.filter((result) => result.onTime).length;
  const answeredButLateCount = perScenario.filter((result) => result.answered && !result.onTime).length;

  return {
    perScenario,
    scenariosAnsweredOnTime,
    totalScenarios: scenarios.length,
    zeroCoverage: perScenario.every((result) => !result.answered),
    rawScore: scenariosAnsweredOnTime + answeredButLateCount * LATE_ANSWER_WEIGHT,
  };
}
