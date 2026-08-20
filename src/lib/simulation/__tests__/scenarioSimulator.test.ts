/**
 * scenarioSimulator.test.ts — Unit coverage for role matching and scoring.
 */

import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import { canonicalScenarios } from "../scenarioLibrary";
import { computeScenarioRobustness, simulateCardAgainstScenario } from "../scenarioSimulator";
import type { OpponentScenario, ScenarioActionKind } from "../scenarioTypes";

function makeCard(overrides: Partial<CardRecord> & { name: string }): CardRecord {
  const { name, ...rest } = overrides;
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: "Instant",
    oracleText: "",
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
    setCode: "TST",
    setName: "Test",
    setType: null,
    collectorNumber: null,
    rarity: null,
    imageNormal: null,
    priceUsd: null,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: null,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: name.toLowerCase(),
    importedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  } as CardRecord;
}

function scenario(id: string, action: ScenarioActionKind, turn: number): OpponentScenario {
  return {
    id,
    name: id,
    sourceArchetypeIds: [],
    macro: "Aggro",
    turns: [{ turn, action, threatPower: action === "ramp" ? 0 : 2 }],
  };
}

describe("simulateCardAgainstScenario", () => {
  it("lets low-cost removal answer fast aggro and midrange on time, but not ramp or go-wide alone", () => {
    const removal = makeCard({ name: "Test Removal", oracleText: "Destroy target creature.", cmc: 2 });
    const scenarios = canonicalScenarios();
    const fastAggro = scenarios.find((entry) => entry.id === "fast-aggro-board")!;
    const midrange = scenarios.find((entry) => entry.id === "midrange-curve-out")!;

    expect(simulateCardAgainstScenario(removal, fastAggro).onTime).toBe(true);
    expect(simulateCardAgainstScenario(removal, midrange).onTime).toBe(true);
    expect(simulateCardAgainstScenario(removal, scenario("ramp-only", "ramp", 2))).toMatchObject({ answered: false, onTime: false });
    expect(simulateCardAgainstScenario(removal, scenario("wide-only", "go_wide", 3))).toMatchObject({ answered: false, onTime: false });
  });

  it("lets a board wipe answer go-wide pressure", () => {
    const wipe = makeCard({ name: "Test Wipe", oracleText: "Destroy all creatures.", cmc: 4 });
    expect(simulateCardAgainstScenario(wipe, scenario("wide", "go_wide", 4))).toMatchObject({ answered: true, onTime: true });
  });

  it("lets a counterspell answer held interaction and bombs but not small threats", () => {
    const counterspell = makeCard({ name: "Test Counter", oracleText: "Counter target spell.", cmc: 2 });

    expect(simulateCardAgainstScenario(counterspell, scenario("interaction", "hold_interaction", 2)).answered).toBe(true);
    expect(simulateCardAgainstScenario(counterspell, scenario("bomb", "deploy_big_threat", 4)).answered).toBe(true);
    expect(simulateCardAgainstScenario(counterspell, scenario("small", "deploy_small_threat", 2))).toMatchObject({ answered: false, onTime: false });
  });

  it("distinguishes a plausible late answer from an on-time one", () => {
    const expensiveRemoval = makeCard({ name: "Slow Removal", oracleText: "Destroy target creature.", cmc: 6 });
    const fastAggro = canonicalScenarios().find((entry) => entry.id === "fast-aggro-board")!;

    expect(simulateCardAgainstScenario(expensiveRemoval, fastAggro)).toMatchObject({
      answered: true,
      turnAnswered: 1,
      onTime: false,
    });
  });

  it("does not allow lands to answer a scenario", () => {
    const land = makeCard({ name: "Test Land", typeLine: "Basic Land — Island", cmc: 0 });
    expect(simulateCardAgainstScenario(land, scenario("small", "deploy_small_threat", 2)))
      .toMatchObject({ answered: false, onTime: false });
  });
});

describe("computeScenarioRobustness", () => {
  it("marks a vanilla creature as zero coverage across the canonical library", () => {
    const vanilla = makeCard({
      name: "Vanilla Creature",
      typeLine: "Creature — Test",
      oracleText: "",
      power: "2",
      toughness: "2",
    });
    const robustness = computeScenarioRobustness(vanilla, canonicalScenarios());

    expect(robustness.zeroCoverage).toBe(true);
    expect(robustness.scenariosAnsweredOnTime).toBe(0);
    expect(robustness.rawScore).toBe(0);
  });

  it("uses full weight for on-time coverage and 0.35 for late-only coverage", () => {
    const removal = makeCard({ name: "Two-Mana Removal", oracleText: "Destroy target creature.", cmc: 2 });
    const robustness = computeScenarioRobustness(removal, [
      scenario("on-time", "deploy_small_threat", 2),
      scenario("late", "deploy_small_threat", 1),
      scenario("unanswered", "ramp", 2),
    ]);

    expect(robustness.scenariosAnsweredOnTime).toBe(1);
    expect(robustness.totalScenarios).toBe(3);
    expect(robustness.zeroCoverage).toBe(false);
    expect(robustness.rawScore).toBe(1.35);
  });
});
