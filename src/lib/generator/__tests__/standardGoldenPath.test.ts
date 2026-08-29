import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import { generateDeck } from "../generator";
import type { GenerateOptions } from "../types";

// ─────────────────────────────────────────────────────────────────────────────
// Golden-path Standard regression gate.
//
// Phase 0 of the multi-format expansion is required to leave Standard's
// generator output BYTE-FOR-BYTE identical. `generateDeck` seeds its RNG with a
// fixed constant (0xc0ffee), so for a fixed pool + options its output is fully
// deterministic. This test pins that output; any accidental behavioral drift in
// the Standard path (from format-table changes, legality consolidation, or the
// deck-store threading) will fail this assertion.
// ─────────────────────────────────────────────────────────────────────────────

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  colors: ManaColor[] = [],
  cmc = 2
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: colors.length ? "{1}{U}" : "{1}",
    cmc,
    colorsJson: JSON.stringify(colors),
    colorIdentityJson: JSON.stringify(colors),
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
    searchText: `${name} ${oracleText} ${typeLine}`,
    importedAt: "",
  } as CardRecord;
}

function makeBasic(name: string): CardRecord {
  return { ...makeCard(name, "", "Basic Land", [], 0), manaCost: "" } as CardRecord;
}

/** A fixed, deterministic mono-blue Standard pool. */
function fixedPool(): CardRecord[] {
  const creatures = Array.from({ length: 16 }, (_, i) =>
    makeCard(`Blue Creature ${i + 1}`, "Draw a card when this enters.", "Creature — Merfolk", ["U"], (i % 4) + 1)
  );
  const spells = Array.from({ length: 12 }, (_, i) =>
    makeCard(`Blue Spell ${i + 1}`, "Counter target spell. Draw a card.", i % 2 === 0 ? "Instant" : "Sorcery", ["U"], (i % 3) + 2)
  );
  return [...creatures, ...spells, makeBasic("Island")];
}

function signature(entries: { card: CardRecord; quantity: number }[]): string {
  return entries
    .map((e) => `${e.quantity} ${e.card.name}`)
    .sort()
    .join("\n");
}

describe("Standard golden-path regression", () => {
  const options: GenerateOptions = {
    engine: "offline",
    format: "standard",
    archetype: "Control",
    colors: ["U"],
    mainboardSize: 60,
    maxMainboardSize: 60,
    optimizationIterations: 0,
  };

  it("produces byte-for-byte identical Standard output for a fixed seed and pool", () => {
    const result = generateDeck(options, fixedPool());
    const mainCount = result.entries
      .filter((e) => e.board === "main")
      .reduce((s, e) => s + e.quantity, 0);

    // Deck shape is pinned to Standard's rules (60-card mainboard).
    expect(mainCount).toBe(60);

    // Exact card list is pinned; see header for why this must not drift.
    expect(signature(result.entries.filter((e) => e.board === "main"))).toBe(GOLDEN_MAIN);
  });

  it("is stable across repeated runs (deterministic seed)", () => {
    const a = generateDeck(options, fixedPool());
    const b = generateDeck(options, fixedPool());
    expect(signature(a.entries)).toBe(signature(b.entries));
  });
});

// Pinned Standard output — captured from the baseline Standard generator.
const GOLDEN_MAIN = [
  "2 Blue Creature 2",
  "2 Blue Creature 5",
  "2 Blue Creature 6",
  "2 Blue Creature 9",
  "2 Blue Spell 1",
  "2 Blue Spell 10",
  "2 Blue Spell 2",
  "2 Blue Spell 4",
  "2 Blue Spell 7",
  "2 Blue Spell 8",
  "3 Blue Creature 1",
  "37 Island",
].join("\n");
