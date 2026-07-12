import { describe, expect, it } from "vitest";
import { renderToStaticMarkup } from "react-dom/server";
import { CardRow } from "../CardSearchPanel";
import type { CardRecord } from "../../lib/types";

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "c1",
    oracleId: "c1",
    name: "Test Card",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{G}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: "Creature — Test",
    oracleText: "Create a 1/1 green Saproling creature token.",
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
    searchText: "",
    importedAt: "",
    ...overrides,
  } as CardRecord;
}

describe("CardRow quick-synergy toggle", () => {
  it("renders the ≈ synergy toggle even when the deck is empty", () => {
    const html = renderToStaticMarkup(
      <CardRow card={makeCard()} deckCards={[]} onAdd={() => {}} />,
    );
    expect(html).toContain("Show synergy details for Test Card");
  });

  it("renders the ≈ synergy toggle when the deck is populated", () => {
    const deck = [makeCard({ id: "d1", name: "Token Lord", oracleText: "Tokens you control get +1/+1.", typeLine: "Enchantment" })];
    const html = renderToStaticMarkup(
      <CardRow card={makeCard()} deckCards={deck} onAdd={() => {}} />,
    );
    expect(html).toContain("Show synergy details for Test Card");
  });
});
