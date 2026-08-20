/**
 * scenarioLibrary.test.ts — Unit coverage for canonical and snapshot scenarios.
 */

import { describe, expect, it } from "vitest";
import type { Archetype } from "../../archetype";
import type { MetaArchetype, MetaSnapshot, MetaSpeed } from "../../meta/types";
import { canonicalScenarios, deriveScenariosFromSnapshot, getActiveScenarios } from "../scenarioLibrary";

function makeArchetype(
  id: string,
  speed: MetaSpeed,
  macro: Archetype,
  metaShare: number,
): MetaArchetype {
  return {
    id,
    name: id.replace(/-/g, " "),
    colors: [],
    macro,
    metaShare,
    keyCards: [],
    commonInteraction: [],
    speed,
  };
}

function makeSnapshot(archetypes: MetaArchetype[]): MetaSnapshot {
  return {
    schemaVersion: 1,
    format: "standard",
    updatedAt: "2026-01-01T00:00:00.000Z",
    source: "test",
    archetypes,
  };
}

describe("canonicalScenarios", () => {
  it("returns six ordered, non-empty canonical scripts", () => {
    const scenarios = canonicalScenarios();

    expect(scenarios).toHaveLength(6);
    expect(scenarios.every((scenario) => scenario.sourceArchetypeIds.length === 0)).toBe(true);
    expect(scenarios.every((scenario) => scenario.turns.length >= 4)).toBe(true);
    expect(scenarios.every((scenario) => (
      scenario.turns.every((scenarioTurn, index, turns) => index === 0 || scenarioTurn.turn > turns[index - 1].turn)
    ))).toBe(true);
  });
});

describe("getActiveScenarios", () => {
  it("uses canonical scenarios without a snapshot or with fewer than three archetypes", () => {
    expect(getActiveScenarios().map((scenario) => scenario.id)).toEqual(canonicalScenarios().map((scenario) => scenario.id));

    const sparseSnapshot = makeSnapshot([
      makeArchetype("fast-aggro", "fast", "Aggro", 0.4),
      makeArchetype("slow-control", "slow", "Control", 0.3),
    ]);
    expect(getActiveScenarios(sparseSnapshot).map((scenario) => scenario.id))
      .toEqual(canonicalScenarios().map((scenario) => scenario.id));
  });

  it("uses meta-derived scenarios once the snapshot has at least three archetypes", () => {
    const snapshot = makeSnapshot([
      makeArchetype("fast-aggro", "fast", "Aggro", 0.4),
      makeArchetype("medium-midrange", "medium", "Midrange", 0.3),
      makeArchetype("slow-control", "slow", "Control", 0.2),
    ]);
    const scenarios = getActiveScenarios(snapshot);

    expect(scenarios).toHaveLength(3);
    expect(scenarios.every((scenario) => scenario.sourceArchetypeIds.length > 0)).toBe(true);
  });
});

describe("deriveScenariosFromSnapshot", () => {
  it("round-robins speed tiers instead of selecting only fast archetypes", () => {
    const snapshot = makeSnapshot([
      makeArchetype("fast-aggro-a", "fast", "Aggro", 0.9),
      makeArchetype("fast-aggro-b", "fast", "Aggro", 0.8),
      makeArchetype("medium-midrange", "medium", "Midrange", 0.3),
      makeArchetype("slow-control", "slow", "Control", 0.2),
    ]);
    const scenarios = deriveScenariosFromSnapshot(snapshot, 3);

    expect(scenarios.map((scenario) => scenario.sourceArchetypeIds[0])).toEqual([
      "fast-aggro-a",
      "medium-midrange",
      "slow-control",
    ]);
  });
});
