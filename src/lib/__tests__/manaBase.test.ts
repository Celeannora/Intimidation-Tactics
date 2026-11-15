import { describe, expect, it } from "vitest";
import { recommendLandCount, recommendColorSources } from "../manaBase";
import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";

function makeCard(overrides: Partial<CardRecord> & { cmc: number }): CardRecord {
  return {
    id: overrides.id ?? "id-" + Math.random(),
    oracleId: overrides.oracleId ?? "oid-" + Math.random(),
    name: overrides.name ?? "Test Spell",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: overrides.manaCost ?? "{1}",
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: overrides.typeLine ?? "Creature",
    oracleText: overrides.oracleText ?? null,
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
    setCode: "tst",
    setName: "Test",
    setType: "expansion",
    collectorNumber: "1",
    rarity: "common",
    imageNormal: null,
    priceUsd: null,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: null,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "",
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

/**
 * Build a 60-card-equivalent deck whose nonland average CMC ≈ targetCmc.
 * Uses 36 nonlands at the given CMC for simplicity — recommendLandCount only
 * looks at the nonland average, not the actual land count in the input.
 */
function buildDeck(avgCmc: number): DeckEntry[] {
  return [
    {
      card: makeCard({ cmc: avgCmc, typeLine: "Creature" }),
      quantity: 36,
      board: "main",
    },
  ];
}

describe("recommendLandCount", () => {
  it("recommends more lands for higher average CMC", () => {
    const low  = recommendLandCount(buildDeck(2.0));
    const high = recommendLandCount(buildDeck(3.5));
    expect(high.recommended).toBeGreaterThan(low.recommended);
  });

  it("stays within 18–27 across reasonable CMC ranges", () => {
    for (const cmc of [1.5, 2.0, 2.5, 3.0, 3.5, 4.0]) {
      const result = recommendLandCount(buildDeck(cmc));
      expect(result.recommended).toBeGreaterThanOrEqual(18);
      expect(result.recommended).toBeLessThanOrEqual(27);
    }
  });

  it("returns default for empty deck", () => {
    const result = recommendLandCount([]);
    expect(result.recommended).toBe(24);
    expect(result.avgManaValue).toBe(0);
  });
});

describe("source demand selection", () => {
  it("still rounds a positive half-pip up for conservative Karsten lookup", () => {
    const spell: DeckEntry = { card: makeCard({ cmc: 1, manaCost: "{W/P}" }), quantity: 4, board: "main" };
    expect(recommendColorSources([spell], 0)[0]).toMatchObject({
      pips: 2, recommendedSources: 14, requiredPips: 1, requiredByTurn: 1,
      criticallyUndersourced: true,
    });
  });

  it.each([false, true])("selects WW on turn two over WWW on turn eight (reverse=%s)", reverse => {
    const spells: DeckEntry[] = [
      { card: makeCard({ cmc: 2, manaCost: "{W}{W}" }), quantity: 4, board: "main" },
      { card: makeCard({ cmc: 8, manaCost: "{5}{W}{W}{W}" }), quantity: 4, board: "main" },
    ];
    if (reverse) spells.reverse();
    const lands: DeckEntry = { card: makeCard({ cmc: 0, typeLine: "Basic Land", producedManaJson: '["W"]' }), quantity: 17, board: "main" };
    expect(recommendColorSources([...spells, lands], 17)[0]).toMatchObject({
      recommendedSources: 20, requiredPips: 2, requiredByTurn: 2,
      actualSources: 17, criticallyUndersourced: true,
    });
    expect(recommendColorSources([...spells, { ...lands, quantity: 20 }], 20)[0].criticallyUndersourced).toBe(false);
  });
});
