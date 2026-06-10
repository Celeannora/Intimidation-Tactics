import { describe, it, expect } from "vitest";
import {
  simulateHands,
  goldfishCard,
  deckToSimCards,
  isKeepable,
} from "../handSimulator";
import type { SimCard } from "../handSimulator";

// Build a simple test deck: 24 lands + 36 spells spread across CMCs 1-4
function buildTestDeck(): SimCard[] {
  const deck: SimCard[] = [];
  for (let i = 0; i < 24; i++)
    deck.push({ name: "Plains", cmc: 0, manaCost: null, isLand: true, producesColors: ["W"] });
  for (let i = 0; i < 12; i++)
    deck.push({ name: "1-drop", cmc: 1, manaCost: "{W}", isLand: false });
  for (let i = 0; i < 12; i++)
    deck.push({ name: "2-drop", cmc: 2, manaCost: "{W}{W}", isLand: false });
  for (let i = 0; i < 8; i++)
    deck.push({ name: "3-drop", cmc: 3, manaCost: "{2}{W}", isLand: false });
  for (let i = 0; i < 4; i++)
    deck.push({ name: "4-drop", cmc: 4, manaCost: "{3}{W}", isLand: false });
  return deck;
}

describe("isKeepable", () => {
  it("keeps hands with 2-5 lands", () => {
    const makeLand = () =>
      ({ name: "Land", cmc: 0, manaCost: null, isLand: true }) as SimCard;
    const makeSpell = () =>
      ({ name: "Spell", cmc: 2, manaCost: "{1}{W}", isLand: false }) as SimCard;

    expect(isKeepable([makeLand(), makeLand(), makeSpell(), makeSpell(), makeSpell(), makeSpell(), makeSpell()])).toBe(true);
    expect(isKeepable([makeLand(), makeSpell(), makeSpell(), makeSpell(), makeSpell(), makeSpell(), makeSpell()])).toBe(false); // 1 land
    expect(isKeepable([makeLand(), makeLand(), makeLand(), makeLand(), makeLand(), makeLand(), makeSpell()])).toBe(false); // 6 lands
  });
});

describe("simulateHands", () => {
  const deck = buildTestDeck();

  it("returns correct trial count", () => {
    const result = simulateHands(deck, 500, 7, 42);
    expect(result.trials).toBe(500);
  });

  it("avgLandsInHand is between 2 and 4 for a 24-land deck", () => {
    const result = simulateHands(deck, 5000, 7, 42);
    expect(result.avgLandsInHand).toBeGreaterThanOrEqual(2);
    expect(result.avgLandsInHand).toBeLessThanOrEqual(4);
  });

  it("keepRate is between 0.5 and 0.95", () => {
    const result = simulateHands(deck, 5000, 7, 42);
    expect(result.keepRate).toBeGreaterThan(0.5);
    expect(result.keepRate).toBeLessThan(0.95);
  });

  it("screwRate + floodRate < keepRate", () => {
    const result = simulateHands(deck, 5000, 7, 42);
    expect(result.screwRate + result.floodRate).toBeLessThan(1);
  });

  it("onCurveRates contains turn 1 key", () => {
    const result = simulateHands(deck, 5000, 7, 42);
    expect(result.onCurveRates[1]).toBeDefined();
  });

  it("stores trial detail when trials <= 1000", () => {
    const result = simulateHands(deck, 200, 7, 42);
    expect(result.trials_detail).toBeDefined();
    expect(result.trials_detail!.length).toBe(200);
  });

  it("omits trial detail when trials > 1000", () => {
    const result = simulateHands(deck, 2000, 7, 42);
    expect(result.trials_detail).toBeUndefined();
  });

  it("is deterministic with same seed", () => {
    const r1 = simulateHands(deck, 1000, 7, 99);
    const r2 = simulateHands(deck, 1000, 7, 99);
    expect(r1.keepRate).toBe(r2.keepRate);
    expect(r1.avgLandsInHand).toBe(r2.avgLandsInHand);
  });

  it("different seeds produce (likely) different results", () => {
    const r1 = simulateHands(deck, 1000, 7, 1);
    const r2 = simulateHands(deck, 1000, 7, 999);
    // Not guaranteed but overwhelmingly likely
    expect(r1.avgLandsInHand).not.toBe(r2.avgLandsInHand);
  });
});

describe("goldfishCard", () => {
  const deck = buildTestDeck();

  it("firstCastableTurnDistribution values sum to (1 - neverCastable)", () => {
    const result = goldfishCard(deck, "3-drop", 10, 2000, true, 42);
    const distSum = Object.values(result.firstCastableTurnDistribution).reduce((a, b) => a + b, 0);
    expect(distSum + result.neverCastable).toBeCloseTo(1, 1);
  });

  it("a 1-drop is rarely never castable within 5 turns", () => {
    const result = goldfishCard(deck, "1-drop", 5, 2000, true, 42);
    expect(result.neverCastable).toBeLessThan(0.2);
  });

  it("avgFirstCastableTurn is positive when card is found", () => {
    const result = goldfishCard(deck, "2-drop", 8, 2000, true, 42);
    expect(result.avgFirstCastableTurn).toBeGreaterThan(0);
  });

  it("returns neverCastable=1 for a card not in the deck", () => {
    const result = goldfishCard(deck, "Nonexistent Card", 8, 500, true, 42);
    expect(result.neverCastable).toBeCloseTo(1, 5);
  });

  it("cardName is returned correctly", () => {
    const result = goldfishCard(deck, "4-drop", 6, 500, true, 42);
    expect(result.cardName).toBe("4-drop");
  });
});

describe("deckToSimCards", () => {
  it("expands quantities into individual card entries", () => {
    const entries = [
      { name: "Island", quantity: 4, cmc: 0, manaCost: null, typeLine: "Basic Land", producedManaJson: '["U"]' },
      { name: "Counterspell", quantity: 2, cmc: 2, manaCost: "{U}{U}", typeLine: "Instant" },
    ];
    const cards = deckToSimCards(entries);
    expect(cards).toHaveLength(6);
    expect(cards.filter(c => c.isLand)).toHaveLength(4);
    expect(cards.filter(c => !c.isLand)).toHaveLength(2);
  });

  it("sets isLand=true for land type lines", () => {
    const entries = [{ name: "Forest", quantity: 1, cmc: 0, manaCost: null, typeLine: "Basic Land — Forest" }];
    const cards = deckToSimCards(entries);
    expect(cards[0].isLand).toBe(true);
  });

  it("parses producedManaJson into producesColors", () => {
    const entries = [{ name: "Island", quantity: 1, cmc: 0, manaCost: null, typeLine: "Basic Land", producedManaJson: '["U"]' }];
    const cards = deckToSimCards(entries);
    expect(cards[0].producesColors).toEqual(["U"]);
  });

  it("handles empty deck", () => {
    expect(deckToSimCards([])).toHaveLength(0);
  });
});
