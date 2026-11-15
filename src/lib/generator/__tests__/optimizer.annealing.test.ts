import { beforeEach, describe, expect, it, vi } from "vitest";
import type { CardRecord } from "../../types";
import type { DeckEntry } from "../../legality";
import type { GenerateOptions } from "../types";

// Only this tiny transition landscape needs a synthetic objective: the real
// score cannot isolate the 100 -> 90 -> 95 -> 110 acceptance decision.
const landscape = vi.hoisted(() => ({ scores: {} as Record<string, number> }));
vi.mock("../weights", () => ({
  quickRank: () => 0,
  deckScore: (entries: DeckEntry[]) => ({
    total: landscape.scores[entries.map((entry) => entry.card.oracleId).join("+")] ?? 0,
  }),
}));
import { optimize } from "../optimizer";

function spell(id: string, oracleText: string): CardRecord {
  return {
    id, oracleId: id, name: id, typeLine: "Instant", oracleText,
    cmc: 2, manaCost: "{2}", power: null, producedManaJson: "[]",
    colorIdentityJson: "[]", legalityStandard: "legal",
    legalitiesJson: '{"standard":"legal"}',
  } as CardRecord;
}
const options: GenerateOptions = { engine: "offline", format: "standard", archetype: "Midrange", colors: [] };
const A = spell("A", "Destroy target creature.");
const B = spell("B", "Destroy target creature. Draw a card.");
const C = spell("C", "Draw a card. Create a token.");
const D = spell("D", "Create a token.");
const start: DeckEntry[] = [{ card: A, quantity: 1, board: "main" }];

beforeEach(() => { landscape.scores = { A: 100, B: 90, C: 95, D: 110 }; });

describe("optimizer annealing state", () => {
  it("accepts an uphill move from the current state even below the saved best", () => {
    const draws = [0, 0, 0, 0, 0.75, 0.5, 0, 0, 0.5];
    let cursor = 0;
    const result = optimize(start, {
      pool: [B, C, D], options, targetAvgCmc: 2, locked: new Set(),
      iterations: 3, rng: () => draws[cursor++] ?? 0,
    });

    expect(result.finalScore).toBe(110);
    expect(result.entries[0].card.oracleId).toBe("D");
    expect(result.improvements).toBe(1);
    expect(result.steps).toBe(3);
    expect(start[0].card.oracleId).toBe("A");
  });

  it("returns the saved best rather than a worse accepted final walk state", () => {
    const result = optimize(start, {
      pool: [B], options, targetAvgCmc: 2, locked: new Set(), iterations: 1, rng: () => 0,
    });
    expect(result.finalScore).toBe(100);
    expect(result.entries[0].card.oracleId).toBe("A");
    expect(result.improvements).toBe(0);
  });
});
