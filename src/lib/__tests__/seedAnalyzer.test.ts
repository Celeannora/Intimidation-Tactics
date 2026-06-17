/**
 * seedAnalyzer.test.ts
 *
 * Unit tests for analyzeSeeds and formatSeedSummaryForPrompt.
 */

import { describe, expect, it } from "vitest";
import { analyzeSeeds, formatSeedSummaryForPrompt } from "../analysis/seedAnalyzer";
import type { CardRecord } from "../types";

function makeCard(overrides: Partial<CardRecord> & { name: string }): CardRecord {
  const { name, ...rest } = overrides;
  return {
    id: name, oracleId: name, name,
    lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{1}{G}", cmc: 2,
    colorsJson: JSON.stringify(["G"]),
    colorIdentityJson: JSON.stringify(["G"]),
    typeLine: "Creature — Beast",
    oracleText: "",
    keywordsJson: "[]",
    power: "2", toughness: "2", loyalty: null, producedManaJson: "[]",
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: "legal" }),
    setCode: "TST", setName: "Test Set", setType: null, collectorNumber: null, rarity: "common",
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null,
    searchText: name.toLowerCase(), importedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  } as CardRecord;
}

// ────────────────────────────────────────────────────────────────────────────
// Empty seeds
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — empty input", () => {
  it("returns a valid SeedSummary for empty array", () => {
    const result = analyzeSeeds([]);
    expect(result.seedCount).toBe(0);
    expect(result.colorIdentity).toEqual([]);
    expect(result.topArchetypes).toEqual([]);
    expect(result.primaryAxes).toEqual([]);
    expect(result.confidence).toBe(0);
    expect(result.avgCmc).toBe(0);
    expect(result.signals).toContain("No seed cards provided.");
  });

  it("returns spellRatio 'balanced' and speed 'midrange' for empty input", () => {
    const result = analyzeSeeds([]);
    expect(result.spellRatio).toBe("balanced");
    expect(result.speed).toBe("midrange");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Color identity inference
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — color identity", () => {
  it("infers single color correctly", () => {
    const cards = [
      makeCard({ name: "Green 1", colorsJson: '["G"]', colorIdentityJson: '["G"]' }),
      makeCard({ name: "Green 2", colorsJson: '["G"]', colorIdentityJson: '["G"]' }),
    ];
    const result = analyzeSeeds(cards);
    expect(result.colorIdentity[0]).toBe("G");
    expect(result.colorConfidence).toBeGreaterThan(0.5);
  });

  it("infers multi-color with dominant color first", () => {
    const cards = [
      makeCard({ name: "W1", colorsJson: '["W"]', colorIdentityJson: '["W"]' }),
      makeCard({ name: "W2", colorsJson: '["W"]', colorIdentityJson: '["W"]' }),
      makeCard({ name: "B1", colorsJson: '["B"]', colorIdentityJson: '["B"]' }),
    ];
    const result = analyzeSeeds(cards);
    expect(result.colorIdentity[0]).toBe("W");
  });

  it("colorConfidence is between 0 and 1 inclusive", () => {
    const cards = [makeCard({ name: "Solo" })];
    const result = analyzeSeeds(cards);
    expect(result.colorConfidence).toBeGreaterThanOrEqual(0);
    expect(result.colorConfidence).toBeLessThanOrEqual(1);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Archetype scoring
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — archetype signals", () => {
  it("assigns Aggro high probability for low-CMC creatures", () => {
    const cards = [
      makeCard({ name: "Aggro 1", cmc: 1, typeLine: "Creature — Human", oracleText: "Haste." }),
      makeCard({ name: "Aggro 2", cmc: 1, typeLine: "Creature — Human", oracleText: "First strike." }),
      makeCard({ name: "Aggro 3", cmc: 2, typeLine: "Creature — Human", oracleText: "Menace." }),
    ];
    const result = analyzeSeeds(cards);
    const topArch = result.topArchetypes[0]?.archetype;
    expect(["Aggro", "Tempo"]).toContain(topArch);
  });

  it("assigns Control high probability for board wipes and counterspells", () => {
    const cards = [
      makeCard({ name: "Wrath", cmc: 4, typeLine: "Sorcery", oracleText: "Destroy all creatures." }),
      makeCard({ name: "Counterspell", cmc: 2, typeLine: "Instant", oracleText: "Counter target spell." }),
      makeCard({ name: "Doom Blade", cmc: 2, typeLine: "Instant", oracleText: "Destroy target nonblack creature." }),
    ];
    const result = analyzeSeeds(cards);
    const topArch = result.topArchetypes[0]?.archetype;
    expect(["Control", "Tempo"]).toContain(topArch);
  });

  it("assigns Ramp high probability for ramp spells", () => {
    const cards = [
      makeCard({ name: "Ramp1", cmc: 2, typeLine: "Sorcery", oracleText: "Search your library for a basic land card and put it onto the battlefield tapped." }),
      makeCard({ name: "Ramp2", cmc: 1, typeLine: "Creature — Elf Druid", oracleText: "{T}: Add {G}{G}." }),
      makeCard({ name: "Ramp3", cmc: 2, typeLine: "Sorcery", oracleText: "Search your library for a basic land card." }),
    ];
    const result = analyzeSeeds(cards);
    const topArch = result.topArchetypes[0]?.archetype;
    expect(["Ramp", "Midrange"]).toContain(topArch);
  });

  it("topArchetypes contains at most 3 entries", () => {
    const cards = Array.from({ length: 6 }, (_, i) => makeCard({ name: `Card${i}`, cmc: i }));
    const result = analyzeSeeds(cards);
    expect(result.topArchetypes.length).toBeLessThanOrEqual(3);
  });

  it("all probability values in topArchetypes sum to <= 1.0 (normalized)", () => {
    const cards = [
      makeCard({ name: "C1", cmc: 1 }),
      makeCard({ name: "C2", cmc: 2 }),
      makeCard({ name: "C3", cmc: 3 }),
    ];
    const result = analyzeSeeds(cards);
    const probSum = result.topArchetypes.reduce((s, a) => s + a.probability, 0);
    expect(probSum).toBeLessThanOrEqual(1.01);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Speed and spell ratio
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — speed and spell ratio", () => {
  it("returns 'fast' speed for low-CMC aggro seeds", () => {
    const cards = Array.from({ length: 4 }, (_, i) =>
      makeCard({ name: `Aggro${i}`, cmc: 1, typeLine: "Creature — Human", oracleText: "Haste." })
    );
    const result = analyzeSeeds(cards);
    expect(result.speed).toBe("fast");
  });

  it("returns 'slow' speed for high-CMC seeds with board wipe", () => {
    const cards = [
      makeCard({ name: "Wrath", cmc: 4, typeLine: "Sorcery", oracleText: "Destroy all creatures." }),
      makeCard({ name: "BigSpell", cmc: 5, typeLine: "Sorcery", oracleText: "Draw three cards." }),
    ];
    const result = analyzeSeeds(cards);
    expect(result.speed).toBe("slow");
  });

  it("returns 'creature-heavy' for all-creature seeds", () => {
    const cards = [
      makeCard({ name: "C1", typeLine: "Creature — Beast" }),
      makeCard({ name: "C2", typeLine: "Creature — Beast" }),
      makeCard({ name: "C3", typeLine: "Creature — Beast" }),
      makeCard({ name: "C4", typeLine: "Creature — Beast" }),
    ];
    const result = analyzeSeeds(cards);
    expect(result.spellRatio).toBe("creature-heavy");
  });

  it("returns 'spell-heavy' for all-instant seeds", () => {
    const cards = [
      makeCard({ name: "S1", typeLine: "Instant" }),
      makeCard({ name: "S2", typeLine: "Instant" }),
      makeCard({ name: "S3", typeLine: "Sorcery" }),
      makeCard({ name: "S4", typeLine: "Instant" }),
    ];
    const result = analyzeSeeds(cards);
    expect(result.spellRatio).toBe("spell-heavy");
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Confidence
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — confidence", () => {
  it("confidence is between 0 and 1 inclusive", () => {
    const cards = [makeCard({ name: "Solo" })];
    const result = analyzeSeeds(cards);
    expect(result.confidence).toBeGreaterThanOrEqual(0);
    expect(result.confidence).toBeLessThanOrEqual(1);
  });

  it("confidence is lower for 1-2 seeds than for 5+ seeds with clear archetype", () => {
    const fewCards = [makeCard({ name: "A", cmc: 1 })];
    const manyCards = Array.from({ length: 6 }, (_, i) =>
      makeCard({ name: `Aggro${i}`, cmc: 1, typeLine: "Creature — Human", oracleText: "Haste." })
    );
    const fewResult = analyzeSeeds(fewCards);
    const manyResult = analyzeSeeds(manyCards);
    expect(manyResult.confidence).toBeGreaterThanOrEqual(fewResult.confidence);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// avgCmc
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — avgCmc", () => {
  it("computes correct average CMC excluding lands", () => {
    const cards = [
      makeCard({ name: "Land", typeLine: "Basic Land — Forest", cmc: 0 }),
      makeCard({ name: "Two-drop", cmc: 2 }),
      makeCard({ name: "Four-drop", cmc: 4 }),
    ];
    const result = analyzeSeeds(cards);
    expect(result.avgCmc).toBe(3); // (2+4)/2 = 3, Land excluded
  });

  it("avgCmc is 0 for all-land seeds", () => {
    const cards = [makeCard({ name: "Forest", typeLine: "Basic Land — Forest", cmc: 0 })];
    const result = analyzeSeeds(cards);
    expect(result.avgCmc).toBe(0);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// Determinism
// ────────────────────────────────────────────────────────────────────────────

describe("analyzeSeeds — determinism", () => {
  it("returns identical results for the same input on repeated calls", () => {
    const cards = [
      makeCard({ name: "Beast1", cmc: 2 }),
      makeCard({ name: "Beast2", cmc: 3 }),
    ];
    const first = analyzeSeeds(cards);
    const second = analyzeSeeds(cards);
    expect(first.topArchetypes).toEqual(second.topArchetypes);
    expect(first.confidence).toBe(second.confidence);
    expect(first.avgCmc).toBe(second.avgCmc);
    expect(first.colorIdentity).toEqual(second.colorIdentity);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// formatSeedSummaryForPrompt
// ────────────────────────────────────────────────────────────────────────────

describe("formatSeedSummaryForPrompt", () => {
  it("returns a non-empty string", () => {
    const cards = [makeCard({ name: "Beast" })];
    const summary = analyzeSeeds(cards);
    const prompt = formatSeedSummaryForPrompt(summary);
    expect(typeof prompt).toBe("string");
    expect(prompt.length).toBeGreaterThan(0);
  });

  it("includes expected sections", () => {
    const cards = [
      makeCard({ name: "G1", colorsJson: '["G"]', colorIdentityJson: '["G"]' }),
    ];
    const summary = analyzeSeeds(cards);
    const prompt = formatSeedSummaryForPrompt(summary);
    expect(prompt).toContain("Seed intent analysis:");
    expect(prompt).toContain("Inferred colors:");
    expect(prompt).toContain("Archetype candidates:");
    expect(prompt).toContain("Primary synergy axes:");
    expect(prompt).toContain("Overall intent confidence:");
  });

  it("handles empty summary without throwing", () => {
    const summary = analyzeSeeds([]);
    expect(() => formatSeedSummaryForPrompt(summary)).not.toThrow();
  });
});
