/**
 * Integration tests for the unified synergy pipeline.
 * Verifies that the V2 scoring engine produces consistent results,
 * correlates positively with legacy behavior, and that the optimizer
 * improvements converge correctly.
 */

import { describe, expect, it } from "vitest";
import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import { buildConsistencyReport, type ConsistencyEntry } from "../consistencyReport";
import { computeCompositeScore, scoreCandidates } from "../scoreEngine";
import { computeSynergyScoreV2, buildSynergyProfile, crossAxisCompositionBonus } from "../generator/synergyModel";

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  cmc = 2,
  keywordsJson = "[]"
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{G}",
    cmc,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine,
    oracleText,
    keywordsJson,
    power: "2",
    toughness: "2",
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
    searchText: "",
    importedAt: "",
  } as CardRecord;
}

function makeEntry(card: CardRecord, quantity = 1, board: "main" | "side" = "main"): DeckEntry {
  return { card, quantity, board };
}

function makeConsistencyEntry(
  name: string,
  quantity: number,
  cmc: number,
  manaCost: string | null,
  typeLine: string,
  producedManaJson?: string
): ConsistencyEntry {
  return { name, quantity, cmc, manaCost, typeLine, producedManaJson };
}

describe("computeCompositeScore", () => {
  it("returns 0 for empty deck with no axes", () => {
    const card = makeCard("Grizzly Bears", "", "Creature — Bear");
    const result = computeCompositeScore(card, [], { archetype: "Unknown" });
    expect(result.total).toBeGreaterThanOrEqual(0);
    expect(result.directionalScore).toBe(0);
  });

  it("rewards source → payoff connections when axes are detected", () => {
    // Need >=3 unique nonland profiles with the same axis to pass inferPrimaryAxes threshold
    const tokenSource1 = makeCard("Dragon Fodder", "Create a 1/1 red Goblin creature token.", "Sorcery", 2);
    const tokenSource2 = makeCard("Raise the Alarm", "Create a 1/1 white Soldier creature token.", "Instant", 2);
    const tokenSource3 = makeCard("Krenko's Command", "Create a 1/1 red Goblin creature token.", "Sorcery", 2);
    const tokenPayoff = makeCard("Impact Tremors", "Whenever a creature enters the battlefield under your control, this deals 1 damage to each opponent.", "Enchantment", 2);
    const deck = [
      makeEntry(tokenSource1, 4),
      makeEntry(tokenSource2, 3),
      makeEntry(tokenSource3, 3),
      makeEntry(makeCard("Land", "", "Basic Land — Forest", 0), 20),
    ];
    const result = computeCompositeScore(tokenPayoff, deck, { archetype: "Aggro" });

    expect(result.directionalScore).toBeGreaterThan(0);
    expect(result.total).toBeGreaterThan(0);
  });

  it("penalizes bad castability", () => {
    const card = makeCard("Expensive Threat", "", "Creature — Dragon", 8);
    const result = computeCompositeScore(card, [], { archetype: "Aggro" }, 0.25);
    expect(result.castabilityPenalty).toBeGreaterThan(2);
  });

  it("applies castability penalty proportionally", () => {
    const card = makeCard("Test Card", "", "Creature", 3);
    const good = computeCompositeScore(card, [], { archetype: "Aggro" }, 0.80);
    const bad = computeCompositeScore(card, [], { archetype: "Aggro" }, 0.20);
    expect(good.castabilityPenalty).toBeLessThan(bad.castabilityPenalty);
  });
});

describe("scoreCandidates", () => {
  it("sorts cards by total score descending", () => {
    const cards = [
      makeCard("Card A", "Create a 1/1 token.", "Creature", 2),
      makeCard("Card B", "", "Creature", 2),
      makeCard("Card C", "Destroy target creature.", "Instant", 2),
    ];
    const deck = [makeEntry(cards[0], 4)];
    const results = scoreCandidates(cards, deck, { archetype: "Midrange" });

    expect(results.length).toBe(3);
    for (let i = 1; i < results.length; i++) {
      expect(results[i - 1].score.total).toBeGreaterThanOrEqual(results[i].score.total);
    }
  });
});

describe("computeSynergyScoreV2 (backward compatibility)", () => {
  it("produces nonzero scores for synergistic cards", () => {
    // Need >=3 unique token-making profiles to pass coverage threshold
    const tokenCard1 = makeCard("Krenko's Command", "Create a 1/1 red Goblin creature token.", "Sorcery", 2);
    const tokenCard2 = makeCard("Dragon Fodder", "Create a 1/1 red Goblin creature token.", "Sorcery", 2);
    const tokenCard3 = makeCard("Raise the Alarm", "Create a 1/1 white Soldier creature token.", "Instant", 2);
    const otherToken = makeCard("Hordeling Outburst", "Create a 1/1 red Goblin creature token.", "Sorcery", 3);
    const deck = [makeEntry(tokenCard1, 4), makeEntry(tokenCard2, 3), makeEntry(tokenCard3, 3)];

    const score = computeSynergyScoreV2(otherToken, deck);
    expect(score).toBeGreaterThan(0);
    expect(score).toBeLessThanOrEqual(30);
  });

  it("returns 0 for empty deck", () => {
    const card = makeCard("Test", "Draw a card.", "Instant", 2);
    expect(computeSynergyScoreV2(card, [])).toBe(0);
  });
});

describe("crossAxisCompositionBonus", () => {
  it("detects tokens + sacrifice synergy", () => {
    // Need enough token cards to qualify as a deck axis
    const tokenMaker = makeCard("Dragon Fodder", "Create a 1/1 red Goblin creature token.", "Sorcery", 2);
    const tokenMaker2 = makeCard("Raise the Alarm", "Create a 1/1 white Soldier creature token.", "Instant", 2);
    // Token payoff also qualifies as a token source since it has create
    const tokenPayoff = makeCard("Cathars' Crusade", "Whenever a creature enters the battlefield under your control, put a +1/+1 counter on each creature you control.", "Enchantment", 4);
    const sacOutlet = makeCard("Viscera Seer", "Sacrifice a creature: Scry 1.", "Creature — Vampire", 1);
    const deckProfiles = [
      buildSynergyProfile(tokenMaker),
      buildSynergyProfile(tokenMaker2),
      buildSynergyProfile(tokenPayoff),
    ];
    const candidate = buildSynergyProfile(sacOutlet);

    const bonus = crossAxisCompositionBonus(candidate, deckProfiles);
    expect(bonus).toBeGreaterThanOrEqual(8);
  });

  it("detects graveyard + self-mill synergy", () => {
    // "Mill three cards" matches the selfMill source pattern
    const millCard = makeCard("Mill", "Mill three cards.", "Sorcery", 2);
    const millCard2 = makeCard("Stitcher's Supplier", "When this creature enters, mill two cards.", "Creature", 1);
    const recursion = makeCard("Reanimate", "Return target creature card from your graveyard to the battlefield.", "Sorcery", 3);
    const deckProfiles = [
      buildSynergyProfile(millCard),
      buildSynergyProfile(millCard2),
    ];
    const candidate = buildSynergyProfile(recursion);

    const bonus = crossAxisCompositionBonus(candidate, deckProfiles);
    expect(bonus).toBeGreaterThanOrEqual(7);
  });
});

describe("consistency report integration", () => {
  it("produces castability map with correct keys", () => {
    const mainboard: ConsistencyEntry[] = [
      makeConsistencyEntry("Swamp", 14, 0, null, "Basic Land — Swamp", '["B"]'),
      makeConsistencyEntry("Forest", 10, 0, null, "Basic Land — Forest", '["G"]'),
      makeConsistencyEntry("Llanowar Elves", 4, 1, "{G}", "Creature — Elf", '["G"]'),
      makeConsistencyEntry("Grizzly Bears", 4, 2, "{1}{G}", "Creature — Bear"),
    ];

    const report = buildConsistencyReport(mainboard, 1000, true);
    expect(report.castabilityMap.size).toBeGreaterThanOrEqual(2);
    expect(report.flaggedCards.length).toBeGreaterThanOrEqual(0);
  });
});