import { describe, expect, it } from "vitest";
import { countLandSources, landSourceWeight } from "../landSources";
import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";

function card(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "land", oracleId: "land", name: "Test land", lang: "en", layout: "normal",
    cardFacesJson: null, manaCost: null, cmc: 0, colorsJson: "[]", colorIdentityJson: '["W"]',
    typeLine: "Land", oracleText: null, keywordsJson: "[]", power: null, toughness: null,
    loyalty: null, producedManaJson: '["W"]', legalityStandard: "legal", legalityFuture: null,
    bannedInStandard: 0, setCode: "tst", setName: "Test", setType: "expansion", collectorNumber: "1",
    rarity: "common", imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null,
    edhrecRank: null, gameChanger: 0, flavorText: null, artist: null, searchText: "", importedAt: "test",
    ...overrides,
  };
}
const entry = (value: CardRecord, quantity = 1): DeckEntry => ({ card: value, quantity, board: "main" });

describe("canonical source metadata", () => {
  it.each([
    ["This land enters tapped. {T}: Add {W}.", 0.38],
    ["{T}: Add {W}.", 0.74],
  ])("weights joined spell/land MDFCs like their front-only representation (%s)", (oracleText, weight) => {
    const modal = card({
      layout: "modal_dfc", typeLine: "Instant // Land",
      cardFacesJson: JSON.stringify([
        { type_line: "Instant", oracle_text: "Draw a card." },
        { type_line: "Land", oracle_text: oracleText },
      ]),
    });
    expect(landSourceWeight(modal)).toBe(weight);
    expect(landSourceWeight({ ...modal, typeLine: "Instant" })).toBe(weight);
    expect(countLandSources([entry(modal, 4)]).W).toBeCloseTo(4 * weight);
    expect(landSourceWeight({ ...modal, typeLine: "Land // Land" })).toBe(1);
    expect(landSourceWeight(card({ typeLine: "Instant" }))).toBe(0);
  });

  it.each(['["C"]', '[]'])("does not replace explicit production %s with color identity", producedManaJson => {
    expect(countLandSources([entry(card({ producedManaJson }), 14)]).W).toBe(0);
  });

  it("retains legacy identity fallback and production-first rainbow sources", () => {
    for (const producedManaJson of [undefined, "malformed"]) {
      expect(countLandSources([entry(card({ producedManaJson }), 4)]).W).toBe(4);
    }
    expect(countLandSources([entry(card({ colorIdentityJson: "[]", producedManaJson: '["W","U","B","R","G"]' }), 14)]))
      .toEqual({ W: 14, U: 14, B: 14, R: 14, G: 14 });
    expect(landSourceWeight(card())).toBe(1);
  });
});
