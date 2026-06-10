import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import { buildSynergyProfile, crossAxisCompositionBonus, inferPrimaryAxes, summarizeSynergyConnections, synergyDensityMultiplier } from "../synergyModel";

function makeCard(name: string, oracleText: string, typeLine = "Creature — Test", quantity = 1): CardRecord[] {
  const card = {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{G}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine,
    oracleText,
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
  } as CardRecord;
  return Array.from({ length: quantity }, () => card);
}

describe("inferPrimaryAxes", () => {
  it("detects narrow mill plans with only five explicit mill cards in a larger imported deck", () => {
    const cards = [
      ...makeCard("Mill Source A", "Target opponent mills three cards.", "Sorcery", 3),
      ...makeCard("Mill Source B", "Each opponent mills two cards.", "Creature — Horror", 2),
      ...makeCard("Generic Draw", "Draw a card.", "Instant", 10),
      ...makeCard("Generic Interaction", "Destroy target creature.", "Instant", 8),
      ...makeCard("Generic Threat", "Flying.", "Creature — Bird", 15),
    ];

    const axes = inferPrimaryAxes(cards.map(buildSynergyProfile));

    expect(axes).toContain("mill");
  });

  it("does not promote incidental two-card sacrifice signals", () => {
    const cards = [
      ...makeCard("Token Maker A", "Create a 1/1 green Saproling creature token.", "Creature — Fungus", 4),
      ...makeCard("Token Maker B", "Create a 1/1 white Soldier creature token.", "Creature — Soldier", 4),
      ...makeCard("Token Payoff", "Tokens you control get +1/+1.", "Enchantment", 4),
      ...makeCard("Incidental Sac Outlet", "Sacrifice another creature: scry 1.", "Creature — Vampire", 2),
      ...makeCard("Generic Threat", "Trample.", "Creature — Beast", 6),
    ];

    const axes = inferPrimaryAxes(cards.map(buildSynergyProfile));

    expect(axes[0]).toBe("tokens");
    expect(axes).not.toContain("sacrifice");
  });

  it("keeps only the strongest three mechanical axes", () => {
    const cards = [
      ...makeCard("Draw Source", "Draw a card.", "Sorcery", 5),
      ...makeCard("Token Source", "Create a 1/1 creature token.", "Sorcery", 5),
      ...makeCard("Graveyard Source", "Return target creature card from your graveyard to your hand.", "Sorcery", 5),
      ...makeCard("Counter Source", "Put a +1/+1 counter on target creature.", "Instant", 5),
    ];

    expect(inferPrimaryAxes(cards.map(buildSynergyProfile))).toHaveLength(3);
  });
});

describe("synergy connection scoring", () => {
  it("rewards dense source to payoff relationships", () => {
    const candidate = buildSynergyProfile(makeCard("Token Maker", "Create a 1/1 white Soldier creature token.")[0]);
    const deckProfiles = [
      ...makeCard("Token Payoff A", "Tokens you control get +1/+1.", "Enchantment", 2),
      ...makeCard("Token Payoff B", "Whenever you create a token, draw a card.", "Creature — Advisor", 2),
    ].map(buildSynergyProfile);

    const summary = summarizeSynergyConnections(candidate, deckProfiles);

    expect(summary.partners).toBeGreaterThanOrEqual(2);
    expect(summary.links).toBeGreaterThanOrEqual(2);
    expect(synergyDensityMultiplier(summary)).toBeGreaterThan(1);
  });

  it("recognizes cross-axis viable compositions like tokens plus sacrifice", () => {
    const candidate = buildSynergyProfile(makeCard("Sacrifice Outlet", "Sacrifice another creature: draw a card.")[0]);
    const deckProfiles = makeCard("Token Maker", "Create a 1/1 green Saproling creature token.", "Creature — Fungus", 4)
      .map(buildSynergyProfile);

    expect(crossAxisCompositionBonus(candidate, deckProfiles)).toBeGreaterThanOrEqual(8);
  });

  it("distinguishes self-mill from opponent mill", () => {
    const selfMill = buildSynergyProfile(makeCard("Self Mill", "Mill three cards. Return target creature card from your graveyard to your hand.", "Sorcery")[0]);
    const opponentMill = buildSynergyProfile(makeCard("Opponent Mill", "Target opponent mills three cards.", "Sorcery")[0]);
    const oracleMill = buildSynergyProfile(makeCard("Oracle Mill", "Target player puts the top five cards of their library into their graveyard.", "Sorcery")[0]);

    expect(selfMill.sourceTags.has("selfMill")).toBe(true);
    expect(selfMill.sourceTags.has("mill")).toBe(false);
    expect(opponentMill.sourceTags.has("mill")).toBe(true);
    expect(opponentMill.sourceTags.has("selfMill")).toBe(false);
    expect(oracleMill.sourceTags.has("mill")).toBe(true);
    expect(oracleMill.sourceTags.has("selfMill")).toBe(false);
  });

  it("only gives graveyard cross-axis bonus to self-mill, not opponent mill", () => {
    const recursionDeck = makeCard("Recursion", "Return target creature card from your graveyard to your hand.", "Sorcery", 4)
      .map(buildSynergyProfile);
    const selfMill = buildSynergyProfile(makeCard("Self Mill", "Mill three cards.", "Sorcery")[0]);
    const opponentMill = buildSynergyProfile(makeCard("Opponent Mill", "Target opponent mills three cards.", "Sorcery")[0]);

    expect(crossAxisCompositionBonus(selfMill, recursionDeck)).toBeGreaterThanOrEqual(7);
    expect(crossAxisCompositionBonus(opponentMill, recursionDeck)).toBe(0);
  });
});