/**
 * scoreEngine.test.ts
 *
 * Unit tests for the V2 unified scoring pipeline (computeCompositeScore,
 * scoreCandidates). These tests anchor the most critical invariants:
 *
 *   - Scores are non-negative.
 *   - castability penalty grows as probability falls toward zero.
 *   - At perfect castability, castabilityPenalty is exactly 0.
 *   - scoreCandidates returns cards sorted highest-to-lowest.
 *   - All CompositeScore fields are present and finite.
 *   - Adding a perfect-fit card to an empty deck yields a higher score than a
 *     completely off-plan card.
 *
 * These tests do NOT lock specific numeric totals — that is the calibration
 * harness's job (scripts/calibrate.ts). They only enforce structural invariants
 * and directional correctness.
 */

import { describe, expect, it } from "vitest";
import { computeCompositeScore, scoreCandidates, type CompositeScore } from "../scoreEngine";
import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";

// ────────────────────────────────────────────────────────────────────────────
// Test helpers
// ────────────────────────────────────────────────────────────────────────────

function makeCard(
  overrides: Partial<CardRecord> & { name: string }
): CardRecord {
  const { name, ...rest } = overrides;
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{2}{G}",
    cmc: 2,
    colorsJson: JSON.stringify(["G"]),
    colorIdentityJson: JSON.stringify(["G"]),
    typeLine: "Creature — Beast",
    oracleText: "",
    keywordsJson: "[]",
    power: "2",
    toughness: "2",
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: "legal" }),
    setCode: "TST",
    setName: "Test Set",
    setType: null,
    collectorNumber: null,
    rarity: "common",
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

function makeEntry(card: CardRecord, qty = 1): DeckEntry {
  return { card, quantity: qty, board: "main" };
}

const AGGRO_OPTIONS = { archetype: "Aggro" as const };
const MIDRANGE_OPTIONS = { archetype: "Midrange" as const };
const CONTROL_OPTIONS = { archetype: "Control" as const };

// ────────────────────────────────────────────────────────────────────────────
// computeCompositeScore — structural invariants
// ────────────────────────────────────────────────────────────────────────────

describe("computeCompositeScore — structural invariants", () => {
  it("returns all required fields with finite values", () => {
    const card = makeCard({ name: "Ground Shaker", typeLine: "Creature — Elephant" });
    const result: CompositeScore = computeCompositeScore(card, [], MIDRANGE_OPTIONS);

    const requiredFields: Array<keyof CompositeScore> = [
      "total",
      "directionalScore",
      "synergyMultiplier",
      "compositionBonus",
      "castabilityPenalty",
      "rolePowerScore",
      "roleMultiplier",
      "powerScore",
      "focusBonus",
      "keywordBonus",
      "preferBonus",
    ];
    for (const field of requiredFields) {
      expect(typeof result[field], `field ${field}`).toBe("number");
      expect(Number.isFinite(result[field] as number), `field ${field} must be finite`).toBe(true);
    }

    expect(Array.isArray(result.deckAxes)).toBe(true);
    expect(result.synergyConnectionSummary).toBeDefined();
  });

  it("total is always non-negative", () => {
    const candidates = [
      makeCard({ name: "Cheap", cmc: 1, typeLine: "Creature — Human" }),
      makeCard({ name: "Expensive", cmc: 8, manaCost: "{6}{W}{W}", colorsJson: JSON.stringify(["W"]) }),
      makeCard({ name: "Land", typeLine: "Basic Land — Forest", manaCost: "", cmc: 0 }),
    ];

    for (const card of candidates) {
      const score = computeCompositeScore(card, [], MIDRANGE_OPTIONS);
      expect(score.total, `total for ${card.name}`).toBeGreaterThanOrEqual(0);
    }
  });

  it("synergyMultiplier is >= 1 by default (no penalty applied for empty context)", () => {
    const card = makeCard({ name: "Lone Wolf" });
    const result = computeCompositeScore(card, [], MIDRANGE_OPTIONS);
    // synergyDensityMultiplier returns >= 1 when there are no connections (baseline)
    expect(result.synergyMultiplier).toBeGreaterThanOrEqual(1);
  });

  it("roleMultiplier is a positive number", () => {
    const threat = makeCard({ name: "Hill Giant", typeLine: "Creature — Giant" });
    const result = computeCompositeScore(threat, [], AGGRO_OPTIONS);
    expect(result.roleMultiplier).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computeCompositeScore — castability penalty
// ────────────────────────────────────────────────────────────────────────────

describe("computeCompositeScore — castability penalty", () => {
  const card = makeCard({ name: "Castable Subject" });

  it("castabilityPenalty is 0 when probability is 1.0 (perfect castability)", () => {
    const result = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 1.0);
    expect(result.castabilityPenalty).toBe(0);
  });

  it("castabilityPenalty is 0 when castabilityProb is not provided", () => {
    const result = computeCompositeScore(card, [], MIDRANGE_OPTIONS);
    expect(result.castabilityPenalty).toBe(0);
  });

  it("castabilityPenalty grows as probability approaches 0", () => {
    const high = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 0.9);
    const mid = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 0.5);
    const low = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 0.1);
    const zero = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 0);

    expect(high.castabilityPenalty).toBeLessThan(mid.castabilityPenalty);
    expect(mid.castabilityPenalty).toBeLessThan(low.castabilityPenalty);
    expect(low.castabilityPenalty).toBeLessThan(zero.castabilityPenalty);
    expect(zero.castabilityPenalty).toBeGreaterThan(0);
  });

  it("total decreases as castability probability drops from 1.0 to 0.0", () => {
    const fullCast = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 1.0);
    const halfCast = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 0.5);
    const zeroCast = computeCompositeScore(card, [], MIDRANGE_OPTIONS, 0.0);

    expect(fullCast.total).toBeGreaterThanOrEqual(halfCast.total);
    expect(halfCast.total).toBeGreaterThan(zeroCast.total);
  });

  it("castabilityPenalty is non-negative for all probabilities in [0, 1]", () => {
    for (const p of [0, 0.1, 0.2, 0.5, 0.8, 0.95, 1.0]) {
      const result = computeCompositeScore(card, [], MIDRANGE_OPTIONS, p);
      expect(result.castabilityPenalty, `penalty at p=${p}`).toBeGreaterThanOrEqual(0);
    }
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computeCompositeScore — archetype directional scoring
// ────────────────────────────────────────────────────────────────────────────

describe("computeCompositeScore — archetype alignment", () => {
  it("a cheap aggressive creature scores at least as high in Aggro as in Control", () => {
    const card = makeCard({
      name: "Savannah Lions",
      cmc: 1,
      manaCost: "{W}",
      colorsJson: JSON.stringify(["W"]),
      colorIdentityJson: JSON.stringify(["W"]),
      typeLine: "Creature — Cat",
      oracleText: "",
      power: "2",
      toughness: "1",
    });
    const aggroScore = computeCompositeScore(card, [], AGGRO_OPTIONS);
    const controlScore = computeCompositeScore(card, [], CONTROL_OPTIONS);
    expect(aggroScore.total).toBeGreaterThanOrEqual(controlScore.total);
  });

  it("a 6-mana board wipe scores at least as high in Control as in Aggro", () => {
    const card = makeCard({
      name: "Mass Destruction",
      cmc: 6,
      manaCost: "{4}{W}{W}",
      colorsJson: JSON.stringify(["W"]),
      colorIdentityJson: JSON.stringify(["W"]),
      typeLine: "Sorcery",
      oracleText: "Destroy all creatures.",
      power: null,
      toughness: null,
    });
    const controlScore = computeCompositeScore(card, [], CONTROL_OPTIONS);
    const aggroScore = computeCompositeScore(card, [], AGGRO_OPTIONS);
    expect(controlScore.total).toBeGreaterThanOrEqual(aggroScore.total);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// computeCompositeScore — focus/prefer bonuses
// ────────────────────────────────────────────────────────────────────────────

describe("computeCompositeScore — focus and prefer bonuses", () => {
  it("focusBonus is 0 when no focusEntries provided", () => {
    const card = makeCard({ name: "Engine Piece" });
    const result = computeCompositeScore(card, [], { archetype: "Combo", focusEntries: [] });
    expect(result.focusBonus).toBe(0);
  });

  it("focusBonus is > 0 when card is in focusEntries", () => {
    const card = makeCard({ name: "Build-Around" });
    const focusEntry = makeEntry(card);
    const result = computeCompositeScore(card, [], {
      archetype: "Combo",
      focusEntries: [focusEntry],
    });
    expect(result.focusBonus).toBeGreaterThan(0);
  });

  it("preferBonus is > 0 when card is in preferEntries", () => {
    const card = makeCard({ name: "Preferred Card" });
    const preferEntry = makeEntry(card);
    const result = computeCompositeScore(card, [], {
      archetype: "Midrange",
      preferEntries: [preferEntry],
    });
    expect(result.preferBonus).toBeGreaterThan(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// scoreCandidates — sorting and coverage
// ────────────────────────────────────────────────────────────────────────────

describe("scoreCandidates", () => {
  it("returns results sorted highest-to-lowest total", () => {
    const candidates = [
      makeCard({ name: "Low-End", cmc: 6, manaCost: "{5}{G}" }),
      makeCard({ name: "Mid-Range", cmc: 3, manaCost: "{2}{G}" }),
      makeCard({ name: "High-End", cmc: 1, manaCost: "{G}", power: "2", toughness: "1" }),
    ];

    const results = scoreCandidates(candidates, [], AGGRO_OPTIONS);
    expect(results).toHaveLength(3);

    for (let i = 0; i < results.length - 1; i++) {
      expect(results[i].score.total).toBeGreaterThanOrEqual(results[i + 1].score.total);
    }
  });

  it("returns one entry per candidate card", () => {
    const cards = Array.from({ length: 5 }, (_, i) =>
      makeCard({ name: `Card ${i}`, cmc: i + 1 })
    );
    const results = scoreCandidates(cards, [], MIDRANGE_OPTIONS);
    expect(results).toHaveLength(5);
  });

  it("handles empty candidate list without throwing", () => {
    const results = scoreCandidates([], [], MIDRANGE_OPTIONS);
    expect(results).toEqual([]);
  });

  it("each result has a card and a CompositeScore", () => {
    const card = makeCard({ name: "Solo Card" });
    const results = scoreCandidates([card], [], MIDRANGE_OPTIONS);
    expect(results[0].card).toBe(card);
    expect(typeof results[0].score.total).toBe("number");
  });

  it("passes castabilityProbMap values to computeCompositeScore", () => {
    const card = makeCard({ name: "Prob Subject" });
    const withPerfectCast = scoreCandidates([card], [], MIDRANGE_OPTIONS, new Map([[card.oracleId, 1.0]]));
    const withZeroCast = scoreCandidates([card], [], MIDRANGE_OPTIONS, new Map([[card.oracleId, 0.0]]));
    expect(withPerfectCast[0].score.castabilityPenalty).toBe(0);
    expect(withZeroCast[0].score.castabilityPenalty).toBeGreaterThan(0);
  });
});
