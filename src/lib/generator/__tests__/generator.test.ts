import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import type { DeckEntry } from "../../legality";
import { generateDeck } from "../generator";
import type { GenerateOptions } from "../types";

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  colors: ManaColor[] = []
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: colors.length ? "{1}{U}" : "{1}",
    cmc: 2,
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
  return {
    ...makeCard(name, "", "Basic Land", []),
    manaCost: "",
    cmc: 0,
  } as CardRecord;
}

describe("generateDeck focus preservation", () => {
  it("keeps every build-around focus card instead of dropping lower-scored cards behind a focus budget", () => {
    const focusCards = Array.from({ length: 24 }, (_, i) =>
      makeCard(`Mill Piece ${i + 1}`, "Target opponent mills two cards.", i % 3 === 0 ? "Sorcery" : "Creature — Horror")
    );
    const focusEntries: DeckEntry[] = focusCards.map((card) => ({ card, quantity: 1, board: "main" }));
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Control",
      colors: [],
      focusEntries,
      keywordFocus: ["Mill"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const result = generateDeck(options, [...focusCards, makeBasic("Wastes")]);
    const focusedIds = new Set(result.focusedCards.map((card) => card.oracleId));

    expect(focusedIds.size).toBe(focusCards.length);
    for (const card of focusCards) expect(focusedIds.has(card.oracleId)).toBe(true);
    expect(result.diagnostics.reasoning).toContain(
      "Focus: preserved 24 unique build-around card(s); no strategy card was dropped by an arbitrary focus budget"
    );
    expect(result.diagnostics.primaryAxes).toContain("mill");
  });

  it("does not inflate imported focus one-ofs into playsets", () => {
    const focusCards = Array.from({ length: 10 }, (_, i) =>
      makeCard(`Focus One-Of ${i + 1}`, "Target opponent mills two cards.", i % 2 === 0 ? "Sorcery" : "Creature — Horror")
    );
    const fillerCards = Array.from({ length: 20 }, (_, i) =>
      makeCard(`Fresh Candidate ${i + 1}`, "Draw a card. Target opponent mills two cards.", i % 2 === 0 ? "Sorcery" : "Instant")
    );
    const focusEntries: DeckEntry[] = focusCards.map((card) => ({ card, quantity: 1, board: "main" }));
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Control",
      colors: [],
      focusEntries,
      keywordFocus: ["Mill"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const result = generateDeck(options, [...focusCards, ...fillerCards, makeBasic("Wastes")]);

    for (const card of focusCards) {
      const entry = result.entries.find((e) => e.card.oracleId === card.oracleId);
      expect(entry?.quantity).toBe(1);
    }
    expect(result.entries.some((entry) => entry.card.name.startsWith("Fresh Candidate"))).toBe(true);
  });
});