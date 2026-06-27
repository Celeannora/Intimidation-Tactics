/**
 * mythicViability.test.ts
 *
 * Unit tests for the three-pillar mythic-viability scorer.
 * Uses lightweight in-memory DeckEntry mocks — no real Scryfall data needed.
 */

import { describe, it, expect } from "vitest";
import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";
import {
  computeConsistencyPillar,
  computeRedundancyPillar,
  computeMetaPositioningPillar,
  computeMythicViability,
  winRateProxy,
  mythicViabilityLabel,
} from "../mythicViability";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardRecord>): CardRecord {
  return {
    id: "fake-id",
    oracleId: "fake-oracle",
    name: "Test Card",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{2}{W}",
    cmc: 3,
    colorsJson: '["W"]',
    colorIdentityJson: '["W"]',
    typeLine: "Creature — Human",
    oracleText: "",
    keywordsJson: "[]",
    power: "2",
    toughness: "2",
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: "legal",
    bannedInStandard: 0,
    legalitiesJson: "{}",
    setCode: "TEST",
    setName: "Test Set",
    setType: null,
    collectorNumber: null,
    rarity: "common",
    imageNormal: null,
    priceUsd: 0.10,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: 1000,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "test card",
    importedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

function makeEntry(overrides: Partial<CardRecord> & { quantity?: number; board?: "main" | "side" }): DeckEntry {
  const { quantity = 4, board = "main", ...cardOverrides } = overrides;
  return { card: makeCard(cardOverrides), quantity, board };
}

function makeLand(name: string, qty: number): DeckEntry {
  return makeEntry({
    name,
    typeLine: "Basic Land — Plains",
    cmc: 0,
    oracleText: "{T}: Add {W}.",
    quantity: qty,
    keywordsJson: "[]",
  });
}

/** Build a minimal 60-card deck: 24 lands + 36 nonlands. */
function make60CardDeck(): DeckEntry[] {
  return [
    // 16x 2-drop threats
    makeEntry({ name: "Creature A", cmc: 2, oracleText: "", quantity: 4, oracleId: "c-a" }),
    makeEntry({ name: "Creature B", cmc: 2, oracleText: "", quantity: 4, oracleId: "c-b" }),
    makeEntry({ name: "Creature C", cmc: 2, oracleText: "", quantity: 4, oracleId: "c-c" }),
    makeEntry({ name: "Creature D", cmc: 2, oracleText: "", quantity: 4, oracleId: "c-d" }),
    // 8x removal
    makeEntry({ name: "Kill Spell", cmc: 2, oracleText: "Destroy target creature.", quantity: 4, oracleId: "kill-1" }),
    makeEntry({ name: "Kill Spell 2", cmc: 3, oracleText: "Exile target creature.", quantity: 4, oracleId: "kill-2" }),
    // 4x draw
    makeEntry({ name: "Draw Spell", cmc: 2, oracleText: "Draw two cards.", quantity: 4, oracleId: "draw-1" }),
    // 4x ramp
    makeEntry({ name: "Ramp Spell", cmc: 2, oracleText: "Add {G}.", quantity: 4, oracleId: "ramp-1" }),
    // 4x misc
    makeEntry({ name: "Misc A", cmc: 3, oracleText: "", quantity: 4, oracleId: "misc-a" }),
    // 24x lands
    makeLand("Plains", 24),
  ];
}

// ── winRateProxy ─────────────────────────────────────────────────────────────

describe("winRateProxy", () => {
  it("returns a number near 42 for score 0", () => {
    expect(winRateProxy(0)).toBeCloseTo(42.0, 0);
  });

  it("returns a number near 52 for score 50", () => {
    expect(winRateProxy(50)).toBeCloseTo(52.0, 0);
  });

  it("higher score gives higher win-rate estimate", () => {
    expect(winRateProxy(80)).toBeGreaterThan(winRateProxy(40));
  });

  it("never returns NaN", () => {
    for (const score of [0, 25, 50, 75, 100]) {
      expect(Number.isFinite(winRateProxy(score))).toBe(true);
    }
  });
});

// ── mythicViabilityLabel ──────────────────────────────────────────────────────

describe("mythicViabilityLabel", () => {
  it("returns 'tier-1' for score >= 70", () => {
    expect(mythicViabilityLabel(70)).toBe("tier-1");
    expect(mythicViabilityLabel(100)).toBe("tier-1");
  });

  it("returns 'mythic-viable' for score 55-69", () => {
    expect(mythicViabilityLabel(55)).toBe("mythic-viable");
    expect(mythicViabilityLabel(69)).toBe("mythic-viable");
  });

  it("returns 'fringe' for score 35-54", () => {
    expect(mythicViabilityLabel(35)).toBe("fringe");
    expect(mythicViabilityLabel(54)).toBe("fringe");
  });

  it("returns 'not-viable' for score < 35", () => {
    expect(mythicViabilityLabel(0)).toBe("not-viable");
    expect(mythicViabilityLabel(34)).toBe("not-viable");
  });
});

// ── computeConsistencyPillar ──────────────────────────────────────────────────

describe("computeConsistencyPillar", () => {
  it("returns 0 for empty deck", () => {
    expect(computeConsistencyPillar([])).toBe(0);
  });

  it("returns 0-100 range for valid decks", () => {
    const score = computeConsistencyPillar(make60CardDeck());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("rewards 36-43% land ratio (24/60 lands)", () => {
    const score = computeConsistencyPillar(make60CardDeck());
    // 24/60 = 40% land ratio → should get full land score
    expect(score).toBeGreaterThan(50);
  });

  it("penalizes decks with too few lands", () => {
    const deck = make60CardDeck();
    // Replace all lands with creatures ~60 creatures, 0 lands
    const fewLandsDeck = deck.filter((e) => !e.card.typeLine.includes("Land"));
    expect(computeConsistencyPillar(fewLandsDeck)).toBeLessThan(computeConsistencyPillar(make60CardDeck()));
  });

  it("penalizes high-curve decks (avg CMC > 4.5)", () => {
    const highCurveDeck: DeckEntry[] = [
      makeEntry({ name: "Big Spell", cmc: 7, quantity: 36, oracleId: "big" }),
      makeLand("Plains", 24),
    ];
    const score = computeConsistencyPillar(highCurveDeck);
    expect(score).toBeLessThan(70);
  });

  it("rewards four-of density", () => {
    const fourOfDeck = make60CardDeck(); // has multiple 4-ofs
    const singletonDeck: DeckEntry[] = [
      // 36 singletons
      ...Array.from({ length: 36 }, (_, i) => makeEntry({ name: `Card ${i}`, oracleId: `card-${i}`, cmc: 2, quantity: 1 })),
      makeLand("Plains", 24),
    ];
    expect(computeConsistencyPillar(fourOfDeck)).toBeGreaterThan(computeConsistencyPillar(singletonDeck));
  });
});

// ── computeRedundancyPillar ───────────────────────────────────────────────────

describe("computeRedundancyPillar", () => {
  it("returns 0 for empty deck", () => {
    expect(computeRedundancyPillar([])).toBe(0);
  });

  it("returns 0-100 for valid decks", () => {
    const score = computeRedundancyPillar(make60CardDeck());
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });

  it("rewards decks with deep role coverage (threats + removal + draw)", () => {
    const deepDeck = make60CardDeck(); // has 16 threats-ish, 8 removal, 4 draw
    const score = computeRedundancyPillar(deepDeck);
    expect(score).toBeGreaterThan(0);
  });

  it("penalizes decks missing critical roles", () => {
    const missingRoles: DeckEntry[] = [
      makeEntry({ name: "Misc 1", cmc: 2, oracleText: "Gain 2 life.", quantity: 4, oracleId: "m1" }),
      makeEntry({ name: "Misc 2", cmc: 2, oracleText: "Gain 2 life.", quantity: 4, oracleId: "m2" }),
      makeLand("Plains", 24),
    ];
    expect(computeRedundancyPillar(missingRoles)).toBeLessThan(
      computeRedundancyPillar(make60CardDeck())
    );
  });
});

// ── computeMetaPositioningPillar ──────────────────────────────────────────────

describe("computeMetaPositioningPillar", () => {
  it("returns 0-100 for any archetype", () => {
    const archetypes = ["Aggro", "Midrange", "Control", "Tempo", "Combo", "Ramp", "Prison", "Unknown"] as const;
    for (const arch of archetypes) {
      const score = computeMetaPositioningPillar(make60CardDeck(), arch);
      expect(score).toBeGreaterThanOrEqual(0);
      expect(score).toBeLessThanOrEqual(100);
    }
  });

  it("Midrange gets higher base score than Prison", () => {
    const midrange = computeMetaPositioningPillar(make60CardDeck(), "Midrange");
    const prison = computeMetaPositioningPillar(make60CardDeck(), "Prison");
    expect(midrange).toBeGreaterThan(prison);
  });

  it("Unknown archetype still returns a number in range", () => {
    const score = computeMetaPositioningPillar(make60CardDeck(), "Unknown");
    expect(score).toBeGreaterThanOrEqual(0);
    expect(score).toBeLessThanOrEqual(100);
  });
});

// ── computeMythicViability (composite) ───────────────────────────────────────

describe("computeMythicViability", () => {
  it("returns all required fields", () => {
    const report = computeMythicViability(make60CardDeck(), "Midrange");
    expect(report).toHaveProperty("score");
    expect(report).toHaveProperty("winRateEstimate");
    expect(report).toHaveProperty("pillars");
    expect(report).toHaveProperty("label");
    expect(report).toHaveProperty("notes");
    expect(report.pillars).toHaveProperty("consistency");
    expect(report.pillars).toHaveProperty("redundancy");
    expect(report.pillars).toHaveProperty("metaPositioning");
  });

  it("score is between 0 and 100", () => {
    const report = computeMythicViability(make60CardDeck(), "Midrange");
    expect(report.score).toBeGreaterThanOrEqual(0);
    expect(report.score).toBeLessThanOrEqual(100);
  });

  it("label is one of the four valid tiers", () => {
    const validLabels = ["not-viable", "fringe", "mythic-viable", "tier-1"];
    const report = computeMythicViability(make60CardDeck(), "Aggro");
    expect(validLabels).toContain(report.label);
  });

  it("notes array has at least one entry", () => {
    const report = computeMythicViability(make60CardDeck(), "Control");
    expect(report.notes.length).toBeGreaterThan(0);
  });

  it("does not produce NaN in any field", () => {
    const report = computeMythicViability(make60CardDeck(), "Combo");
    expect(Number.isFinite(report.score)).toBe(true);
    expect(Number.isFinite(report.winRateEstimate)).toBe(true);
    expect(Number.isFinite(report.pillars.consistency)).toBe(true);
    expect(Number.isFinite(report.pillars.redundancy)).toBe(true);
    expect(Number.isFinite(report.pillars.metaPositioning)).toBe(true);
  });

  it("empty deck returns score 0 and not-viable label", () => {
    const report = computeMythicViability([], "Aggro");
    expect(report.score).toBe(0);
    expect(report.label).toBe("not-viable");
  });

  it("well-built deck scores better than empty deck", () => {
    const goodDeck = computeMythicViability(make60CardDeck(), "Midrange");
    const emptyDeck = computeMythicViability([], "Midrange");
    expect(goodDeck.score).toBeGreaterThan(emptyDeck.score);
  });
});
