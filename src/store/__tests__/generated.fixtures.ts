import type { CardRecord } from "../../lib/types";
import type { DeckEntry } from "../../lib/legality";

export function card(oracleId = "Island", overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: oracleId, oracleId, name: oracleId, lang: "en", layout: "normal",
    cardFacesJson: null, manaCost: "", cmc: 0, colorsJson: "[]", colorIdentityJson: "[]",
    typeLine: "Basic Land — Island", oracleText: "", keywordsJson: "[]",
    power: null, toughness: null, loyalty: null, producedManaJson: '["U"]',
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: '{"standard":"legal","modern":"legal","commander":"legal","brawl":"legal"}',
    setCode: "TST", setName: "Test", setType: null, collectorNumber: null, rarity: null,
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null, searchText: oracleId, importedAt: "",
    ...overrides,
  };
}

export function deck(quantity = 60): DeckEntry[] {
  return [{ card: card(), quantity, board: "main" }];
}
