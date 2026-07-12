/**
 * broadTagBonus.test.ts
 *
 * Unit tests for broadTagBonus (Priority 11) — rewarding ramp/tutor/draw
 * broadTags when they match archetype/deck needs, capped at +3.
 */

import { describe, it, expect } from "vitest";
import type { CardRecord } from "../../types";
import { broadTagBonus } from "../weights";

function makeCard(overrides: Partial<CardRecord> & { name: string }): CardRecord {
  const { name, ...rest } = overrides;
  return {
    id: name, oracleId: name, name,
    lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{1}{G}", cmc: 2,
    colorsJson: JSON.stringify(["G"]),
    colorIdentityJson: JSON.stringify(["G"]),
    typeLine: "Sorcery",
    oracleText: "",
    keywordsJson: "[]",
    power: null, toughness: null, loyalty: null, producedManaJson: "[]",
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: "legal" }),
    setCode: "TST", setName: "Test Set", setType: null, collectorNumber: null, rarity: "common",
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null,
    searchText: name.toLowerCase(), importedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  } as CardRecord;
}

const card = makeCard({ name: "Test" });

describe("broadTagBonus", () => {
  it("awards +3 for a tutor in a Combo deck", () => {
    expect(broadTagBonus(card, new Set(["tutor"]), { archetype: "Combo", cardAdvantageScore: 100 })).toBe(3);
  });

  it("does not award the tutor bonus outside Combo", () => {
    expect(broadTagBonus(card, new Set(["tutor"]), { archetype: "Aggro", cardAdvantageScore: 100 })).toBe(0);
  });

  it("awards +2 for ramp in Ramp and Control decks", () => {
    expect(broadTagBonus(card, new Set(["ramp"]), { archetype: "Ramp", cardAdvantageScore: 100 })).toBe(2);
    expect(broadTagBonus(card, new Set(["ramp"]), { archetype: "Control", cardAdvantageScore: 100 })).toBe(2);
  });

  it("awards +2 for draw only when deck is card-starved (< 40)", () => {
    expect(broadTagBonus(card, new Set(["draw"]), { archetype: "Midrange", cardAdvantageScore: 30 })).toBe(2);
    expect(broadTagBonus(card, new Set(["draw"]), { archetype: "Midrange", cardAdvantageScore: 40 })).toBe(0);
  });

  it("caps the combined bonus at +3", () => {
    // ramp (+2) in Control + draw (+2) when starved would be +4, capped to +3.
    const bonus = broadTagBonus(card, new Set(["ramp", "draw"]), { archetype: "Control", cardAdvantageScore: 10 });
    expect(bonus).toBe(3);
  });

  it("returns 0 for lands regardless of tags", () => {
    const land = makeCard({ name: "Land", typeLine: "Land" });
    expect(broadTagBonus(land, new Set(["ramp", "tutor", "draw"]), { archetype: "Combo", cardAdvantageScore: 0 })).toBe(0);
  });

  it("returns 0 when no relevant broadTags are present", () => {
    expect(broadTagBonus(card, new Set(["removal", "flying"]), { archetype: "Combo", cardAdvantageScore: 0 })).toBe(0);
  });
});
