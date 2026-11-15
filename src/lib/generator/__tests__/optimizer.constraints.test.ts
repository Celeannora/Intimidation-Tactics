import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import type { DeckEntry } from "../../legality";
import { maxCopiesForCard } from "../../legality";
import { deckScore } from "../weights";
import type { GenerateOptions } from "../types";
import { optimize } from "../optimizer";

function card(id: string, overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id, oracleId: id, name: id, manaCost: "{2}", cmc: 2,
    typeLine: "Creature — Test", oracleText: "", keywordsJson: "[]",
    producedManaJson: "[]", colorIdentityJson: "[]", power: "3", toughness: "3",
    rarity: "common", edhrecRank: null, gameChanger: 0,
    legalityStandard: "legal", legalitiesJson: '{"standard":"legal","commander":"legal"}',
    ...overrides,
  } as CardRecord;
}
const options: GenerateOptions = { engine: "offline", format: "standard", archetype: "Midrange", colors: [] };
const donor = card("donor");
const premium = card("premium", { rarity: "mythic", edhrecRank: 1, gameChanger: 1, power: "8" });
function run(entries: DeckEntry[], overrides: Partial<Parameters<typeof optimize>[1]> = {}) {
  return optimize(entries, {
    pool: [premium], options, targetAvgCmc: 2, locked: new Set(), iterations: 5,
    rng: () => 0, ...overrides,
  });
}

describe("optimizer executed proposal count", () => {
  it.each([
    ["all entries locked", { locked: new Set([donor.oracleId]) }],
    ["empty candidate pool", { pool: [] }],
    ["disabled search", { iterations: 0 }],
  ])("reports zero steps for %s", (_label, overrides) => {
    const result = run([{ card: donor, quantity: 1, board: "main" }], overrides);
    expect(result.steps).toBe(0);
    expect(result.entries[0].card.oracleId).toBe(donor.oracleId);
  });
});

describe("optimizer replacement constraints", () => {
  it("preserves locked entry metadata without mutating the input", () => {
    const start: DeckEntry[] = [{ card: donor, quantity: 2, board: "main", quantityLocked: true }];
    const result = run(start, { locked: new Set([donor.oracleId]) });
    expect(result.entries).toEqual(start);
    expect(result.entries[0]).not.toBe(start[0]);
    result.entries[0].quantity = 1;
    expect(start[0].quantity).toBe(2);
  });

  it("does not replace a sideboard card even when the candidate scores better", () => {
    const start: DeckEntry[] = [{ card: donor, quantity: 1, board: "side" }];
    // A mainboard control proves this is an attractive, discoverable candidate.
    const control = run([{ ...start[0], board: "main" }], { iterations: 1 });
    expect(control.entries[0].card.oracleId).toBe(premium.oracleId);
    const result = run(start);
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(0);
  });

  it.each([
    ["standard", 6],
    ["commander", 2],
  ] as const)("checks the incoming card's %s copy cap before inheriting %i copies", (format, quantity) => {
    const unlimited = card("unlimited", { oracleText: "A deck can have any number of cards named unlimited." });
    const start: DeckEntry[] = [{ card: unlimited, quantity, board: "main" }];
    const formatOptions = { ...options, format };
    expect(maxCopiesForCard(unlimited, format)).toBeGreaterThanOrEqual(quantity);
    expect(maxCopiesForCard(premium, format)).toBeLessThan(quantity);
    expect(deckScore([{ card: premium, quantity, board: "main" }], formatOptions, 2).total)
      .toBeGreaterThan(deckScore(start, formatOptions, 2).total);
    const result = run(start, { options: formatOptions });
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(0);
  });

  it.each([4, 6])("preserves %i copies when the incoming card's own cap allows them", (quantity) => {
    const unlimitedText = "A deck can have any number of cards named this card.";
    const start: DeckEntry[] = [{ card: card("unlimited-donor", { oracleText: unlimitedText }), quantity, board: "main" }];
    const candidate = quantity === 6 ? { ...premium, oracleText: unlimitedText } : premium;
    const result = run(start, { pool: [candidate], iterations: 1 });
    expect(result.entries).toEqual([{ card: candidate, quantity, board: "main" }]);
    expect(result.steps).toBe(1);
    expect(result.finalScore).toBe(deckScore(result.entries, options, 2).total);
  });

  it.each(["standard", "commander"] as const)("rejects an incoming card banned in %s", (format) => {
    const banned = { ...premium, legalitiesJson: JSON.stringify({ standard: "legal", [format]: "banned" }) };
    const start: DeckEntry[] = [{ card: donor, quantity: 1, board: "main" }];
    const result = run(start, { pool: [banned], options: { ...options, format } });
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(0);
  });
});
