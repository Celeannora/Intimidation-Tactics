import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import { generateDeck } from "../generator";
import type { GenerateOptions } from "../types";
import type { ConstructedFormat } from "../../formats";
import { isCardLegalInFormat } from "../../formats";
import { buildAIPrompts } from "../../ai/aiGenerator";
import { validateDeck, maxCopiesForCard, type DeckEntry } from "../../legality";

// ─────────────────────────────────────────────────────────────────────────────
// Phase 1 multi-format integration gate.
//
// Modern / Legacy / Vintage / Pioneer / Pauper are structurally identical to
// Standard (60+ mainboard, 15-card sideboard, 4-of copy cap) and differ ONLY in
// which `legalities` key drives the card pool. Phase 1 unlocks them for end-user
// selection. These tests run the REAL generator + validator pipeline for each of
// the five formats and assert legal, sensible output — rather than assuming the
// shared code path "just works" for the new formats.
//
// KEY FIXTURE REQUIREMENT: parseLegalities only surfaces the standard/future
// legacy fields unless `legalitiesJson` is present. Non-Standard formats must
// therefore carry legalitiesJson with their own key, or buildPool's legality
// filter would exclude every card.
// ─────────────────────────────────────────────────────────────────────────────

const PHASE1_FORMATS: ConstructedFormat[] = ["modern", "legacy", "vintage", "pioneer", "pauper"];

function makeCard(
  name: string,
  oracleText: string,
  legalities: Record<string, string>,
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
    legalityStandard: null,
    legalityFuture: null,
    legalitiesJson: JSON.stringify(legalities),
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

/** A mono-blue pool whose cards are all legal in `format` via legalitiesJson. */
function poolFor(format: ConstructedFormat): CardRecord[] {
  const legal = { [format]: "legal" };
  const creatures = Array.from({ length: 16 }, (_, i) =>
    makeCard(`Blue Creature ${i + 1}`, "Draw a card when this enters.", legal, "Creature — Merfolk", ["U"], (i % 4) + 1)
  );
  const spells = Array.from({ length: 12 }, (_, i) =>
    makeCard(`Blue Spell ${i + 1}`, "Counter target spell. Draw a card.", legal, i % 2 === 0 ? "Instant" : "Sorcery", ["U"], (i % 3) + 2)
  );
  const island = { ...makeCard("Island", "", legal, "Basic Land", [], 0), manaCost: "" } as CardRecord;
  return [...creatures, ...spells, island];
}

function baseOptions(format: ConstructedFormat): GenerateOptions {
  return {
    engine: "offline",
    format,
    archetype: "Control",
    colors: ["U"],
    mainboardSize: 60,
    maxMainboardSize: 60,
    optimizationIterations: 0,
  };
}

function mainCount(entries: DeckEntry[]): number {
  return entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0);
}

describe("Phase 1 formats — generator produces legal 60-card decks", () => {
  for (const format of PHASE1_FORMATS) {
    it(`${format}: generates a 60-card mainboard from a format-legal pool`, () => {
      const result = generateDeck(baseOptions(format), poolFor(format));
      expect(mainCount(result.entries)).toBe(60);

      // Every generated card must be legal in the target format and within the
      // 4-of copy cap.
      for (const entry of result.entries) {
        expect(isCardLegalInFormat(entry.card, format)).toBe(true);
        expect(entry.quantity).toBeLessThanOrEqual(maxCopiesForCard(entry.card, format));
      }

      // The finished deck passes the format-parametric validator.
      const validation = validateDeck(result.entries, format);
      expect(validation.violations.filter((v) => v.rule === "NOT_LEGAL")).toEqual([]);
      expect(validation.violations.filter((v) => v.rule === "MAX_COPIES")).toEqual([]);
    });

    it(`${format}: excludes cards not legal in the format from the pool`, () => {
      // A card legal ONLY in Standard must never appear in a Phase 1 deck.
      const offFormat = makeCard(
        "Standard Only Bomb",
        "Draw a card when this enters.",
        { standard: "legal" },
        "Creature — Merfolk",
        ["U"],
        1
      );
      const pool = [...poolFor(format), offFormat];
      const result = generateDeck(baseOptions(format), pool);
      const names = result.entries.map((e) => e.card.name);
      expect(names).not.toContain("Standard Only Bomb");
    });
  }
});

describe("Phase 1 formats — validator enforces copy cap and sideboard size", () => {
  for (const format of PHASE1_FORMATS) {
    const legal = { [format]: "legal" };
    const nonbasic = makeCard("Blue Threat", "Draw a card.", legal, "Creature — Merfolk", ["U"], 2);
    const island = { ...makeCard("Island", "", legal, "Basic Land", [], 0), manaCost: "" } as CardRecord;

    it(`${format}: flags a 5th copy of a nonbasic (4-of cap)`, () => {
      const entries: DeckEntry[] = [
        { card: nonbasic, quantity: 5, board: "main" },
        { card: island, quantity: 55, board: "main" },
      ];
      const result = validateDeck(entries, format);
      expect(result.violations.some((v) => v.rule === "MAX_COPIES")).toBe(true);
    });

    it(`${format}: accepts exactly 4 copies of a nonbasic`, () => {
      const entries: DeckEntry[] = [
        { card: nonbasic, quantity: 4, board: "main" },
        { card: island, quantity: 56, board: "main" },
      ];
      const result = validateDeck(entries, format);
      expect(result.violations.some((v) => v.rule === "MAX_COPIES")).toBe(false);
    });

    it(`${format}: enforces a 15-card sideboard`, () => {
      const main: DeckEntry[] = [{ card: island, quantity: 60, board: "main" }];
      const shortSide = validateDeck(
        [...main, { card: nonbasic, quantity: 10, board: "side" }],
        format
      );
      expect(shortSide.violations.some((v) => v.rule === "SIDE_SIZE")).toBe(true);

      const fullSide = validateDeck(
        [...main, { card: nonbasic, quantity: 4, board: "side" }, { card: island, quantity: 11, board: "side" }],
        format
      );
      expect(fullSide.violations.some((v) => v.rule === "SIDE_SIZE")).toBe(false);
    });
  }
});

describe("Vintage — restricted list caps copies at 1 end-to-end", () => {
  const restricted = makeCard(
    "Restricted Bomb",
    "Draw a card when this enters.",
    { vintage: "restricted" },
    "Creature — Merfolk",
    ["U"],
    1
  );

  it("maxCopiesForCard returns 1 for a Vintage-restricted card", () => {
    expect(maxCopiesForCard(restricted, "vintage")).toBe(1);
  });

  it("validateDeck flags 2 copies of a restricted card", () => {
    const island = { ...makeCard("Island", "", { vintage: "legal" }, "Basic Land", [], 0), manaCost: "" } as CardRecord;
    const entries: DeckEntry[] = [
      { card: restricted, quantity: 2, board: "main" },
      { card: island, quantity: 58, board: "main" },
    ];
    const result = validateDeck(entries, "vintage");
    expect(result.violations.some((v) => v.rule === "MAX_COPIES")).toBe(true);
  });

  it("the generator pipeline caps a restricted build-around at a single copy", () => {
    // Passing the restricted card as a build-around focus entry (which bypasses
    // pool legality filtering) forces it into the deck; its quantity request of 4
    // must be clamped to 1 by the restricted-list branch of maxCopiesForCard.
    const options: GenerateOptions = {
      ...baseOptions("vintage"),
      focusEntries: [{ card: restricted, quantity: 4, board: "main" }],
    };
    const result = generateDeck(options, poolFor("vintage"));
    const restrictedEntry = result.entries.find((e) => e.card.oracleId === restricted.oracleId);
    expect(restrictedEntry).toBeDefined();
    expect(restrictedEntry?.quantity).toBe(1);
  });
});

describe("AI prompt construction interpolates each Phase 1 format", () => {
  const labels: Record<ConstructedFormat, string> = {
    standard: "Standard",
    alchemy: "Alchemy",
    explorer: "Explorer",
    pioneer: "Pioneer",
    modern: "Modern",
    historic: "Historic",
    timeless: "Timeless",
    legacy: "Legacy",
    vintage: "Vintage",
    commander: "Commander",
    brawl: "Brawl",
    historicbrawl: "Historic Brawl",
    pauper: "Pauper",
  };

  for (const format of PHASE1_FORMATS) {
    it(`${format}: prompt names the selected format, not a stale one`, () => {
      const prompts = buildAIPrompts(baseOptions(format), poolFor(format));
      expect(prompts.system).toContain(`expert MTG ${labels[format]} deckbuilder`);
      expect(prompts.user).toContain(`Format: ${labels[format]}`);
      // No other Phase 1 format label should leak into the format line.
      for (const other of PHASE1_FORMATS) {
        if (other === format) continue;
        expect(prompts.user).not.toContain(`Format: ${labels[other]}`);
      }
    });
  }
});
