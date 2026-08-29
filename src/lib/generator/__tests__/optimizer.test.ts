import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import type { DeckEntry } from "../../legality";
import { optimize } from "../optimizer";
import type { GenerateOptions } from "../types";

function card(overrides: Partial<CardRecord>): CardRecord {
  return {
    id: "test-id",
    oracleId: "test-oracle",
    name: "Test Card",
    manaCost: "{2}",
    cmc: 2,
    typeLine: "Creature — Test",
    oracleText: "",
    keywordsJson: "[]",
    producedManaJson: "[]",
    colorIdentityJson: "[]",
    power: "3",
    toughness: "3",
    rarity: "common",
    edhrecRank: null,
    gameChanger: 0,
    ...overrides,
  } as CardRecord;
}

describe("optimizer support bucket", () => {
  it("does not use the generic threat replacement pool for an anthem before a vanilla threat", () => {
    const anthem = card({
      oracleId: "anthem",
      name: "Angel Marshal",
      manaCost: "{2}{W}",
      cmc: 3,
      oracleText: "Other Angels you control get +1/+1.",
      power: "3",
    });
    const vanilla = card({ oracleId: "vanilla", name: "Vanilla Threat", power: "3" });
    const premiumThreat = card({
      oracleId: "premium",
      name: "Premium Threat",
      rarity: "mythic",
      edhrecRank: 1,
      gameChanger: 1,
      power: "8",
    });
    const entries: DeckEntry[] = [
      { card: anthem, quantity: 1, board: "main" },
      { card: vanilla, quantity: 1, board: "main" },
    ];
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Aggro",
      colors: ["W"],
    };

    const result = optimize(entries, {
      pool: [premiumThreat],
      options,
      targetAvgCmc: 2,
      locked: new Set(),
      iterations: 1,
      // Select the anthem. Its support bucket is empty, while the vanilla
      // threat would still be eligible for the premium threat bucket.
      rng: () => 0,
    });

    expect(result.entries.some((entry) => entry.card.oracleId === anthem.oracleId)).toBe(true);
    expect(result.entries.some((entry) => entry.card.oracleId === premiumThreat.oracleId)).toBe(false);
  });
});
