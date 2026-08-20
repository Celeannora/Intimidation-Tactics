/**
 * scenarioLibrary.ts — Deterministic opponent-plan scenario selection.
 *
 * The library offers a stable canonical fallback plus snapshot-derived scripts
 * so consumers can evaluate coverage without fetching data or mutating state.
 */

import type { Archetype } from "../archetype";
import type { MetaArchetype, MetaSnapshot, MetaSpeed } from "../meta/types";
import type { OpponentScenario, ScenarioTurn } from "./scenarioTypes";

const SPEEDS: MetaSpeed[] = ["fast", "medium", "slow"];

/**
 * Return six hand-authored scenarios that cover the major interaction tests a
 * broadly useful card should pass when no sufficiently rich meta snapshot exists.
 */
export function canonicalScenarios(): OpponentScenario[] {
  return [
    {
      id: "fast-aggro-board",
      name: "Fast Aggro Board",
      sourceArchetypeIds: [],
      macro: "Aggro",
      turns: [
        turn(1, "deploy_small_threat", 1, "One-drop attacker."),
        turn(2, "deploy_small_threat", 2, "Second efficient attacker."),
        turn(3, "deploy_small_threat", 3, "The pressure curve continues."),
        turn(4, "go_wide", 3, "Several small attackers widen the board."),
      ],
    },
    {
      id: "midrange-curve-out",
      name: "Midrange Threat Curve-Out",
      sourceArchetypeIds: [],
      macro: "Midrange",
      turns: [
        turn(2, "deploy_small_threat", 2, "Early value threat."),
        turn(3, "deploy_small_threat", 3, "Mid-curve threat."),
        turn(4, "deploy_big_threat", 4, "Must-answer midrange permanent."),
        turn(5, "deploy_big_threat", 5, "Top-end stabilizer."),
      ],
    },
    {
      id: "ramp-into-bomb",
      name: "Ramp Into a Bomb",
      sourceArchetypeIds: [],
      macro: "Ramp",
      turns: [
        turn(1, "ramp", 0, "Early mana acceleration."),
        turn(2, "ramp", 0, "Additional mana acceleration."),
        turn(4, "deploy_big_threat", 7, "Accelerated seven-power bomb."),
        turn(5, "deploy_big_threat", 8, "Follow-up large threat."),
      ],
    },
    {
      id: "control-holding-interaction",
      name: "Control Holding Interaction",
      sourceArchetypeIds: [],
      macro: "Control",
      turns: [
        turn(2, "hold_interaction", 0, "Keeps mana open for disruption."),
        turn(3, "hold_interaction", 0, "Continues to represent interaction."),
        turn(4, "hold_interaction", 0, "Protects a long-game posture."),
        turn(5, "hold_interaction", 0, "Maintains open mana rather than developing."),
      ],
    },
    {
      id: "go-wide-tokens",
      name: "Go-Wide Tokens",
      sourceArchetypeIds: [],
      macro: "Aggro",
      turns: [
        turn(3, "go_wide", 2, "Token maker creates a broad board."),
        turn(4, "go_wide", 3, "A second wave widens the board."),
        turn(5, "go_wide", 4, "Wide board threatens a decisive attack."),
        turn(6, "go_wide", 4, "More token pressure compounds the board."),
      ],
    },
    {
      id: "graveyard-combo-setup",
      name: "Graveyard Combo Setup",
      sourceArchetypeIds: [],
      macro: "Combo",
      turns: [
        turn(2, "graveyard_combo_setup", 0, "Self-mill or discard-for-value setup."),
        turn(3, "graveyard_combo_setup", 0, "Assembles more graveyard resources."),
        turn(4, "graveyard_combo_setup", 0, "Advances the combo plan."),
        turn(5, "graveyard_combo_setup", 0, "Readies a payoff turn."),
      ],
    },
  ];
}

/**
 * Derive up to `count` scenarios from a snapshot. Archetypes are chosen in
 * speed-tier round-robin order, with a fresh macro preferred within each tier
 * when possible, before falling back to the remaining highest-share entries.
 */
export function deriveScenariosFromSnapshot(snapshot: MetaSnapshot, count = 6): OpponentScenario[] {
  const target = Math.max(0, Math.floor(count));
  if (target === 0 || snapshot.archetypes.length === 0) return [];

  const selected = selectDiverseArchetypes(snapshot.archetypes, target);
  return selected.map((archetype) => ({
    id: `meta-${archetype.id}`,
    name: `${archetype.name} Scenario`,
    sourceArchetypeIds: [archetype.id],
    macro: archetype.macro,
    turns: scriptForArchetype(archetype),
  }));
}

/**
 * Get the current deterministic scenario set. A snapshot needs at least three
 * archetypes before it is varied enough to replace the canonical fallback.
 */
export function getActiveScenarios(snapshot?: MetaSnapshot): OpponentScenario[] {
  return snapshot && snapshot.archetypes.length >= 3
    ? deriveScenariosFromSnapshot(snapshot)
    : canonicalScenarios();
}

function selectDiverseArchetypes(archetypes: MetaArchetype[], count: number): MetaArchetype[] {
  const bySpeed = new Map<MetaSpeed, MetaArchetype[]>(
    SPEEDS.map((speed) => [
      speed,
      archetypes
        .filter((archetype) => archetype.speed === speed)
        .sort(byMetaShare),
    ]),
  );
  const selected: MetaArchetype[] = [];
  const selectedIds = new Set<string>();
  const selectedMacros = new Set<Archetype>();

  while (selected.length < count) {
    let addedThisRound = false;
    for (const speed of SPEEDS) {
      if (selected.length >= count) break;
      const candidates = (bySpeed.get(speed) ?? []).filter((archetype) => !selectedIds.has(archetype.id));
      if (candidates.length === 0) continue;

      const choice = candidates.find((archetype) => !selectedMacros.has(archetype.macro)) ?? candidates[0];
      selected.push(choice);
      selectedIds.add(choice.id);
      selectedMacros.add(choice.macro);
      addedThisRound = true;
    }
    if (!addedThisRound) break;
  }

  if (selected.length >= count) return selected;
  for (const archetype of [...archetypes].sort(byMetaShare)) {
    if (selected.length >= count) break;
    if (selectedIds.has(archetype.id)) continue;
    selected.push(archetype);
    selectedIds.add(archetype.id);
  }
  return selected;
}

function byMetaShare(a: MetaArchetype, b: MetaArchetype): number {
  return b.metaShare - a.metaShare || a.id.localeCompare(b.id);
}

function scriptForArchetype(archetype: MetaArchetype): ScenarioTurn[] {
  switch (archetype.macro) {
    case "Aggro":
    case "Tempo":
      return aggressiveScript(archetype.speed);
    case "Ramp":
      return rampScript(archetype.speed);
    case "Control":
    case "Prison":
      return interactionScript(archetype.speed);
    case "Combo":
      return graveyardComboScript(archetype.speed);
    case "Midrange":
    case "Unknown":
      return midrangeScript(archetype.speed);
  }
}

function aggressiveScript(speed: MetaSpeed): ScenarioTurn[] {
  const firstTurn = speed === "fast" ? 1 : speed === "medium" ? 2 : 3;
  return [
    turn(firstTurn, "deploy_small_threat", 1, "Early aggressive threat."),
    turn(firstTurn + 1, "deploy_small_threat", 2, "Second aggressive threat."),
    turn(firstTurn + 2, "deploy_small_threat", 3, "Pressure continues up the curve."),
    turn(firstTurn + 3, "go_wide", 3, "The attacker count widens."),
  ];
}

function midrangeScript(speed: MetaSpeed): ScenarioTurn[] {
  const firstTurn = speed === "fast" ? 1 : speed === "medium" ? 2 : 3;
  return [
    turn(firstTurn, "deploy_small_threat", 2, "Early value threat."),
    turn(firstTurn + 1, "deploy_small_threat", 3, "Mid-curve permanent."),
    turn(firstTurn + 2, "deploy_big_threat", 4, "Large must-answer threat."),
    turn(firstTurn + 3, "deploy_big_threat", 5, "Top-end threat."),
  ];
}

function rampScript(speed: MetaSpeed): ScenarioTurn[] {
  if (speed === "fast") {
    return [
      turn(1, "ramp", 0, "Early mana acceleration."),
      turn(2, "ramp", 0, "Additional mana acceleration."),
      turn(4, "deploy_big_threat", 6, "Accelerated bomb."),
      turn(5, "deploy_big_threat", 7, "Follow-up threat."),
    ];
  }
  if (speed === "medium") {
    return [
      turn(2, "ramp", 0, "Mana acceleration."),
      turn(3, "ramp", 0, "More mana acceleration."),
      turn(5, "deploy_big_threat", 7, "Ramp payoff bomb."),
      turn(6, "deploy_big_threat", 8, "Top-end follow-up."),
    ];
  }
  return [
    turn(2, "ramp", 0, "Early mana acceleration."),
    turn(3, "ramp", 0, "Additional mana acceleration."),
    turn(5, "deploy_big_threat", 7, "Large slow-game bomb."),
    turn(6, "deploy_big_threat", 8, "Top-end follow-up."),
  ];
}

function interactionScript(speed: MetaSpeed): ScenarioTurn[] {
  const firstTurn = speed === "fast" ? 1 : speed === "medium" ? 2 : 3;
  return [
    turn(firstTurn, "hold_interaction", 0, "Keeps mana open for interaction."),
    turn(firstTurn + 1, "hold_interaction", 0, "Continues representing disruption."),
    turn(firstTurn + 2, "hold_interaction", 0, "Maintains a reactive posture."),
    turn(firstTurn + 3, "hold_interaction", 0, "Preserves mana for a counter or removal spell."),
  ];
}

function graveyardComboScript(speed: MetaSpeed): ScenarioTurn[] {
  const firstTurn = speed === "fast" ? 1 : speed === "medium" ? 2 : 3;
  return [
    turn(firstTurn, "graveyard_combo_setup", 0, "Initial graveyard setup."),
    turn(firstTurn + 1, "graveyard_combo_setup", 0, "Adds combo resources."),
    turn(firstTurn + 2, "graveyard_combo_setup", 0, "Builds toward a payoff."),
    turn(firstTurn + 3, "graveyard_combo_setup", 0, "Completes the setup sequence."),
  ];
}

function turn(
  turnNumber: number,
  action: ScenarioTurn["action"],
  threatPower: number,
  note: string,
): ScenarioTurn {
  return {
    turn: turnNumber,
    action,
    threatPower,
    onBoard: action === "deploy_small_threat" || action === "deploy_big_threat",
    note,
  };
}
