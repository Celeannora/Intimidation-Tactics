import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import { validateDeck, type DeckEntry } from "../../legality";
import { generateSideboard } from "../sideboard";
import type { GenerateOptions } from "../types";

function makeCard(name: string, oracleText = "", oracleId = name): CardRecord {
  return {
    id: oracleId,
    oracleId,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}",
    cmc: 1,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: "Instant",
    oracleText,
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: "legal",
    bannedInStandard: 0,
    legalitiesJson: JSON.stringify({
      standard: "legal",
      alchemy: "legal",
      explorer: "legal",
      pioneer: "legal",
      modern: "legal",
      historic: "legal",
      timeless: "legal",
      legacy: "legal",
      vintage: "legal",
      commander: "legal",
      brawl: "legal",
      historicbrawl: "legal",
      pauper: "legal",
    }),
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
    searchText: `${name} ${oracleText}`.toLowerCase(),
    importedAt: "",
  };
}

function options(format: GenerateOptions["format"] = "standard"): GenerateOptions {
  return { engine: "offline", format, archetype: "Midrange", colors: [] };
}

function fullMainboard(): DeckEntry[] {
  return Array.from({ length: 15 }, (_, index) => ({
    card: makeCard(`Main Card ${index + 1}`),
    quantity: 4,
    board: "main" as const,
  }));
}

describe("generateSideboard format and legality contracts", () => {
  it("fills the configured sideboard with unique, canonical side entries and a legal combined list", () => {
    const main = fullMainboard();
    const pool = Array.from({ length: 20 }, (_, index) =>
      makeCard(`Side Candidate ${index + 1}`, "Destroy all creatures.")
    );

    const side = generateSideboard(main, [...main.map((entry) => entry.card), ...pool], options());

    expect(side.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(15);
    expect(side.every((entry) => entry.board === "side")).toBe(true);
    expect(new Set(side.map((entry) => entry.card.oracleId)).size).toBe(side.length);
    expect(side.some((entry) => main.some((mainEntry) => mainEntry.card.oracleId === entry.card.oracleId))).toBe(false);
    expect(validateDeck([...main, ...side], "standard").legal).toBe(true);
  });

  it("returns no sideboard in formats with no sideboard slots", () => {
    const pool = [makeCard("Candidate", "Destroy all creatures.")];
    expect(generateSideboard([], pool, options("commander"))).toEqual([]);
  });

  it("does not duplicate or overstate an undersized legal candidate pool", () => {
    const main = fullMainboard();
    const available = [makeCard("Only Candidate A"), makeCard("Only Candidate B")];

    const side = generateSideboard(main, [...main.map((entry) => entry.card), ...available], options());

    expect(side.reduce((sum, entry) => sum + entry.quantity, 0)).toBe(2);
    expect(new Set(side.map((entry) => entry.card.oracleId)).size).toBe(2);
    expect(side.every((entry) => entry.board === "side")).toBe(true);
  });

  it("respects remaining copy limits when a mainboard oracle ID is already present", () => {
    const mainCard = makeCard("Split Card", "Destroy all creatures.", "split-card");
    const main: DeckEntry[] = [{ card: mainCard, quantity: 4, board: "main" }];
    const sameOracleDifferentPrinting = makeCard("Split Card Reprint", "Destroy all creatures.", "split-card");
    const side = generateSideboard(main, [sameOracleDifferentPrinting], options());

    expect(side.some((entry) => entry.card.oracleId === mainCard.oracleId)).toBe(false);
  });
});