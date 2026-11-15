import { describe, expect, it } from "vitest";
import { buildConsistencyReport, type ConsistencyEntry } from "../consistencyReport";

describe("consistency report mana regressions", () => {
  it("uses fractional MDFC sources in the same inventory as recommendations", () => {
    const modal = {
      name: "Spell // Land", quantity: 4, cmc: 2, manaCost: "{1}{W}",
      typeLine: "Instant // Land", producedManaJson: '["W"]',
      cardFacesJson: JSON.stringify([
        { type_line: "Instant" },
        { type_line: "Land", oracle_text: "This land enters tapped. {T}: Add {W}." },
      ]),
    };
    const deck: ConsistencyEntry[] = [
      { name: "Plains", quantity: 10, cmc: 0, manaCost: null, typeLine: "Land", producedManaJson: '["W"]' },
      modal,
      { name: "One drop", quantity: 4, cmc: 1, manaCost: "{W}", typeLine: "Creature" },
    ];
    const warning = buildConsistencyReport(deck, 1).manaWarnings.find(w => w.color === "W");
    expect(warning?.required).toBe(14);
    expect(warning?.sources).toBeCloseTo(11.52);
  });

  it("uses legacy identity only when production metadata is unavailable", () => {
    const legacy = { name: "Legacy", quantity: 4, cmc: 0, manaCost: null, typeLine: "Land", colorIdentityJson: '["W"]' };
    const spell = { name: "White", quantity: 4, cmc: 1, manaCost: "{W}", typeLine: "Creature" };
    expect(buildConsistencyReport([legacy, spell], 1).manaWarnings[0].sources).toBe(4);
    expect(buildConsistencyReport([{ ...legacy, producedManaJson: '["C"]' }, spell], 1).manaWarnings[0].sources).toBe(0);
    expect(buildConsistencyReport([{ ...legacy, quantity: 14, producedManaJson: '["W"]', colorIdentityJson: "[]" }, spell], 1).manaWarnings).toEqual([]);
  });

  it("warns against the highest source requirement, not the highest pip count", () => {
    const deck: ConsistencyEntry[] = [
      { name: "Plains", quantity: 17, cmc: 0, manaCost: null, typeLine: "Land", producedManaJson: '["W"]' },
      { name: "Early", quantity: 4, cmc: 2, manaCost: "{W}{W}", typeLine: "Creature" },
      { name: "Late", quantity: 4, cmc: 8, manaCost: "{5}{W}{W}{W}", typeLine: "Creature" },
    ];
    expect(buildConsistencyReport(deck, 1).manaWarnings).toEqual([
      expect.objectContaining({ color: "W", sources: 17, required: 20 }),
    ]);
    expect(buildConsistencyReport([{ ...deck[0], quantity: 20 }, ...deck.slice(1)], 1).manaWarnings).toEqual([]);
  });

  it("selects the rounded-up natural turn for a fractional mana value", () => {
    const deck: ConsistencyEntry[] = [
      { name: "Plains", quantity: 24, cmc: 0, manaCost: null, typeLine: "Basic Land", producedManaJson: '["W"]' },
      { name: "Half mana", quantity: 4, cmc: 1.5, manaCost: "{1}{W}", typeLine: "Creature" },
      { name: "Filler", quantity: 32, cmc: 1, manaCost: "{W}", typeLine: "Creature" },
    ];
    const row = buildConsistencyReport(deck, 1, false).castabilityRows.find(r => r.cardName === "Half mana")!;
    expect(row.probOnNaturalTurn).toBe(row.byTurn[1].probCastable);
    expect(row.probOnNaturalTurn).toBeGreaterThan(0);
  });
});
