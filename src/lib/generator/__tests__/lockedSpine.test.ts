import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import type { DeckEntry } from "../../legality";
import { generateDeck } from "../generator";
import { suggestCuts } from "../suggestCuts";
import type { GenerateOptions } from "../types";

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
    power: typeLine.includes("Creature") ? "3" : null,
    toughness: typeLine.includes("Creature") ? "3" : null,
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
  return {
    ...makeCard(name, "", "Basic Land", [], 0),
    manaCost: "",
  } as CardRecord;
}

function mainQty(entries: DeckEntry[], oracleId: string): number {
  return entries
    .filter((e) => e.board === "main" && e.card.oracleId === oracleId)
    .reduce((s, e) => s + e.quantity, 0);
}

describe("locked spine via seedEntries", () => {
  it("never removes or reduces locked seed cards, even with a large filler pool", () => {
    // A small set of locked spine cards at specific quantities.
    const spine = [
      { card: makeCard("Spine A", "Locked threat.", "Creature — Hero"), quantity: 3 },
      { card: makeCard("Spine B", "Locked threat.", "Creature — Hero"), quantity: 2 },
      { card: makeCard("Spine C", "Destroy target creature.", "Instant"), quantity: 1 },
    ];
    const seedEntries: DeckEntry[] = spine.map((s) => ({ card: s.card, quantity: s.quantity, board: "main" }));

    // A large pool of higher-scoring filler the optimizer would normally prefer.
    const filler = Array.from({ length: 40 }, (_, i) =>
      makeCard(`Filler ${i + 1}`, "Destroy target creature. Draw a card.", "Creature — Elite")
    );

    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      seedEntries,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 50,
    };

    const result = generateDeck(options, [...spine.map((s) => s.card), ...filler, makeBasic("Wastes")]);

    // Every locked card present at exactly the requested quantity.
    expect(mainQty(result.entries, "Spine A")).toBe(3);
    expect(mainQty(result.entries, "Spine B")).toBe(2);
    expect(mainQty(result.entries, "Spine C")).toBe(1);
  });

  it("respects exact quantity locks rather than re-tuning them like focus entries", () => {
    // A single 1-of legendary-style card: focus would inflate; seed must keep it at 1.
    const oneOf = makeCard("Legendary Singleton", "Legendary value engine.", "Legendary Creature — Avatar");
    const seedEntries: DeckEntry[] = [{ card: oneOf, quantity: 1, board: "main" }];
    const filler = Array.from({ length: 30 }, (_, i) => makeCard(`F${i}`, "Draw a card.", "Creature — Elite"));

    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      seedEntries,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 50,
    };

    const result = generateDeck(options, [oneOf, ...filler, makeBasic("Wastes")]);
    expect(mainQty(result.entries, "Legendary Singleton")).toBe(1);
  });

  it("gap-fills only the remaining slots and reaches the target mainboard size", () => {
    const seedEntries: DeckEntry[] = [
      { card: makeCard("Locked Threat", "Locked.", "Creature — Hero"), quantity: 4, board: "main" },
    ];
    const filler = Array.from({ length: 40 }, (_, i) =>
      makeCard(`Filler ${i + 1}`, "Destroy target creature.", "Instant")
    );

    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      seedEntries,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const lockedCard = seedEntries[0].card;
    const result = generateDeck(options, [...filler, lockedCard, makeBasic("Wastes")]);
    const total = result.entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0);

    expect(mainQty(result.entries, "Locked Threat")).toBe(4); // spine untouched
    expect(total).toBe(60); // gap-fill brought it to target
  });
});

describe("suggestCuts", () => {
  it("never suggests cutting pinned cards or lands", () => {
    const pinned = makeCard("Pinned Bomb", "Win the game.", "Creature — Avatar");
    const redundant = makeCard("Redundant Removal", "Destroy target creature.", "Instant");
    const land = makeBasic("Wastes");

    const entries: DeckEntry[] = [
      { card: pinned, quantity: 2, board: "main" },
      { card: redundant, quantity: 4, board: "main" },
      { card: land, quantity: 24, board: "main" },
    ];
    const newlyPinned: DeckEntry[] = [{ card: pinned, quantity: 2, board: "main" }];

    const result = suggestCuts(entries, newlyPinned, 2, { engine: "offline", archetype: "Midrange", colors: [] });

    const cutIds = new Set(result.candidates.map((c) => c.card.oracleId));
    expect(cutIds.has("Pinned Bomb")).toBe(false);
    expect(cutIds.has("Wastes")).toBe(false);
    expect(result.totalCut).toBe(2);
    // It should target the redundant removal pile.
    expect(cutIds.has("Redundant Removal")).toBe(true);
  });

  it("reports a curve delta and stops once enough slots are freed", () => {
    const a = makeCard("Curve One", "Filler.", "Creature — A", [], 1);
    const b = makeCard("Curve Six", "Big filler.", "Creature — B", [], 6);
    const entries: DeckEntry[] = [
      { card: a, quantity: 4, board: "main" },
      { card: b, quantity: 4, board: "main" },
    ];
    const result = suggestCuts(entries, [], 3, { engine: "offline", archetype: "Aggro", colors: [] });
    expect(result.totalCut).toBe(3);
    expect(Number.isFinite(result.curveDelta)).toBe(true);
  });
});
