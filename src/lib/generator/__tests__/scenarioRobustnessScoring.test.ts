import { describe, expect, it } from "vitest";
import type { DeckEntry } from "../../legality";
import type { CardRecord } from "../../types";
import type { OpponentScenario } from "../../simulation/scenarioTypes";
import { SEED_ROLE_TARGETS } from "../seedSynergy";
import type { GenerateOptions } from "../types";
import { cardScoreDetail, computeDeckScenarioCoverage, deckScore } from "../weights";

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Instant",
  cmc = 2,
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}",
    cmc,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine,
    oracleText,
    keywordsJson: "[]",
    power: typeLine.includes("Creature") ? "2" : null,
    toughness: typeLine.includes("Creature") ? "2" : null,
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
    searchText: `${name} ${oracleText}`,
    importedAt: "2026-01-01T00:00:00.000Z",
  } as CardRecord;
}

function scenario(id: string, action: OpponentScenario["turns"][number]["action"], turn: number): OpponentScenario {
  return {
    id,
    name: id,
    sourceArchetypeIds: [],
    macro: "Aggro",
    turns: [{ turn, action, threatPower: 2 }],
  };
}

const baseOptions: GenerateOptions = {
  engine: "offline",
  archetype: "Midrange",
  colors: [],
};

describe("scenario robustness scoring", () => {
  it("is a complete no-op when active scenarios are omitted", () => {
    const vanilla = makeCard("Vanilla", "", "Creature — Test");
    const entries: DeckEntry[] = [{ card: vanilla, quantity: 1, board: "main" }];

    const detail = cardScoreDetail(vanilla, entries, baseOptions, 3);
    const score = deckScore(entries, baseOptions, 3);

    expect(detail.scenarioRobustnessContribution).toBe(0);
    expect(detail.scenarioZeroCoverageWarning).toBe(false);
    expect(score.scenarioConsistencyContribution).toBe(0);
    expect(score.scenarioCoverage).toBeUndefined();
  });

  it("reports zero coverage as an informational warning without vetoing a card", () => {
    const vanilla = makeCard("Vanilla", "", "Creature — Test");
    const detail = cardScoreDetail(
      vanilla,
      [],
      { ...baseOptions, activeScenarios: [scenario("small-threat", "deploy_small_threat", 2)] },
      3,
    );

    expect(detail.scenarioRobustnessContribution).toBe(0);
    expect(detail.scenarioZeroCoverageWarning).toBe(true);
    expect(Number.isFinite(detail.total)).toBe(true);
  });

  it("rewards on-time answers and does not flag them as zero coverage", () => {
    const removal = makeCard("Quick Removal", "Destroy target creature.");
    const detail = cardScoreDetail(
      removal,
      [],
      { ...baseOptions, activeScenarios: [scenario("small-threat", "deploy_small_threat", 2)] },
      3,
    );

    expect(detail.scenarioRobustnessContribution).toBeGreaterThan(0);
    expect(detail.scenarioZeroCoverageWarning).toBe(false);
  });

  it("marks scenarios covered only when a deck card answers them on time", () => {
    const removal = makeCard("Quick Removal", "Destroy target creature.");
    const scenarios = [
      scenario("small-threat", "deploy_small_threat", 2),
      scenario("go-wide", "go_wide", 3),
    ];
    const coverage = computeDeckScenarioCoverage(
      [{ card: removal, quantity: 4, board: "main" }],
      scenarios,
    );

    expect(coverage).toMatchObject({
      coveredCount: 1,
      totalScenarios: 2,
      consistencyScore: 50,
    });
    expect(coverage.scenarios[0]).toMatchObject({
      covered: true,
      answeringCards: ["Quick Removal"],
      sourceArchetypeNames: [],
    });
    expect(coverage.scenarios[1]).toMatchObject({
      covered: false,
      answeringCards: [],
    });

    const score = deckScore(
      [{ card: removal, quantity: 4, board: "main" }],
      { ...baseOptions, activeScenarios: scenarios },
      3,
    );
    expect(score.scenarioConsistencyContribution).toBe(2);
    expect(score.scenarioCoverage).toEqual(coverage);
  });

  it("keeps the seed-role veto ahead of perfect scenario coverage", () => {
    const discard = makeCard("Perfect but Off-Plan", "Target player discards a card.");
    const detail = cardScoreDetail(
      discard,
      [],
      {
        ...baseOptions,
        activeScenarios: [scenario("graveyard", "graveyard_combo_setup", 2)],
        seedSynergyContext: {
          seedPackage: [{ name: "Unrelated Seed", quantity: 4 }],
          resourceSpec: null,
          anthemSpec: null,
          roleTargets: SEED_ROLE_TARGETS,
        },
      },
      3,
    );

    expect(detail.scenarioRobustnessContribution).toBeGreaterThan(0);
    expect(detail.scenarioZeroCoverageWarning).toBe(false);
    expect(detail.total).toBe(-Infinity);
    expect(detail.seedSynergyNote).toContain("fills no seed role");
  });
});
