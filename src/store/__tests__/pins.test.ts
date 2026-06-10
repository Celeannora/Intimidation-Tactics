import { beforeEach, describe, expect, it } from "vitest";
import { useDeckStore } from "../deckStore";
import { db } from "../../lib/db";
import type { CardRecord } from "../../lib/types";

function makeCard(name: string): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{U}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: "Creature — Test",
    oracleText: "",
    keywordsJson: "[]",
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
    searchText: name,
    importedAt: "",
  } as CardRecord;
}

const cardA = makeCard("Card A");
const cardB = makeCard("Card B");

describe("deckStore pinning", () => {
  beforeEach(async () => {
    useDeckStore.getState().clearDeck();
    await db.cards.clear();
    await db.savedDecks.clear();
    await db.cards.bulkPut([cardA, cardB]);
  });

  it("pins a mainboard card at its current quantity and reports it as pinned", () => {
    const store = useDeckStore.getState();
    store.addCard(cardA, "main");
    store.addCard(cardA, "main"); // qty 2
    store.pinCard(cardA.oracleId);

    expect(useDeckStore.getState().isPinned(cardA.oracleId)).toBe(true);
    expect(useDeckStore.getState().pins[cardA.oracleId]).toBe(2);
  });

  it("does not pin cards that are not in the mainboard", () => {
    const store = useDeckStore.getState();
    store.pinCard(cardB.oracleId);
    expect(useDeckStore.getState().isPinned(cardB.oracleId)).toBe(false);
  });

  it("drops the pin when the card is fully removed", () => {
    const store = useDeckStore.getState();
    store.addCard(cardA, "main");
    store.pinCard(cardA.oracleId);
    expect(useDeckStore.getState().isPinned(cardA.oracleId)).toBe(true);

    store.removeCard(cardA.oracleId, "main");
    expect(useDeckStore.getState().isPinned(cardA.oracleId)).toBe(false);
  });

  it("clamps a pin down when quantity is reduced below the pinned amount", () => {
    const store = useDeckStore.getState();
    store.addCard(cardA, "main");
    store.addCard(cardA, "main");
    store.addCard(cardA, "main"); // qty 3
    store.pinCard(cardA.oracleId); // pinned at 3
    expect(useDeckStore.getState().pins[cardA.oracleId]).toBe(3);

    store.setQuantity(cardA.oracleId, "main", 1);
    expect(useDeckStore.getState().pins[cardA.oracleId]).toBe(1);
  });

  it("unpins on request", () => {
    const store = useDeckStore.getState();
    store.addCard(cardA, "main");
    store.pinCard(cardA.oracleId);
    store.unpinCard(cardA.oracleId);
    expect(useDeckStore.getState().isPinned(cardA.oracleId)).toBe(false);
  });

  it("persists pins through save + reload (survive reload)", async () => {
    const store = useDeckStore.getState();
    store.addCard(cardA, "main");
    store.addCard(cardA, "main");
    store.pinCard(cardA.oracleId);
    const deckId = useDeckStore.getState().activeDeckId;
    await useDeckStore.getState().saveCurrentDeck();

    // Wipe in-memory pins by starting a new deck, then reload the saved one.
    useDeckStore.getState().newDeck();
    expect(useDeckStore.getState().pins[cardA.oracleId]).toBeUndefined();

    await useDeckStore.getState().loadSavedDeck(deckId);
    expect(useDeckStore.getState().pins[cardA.oracleId]).toBe(2);
  });
});
