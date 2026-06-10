import { describe, it, expect } from "vitest";
import { buildConsistencyReport } from "../consistencyReport";
import type { ConsistencyEntry } from "../consistencyReport";

function makeAggroDeck(): ConsistencyEntry[] {
  return [
    { name: "Plains", quantity: 22, cmc: 0, manaCost: null, typeLine: "Basic Land — Plains", producedManaJson: '["W"]' },
    { name: "Savannah Lions", quantity: 4, cmc: 1, manaCost: "{W}", typeLine: "Creature" },
    { name: "Knight of the White Orchid", quantity: 4, cmc: 2, manaCost: "{W}{W}", typeLine: "Creature" },
    { name: "Glorious Anthem", quantity: 4, cmc: 3, manaCost: "{1}{W}{W}", typeLine: "Enchantment" },
    { name: "Baneslayer Angel", quantity: 4, cmc: 5, manaCost: "{3}{W}{W}", typeLine: "Creature" },
    { name: "Wrath of God", quantity: 4, cmc: 4, manaCost: "{2}{W}{W}", typeLine: "Sorcery" },
    // Pad to 60
    { name: "Elite Vanguard", quantity: 8, cmc: 1, manaCost: "{W}", typeLine: "Creature" },
    { name: "Honor of the Pure", quantity: 4, cmc: 2, manaCost: "{1}{W}", typeLine: "Enchantment" },
    { name: "Path to Exile", quantity: 6, cmc: 1, manaCost: "{W}", typeLine: "Instant" },
  ];
}

describe("buildConsistencyReport", () => {
  it("returns correct deckSize, landCount, nonLandCount", () => {
    const deck = makeAggroDeck();
    const report = buildConsistencyReport(deck, 500);
    expect(report.deckSize).toBe(60);
    expect(report.landCount).toBe(22);
    expect(report.nonLandCount).toBe(38);
  });

  it("avgManaValue is positive", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 500);
    expect(report.avgManaValue).toBeGreaterThan(0);
  });

  it("handStats is populated", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 500);
    expect(report.handStats.trials).toBe(500);
    expect(report.handStats.keepRate).toBeGreaterThan(0);
  });

  it("castabilityRows has one entry per unique nonland card", () => {
    const deck = makeAggroDeck();
    const uniqueNonlands = deck.filter(e => !e.typeLine.toLowerCase().includes("land")).length;
    const report = buildConsistencyReport(deck, 200);
    expect(report.castabilityRows).toHaveLength(uniqueNonlands);
  });

  it("castabilityRows are sorted by CMC ascending", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 200);
    for (let i = 1; i < report.castabilityRows.length; i++) {
      expect(report.castabilityRows[i].cmc).toBeGreaterThanOrEqual(
        report.castabilityRows[i - 1].cmc
      );
    }
  });

  it("flaggedCards is a subset of castabilityRows", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 200);
    for (const flagged of report.flaggedCards) {
      expect(report.castabilityRows.some(r => r.cardName === flagged.cardName)).toBe(true);
    }
  });

  it("flagged cards have warning text", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 200);
    for (const flagged of report.flaggedCards) {
      expect(flagged.warning).toBeDefined();
      expect(flagged.warning!.length).toBeGreaterThan(0);
    }
  });

  it("grade is a valid letter grade", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 500);
    expect(["A", "B", "C", "D", "F"]).toContain(report.grade);
  });

  it("summary is a non-empty string", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 200);
    expect(typeof report.summary).toBe("string");
    expect(report.summary.length).toBeGreaterThan(10);
  });

  it("manaWarnings fire when sources are too low", () => {
    // Deck with zero lands that produce U, but spells need U
    const deck: ConsistencyEntry[] = [
      { name: "Island", quantity: 2, cmc: 0, manaCost: null, typeLine: "Basic Land", producedManaJson: '["U"]' },
      { name: "Mountain", quantity: 22, cmc: 0, manaCost: null, typeLine: "Basic Land", producedManaJson: '["R"]' },
      { name: "Counterspell", quantity: 36, cmc: 2, manaCost: "{U}{U}", typeLine: "Instant" },
    ];
    const report = buildConsistencyReport(deck, 200);
    expect(report.manaWarnings.length).toBeGreaterThan(0);
    expect(report.manaWarnings[0].color).toBe("U");
  });

  it("no manaWarnings for a well-built mono-white deck", () => {
    const deck: ConsistencyEntry[] = [
      { name: "Plains", quantity: 24, cmc: 0, manaCost: null, typeLine: "Basic Land", producedManaJson: '["W"]' },
      { name: "Soldier", quantity: 36, cmc: 2, manaCost: "{W}{W}", typeLine: "Creature" },
    ];
    const report = buildConsistencyReport(deck, 200);
    expect(report.manaWarnings).toHaveLength(0);
  });

  it("byTurn array on each row has entries for turns 1 through N", () => {
    const report = buildConsistencyReport(makeAggroDeck(), 200);
    for (const row of report.castabilityRows) {
      expect(row.byTurn.length).toBeGreaterThan(0);
      expect(row.byTurn[0].turn).toBe(1);
    }
  });

  // Regression: the gap analysis observed a WU deck with 18 actual U sources
  // being flagged "U critically undersourced (8 recommended)". With the
  // Karsten-table rule, a single U pip on turn 2 needs 13 sources, so 18 must
  // NOT flag.
  it("does NOT flag U when the deck runs 18 U sources for a single U pip", () => {
    const deck: ConsistencyEntry[] = [
      { name: "Island", quantity: 18, cmc: 0, manaCost: null, typeLine: "Basic Land — Island", producedManaJson: '["U"]' },
      { name: "Plains", quantity: 6, cmc: 0, manaCost: null, typeLine: "Basic Land — Plains", producedManaJson: '["W"]' },
      { name: "Make Disappear", quantity: 18, cmc: 2, manaCost: "{1}{U}", typeLine: "Instant" },
      { name: "Wrath", quantity: 18, cmc: 4, manaCost: "{2}{W}{W}", typeLine: "Sorcery" },
    ];
    const report = buildConsistencyReport(deck, 200);
    expect(report.manaWarnings.find(w => w.color === "U")).toBeUndefined();
  });

  // Regression: a double-pip card on turn 2 needs ~20 sources; running only 14
  // of that color must still flag (the old flat 8/6 floors missed this).
  it("flags a double-pip UU@2 card when only 14 U sources are present", () => {
    const deck: ConsistencyEntry[] = [
      { name: "Island", quantity: 14, cmc: 0, manaCost: null, typeLine: "Basic Land — Island", producedManaJson: '["U"]' },
      { name: "Mountain", quantity: 10, cmc: 0, manaCost: null, typeLine: "Basic Land — Mountain", producedManaJson: '["R"]' },
      { name: "Counterspell", quantity: 36, cmc: 2, manaCost: "{U}{U}", typeLine: "Instant" },
    ];
    const report = buildConsistencyReport(deck, 200);
    const u = report.manaWarnings.find(w => w.color === "U");
    expect(u).toBeDefined();
    expect(u!.required).toBe(20);
    expect(u!.sources).toBe(14);
  });
});
