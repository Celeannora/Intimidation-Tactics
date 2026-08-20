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

describe("generateDeck seed quantity policy", () => {
  function makeBombSeed(): CardRecord {
    return {
      ...makeCard("Bomb Seed", "A powerful build-around threat.", "Creature — Test", []),
      gameChanger: 1,
      edhrecRank: 100,
      rarity: "mythic",
    } as CardRecord;
  }

  function makeFillerCards(count: number): CardRecord[] {
    // power "3" at cmc 2 makes these register as the "Beater" threat role
    // (assignRoles requires power >= 3 && cmc <= 3), so fillRole actually
    // places them into the deck instead of leaving every role slot empty.
    return Array.from({ length: count }, (_, i) =>
      ({
        ...makeCard(`Filler ${i + 1}`, "A vanilla creature.", "Creature — Test", []),
        gameChanger: 0,
        edhrecRank: 20000,
        rarity: "common",
        power: "3",
        toughness: "3",
      } as CardRecord)
    );
  }

  function baseOptions(seedEntries: DeckEntry[], seedPolicy?: GenerateOptions["seedPolicy"]): GenerateOptions {
    return {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      seedEntries,
      seedPolicy,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };
  }

  it("locked-core (default): a seed never gains extra copies, even when it scores far above everything else", () => {
    const bomb = makeBombSeed();
    const filler = makeFillerCards(30);
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 1, board: "main" }];
    const options = baseOptions(seedEntries); // no seedPolicy -> defaults to locked-core

    const result = generateDeck(options, [bomb, ...filler, makeBasic("Wastes")]);

    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);
    expect(bombEntry?.quantity).toBe(1);
    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed promotion"))).toBe(false);
  });

  it("strong-preference: promotes a high-scoring seed above its imported quantity, funded by the weakest unlocked filler", () => {
    const bomb = makeBombSeed();
    const filler = makeFillerCards(30);
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 1, board: "main" }];
    const options = baseOptions(seedEntries, "strong-preference");

    const result = generateDeck(options, [bomb, ...filler, makeBasic("Wastes")]);

    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);
    expect(bombEntry?.quantity).toBeGreaterThan(1);
    expect(bombEntry?.quantity).toBeLessThanOrEqual(4);
    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed promotion"))).toBe(true);

    // Total nonland copy count must stay conserved -- promotion trades
    // copies, it never inflates the deck.
    const nonlandTotal = result.entries
      .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
      .reduce((sum, e) => sum + e.quantity, 0);
    expect(nonlandTotal).toBe(options.mainboardSize! - result.entries.filter((e) => e.card.typeLine.includes("Land")).reduce((s, e) => s + e.quantity, 0));
  });

  it("strong-preference: a legendary seed is never promoted past its 2-copy legend-rule convention cap", () => {
    const legendarySeed = {
      ...makeBombSeed(),
      name: "Legendary Bomb Seed",
      oracleId: "Legendary Bomb Seed",
      id: "Legendary Bomb Seed",
      typeLine: "Legendary Creature — Test",
    } as CardRecord;
    const filler = makeFillerCards(30);
    const seedEntries: DeckEntry[] = [{ card: legendarySeed, quantity: 1, board: "main" }];
    const options = baseOptions(seedEntries, "strong-preference");

    const result = generateDeck(options, [legendarySeed, ...filler, makeBasic("Wastes")]);

    const seedEntry = result.entries.find((e) => e.card.oracleId === legendarySeed.oracleId);
    expect(seedEntry?.quantity).toBeLessThanOrEqual(2);
  });

  it("strong-preference: never drops a seed below the quantity it was imported with", () => {
    const bomb = makeBombSeed();
    // Seed imported at 2 copies already -- strong-preference must never reduce this.
    const filler = makeFillerCards(30);
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 2, board: "main" }];
    const options = baseOptions(seedEntries, "strong-preference");

    const result = generateDeck(options, [bomb, ...filler, makeBasic("Wastes")]);

    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);
    expect(bombEntry?.quantity).toBeGreaterThanOrEqual(2);
  });
});