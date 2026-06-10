import { describe, it, expect } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import { colorAffinity, colorAffinityDetail } from "../colorWeights";

function makeCard(overrides: Partial<CardRecord> & { name: string; typeLine: string; identity: ManaColor[]; oracleText: string }): CardRecord {
  return {
    id: overrides.name,
    oracleId: overrides.name,
    name: overrides.name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "",
    cmc: overrides.cmc ?? 2,
    colorsJson: JSON.stringify(overrides.identity),
    colorIdentityJson: JSON.stringify(overrides.identity),
    typeLine: overrides.typeLine,
    oracleText: overrides.oracleText,
    keywordsJson: overrides.keywordsJson ?? "[]",
    power: overrides.power ?? null,
    toughness: overrides.toughness ?? null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: null,
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

describe("colorWeights", () => {
  it("blue counterspell is strongly on-pie", () => {
    const card = makeCard({
      name: "Counterspell",
      typeLine: "Instant",
      identity: ["U"],
      oracleText: "Counter target spell.",
    });
    expect(colorAffinity(card)).toBeGreaterThan(1.3);
  });

  it("white board wipe is on-pie", () => {
    const card = makeCard({
      name: "Wrath of God",
      typeLine: "Sorcery",
      identity: ["W"],
      oracleText: "Destroy all creatures.",
      cmc: 4,
    });
    expect(colorAffinity(card)).toBeGreaterThan(1.2);
  });

  it("hypothetical red counterspell is off-pie", () => {
    const card = makeCard({
      name: "Red Counterspell",
      typeLine: "Instant",
      identity: ["R"],
      oracleText: "Counter target spell.",
    });
    expect(colorAffinity(card)).toBeLessThan(0.7);
  });

  it("colorless artifact is neutral", () => {
    const card = makeCard({
      name: "Sol Ring",
      typeLine: "Artifact",
      identity: [],
      oracleText: "Add {C}{C}.",
    });
    expect(colorAffinity(card)).toBeCloseTo(1.0, 5);
  });

  it("land returns 1.0", () => {
    const card = makeCard({
      name: "Island",
      typeLine: "Basic Land — Island",
      identity: ["U"],
      oracleText: "({T}: Add {U}.)",
    });
    expect(colorAffinity(card)).toBe(1.0);
  });

  it("strength=0 disables (returns 1.0)", () => {
    const card = makeCard({
      name: "Counterspell",
      typeLine: "Instant",
      identity: ["U"],
      oracleText: "Counter target spell.",
    });
    expect(colorAffinity(card, 0)).toBeCloseTo(1.0, 5);
  });

  it("multicolor takes max across colors per role (green ramp in BG)", () => {
    const card = makeCard({
      name: "Cultivate",
      typeLine: "Sorcery",
      identity: ["B", "G"],
      oracleText: "Search your library for a basic land card, put it onto the battlefield. Add {G}.",
      cmc: 3,
    });
    const detail = colorAffinityDetail(card);
    // Green's 1.45 for Ramp should win over Black's 0.75
    expect(detail.affinity).toBeGreaterThan(1.2);
  });
});
