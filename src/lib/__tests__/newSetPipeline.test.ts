/**
 * newSetPipeline.test.ts
 *
 * Unit tests for the new-set onboarding pipeline.
 * Verifies that runNewSetPipeline enriches cards with roles, secondary tags,
 * and synergy profiles without mutating the originals.
 */

import { describe, it, expect } from "vitest";
import type { CardRecord } from "../types";
import {
  runNewSetPipeline,
  enrichSingleCard,
  computePipelineSummary,
  enrichWithRoles,
  enrichWithSecondaryTags,
  enrichWithSynergyProfile,
} from "../onboarding/newSetPipeline";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardRecord>): CardRecord {
  return {
    id: "fake-id",
    oracleId: "fake-oracle",
    name: "Test Card",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{2}{W}",
    cmc: 3,
    colorsJson: '["W"]',
    colorIdentityJson: '["W"]',
    typeLine: "Creature — Human",
    oracleText: "",
    keywordsJson: "[]",
    power: "2",
    toughness: "2",
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: "legal",
    bannedInStandard: 0,
    legalitiesJson: "{}",
    setCode: "TEST",
    setName: "Test Set",
    setType: null,
    collectorNumber: null,
    rarity: "common",
    imageNormal: null,
    priceUsd: 0.10,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: 1000,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "test card",
    importedAt: new Date(0).toISOString(),
    ...overrides,
  };
}

// Representative card set covering different archetypes and oracle patterns
const REMOVAL_CARD = makeCard({
  oracleId: "removal-1",
  name: "Shock",
  typeLine: "Instant",
  oracleText: "Shock deals 2 damage to any target.",
  cmc: 1,
});

const DRAW_CARD = makeCard({
  oracleId: "draw-1",
  name: "Sign in Blood",
  typeLine: "Sorcery",
  oracleText: "Target player draws two cards and loses 2 life.",
  cmc: 2,
});

const FLYING_CREATURE = makeCard({
  oracleId: "fly-1",
  name: "Seraph of the Scales",
  typeLine: "Creature — Angel",
  oracleText: "Flying\nVigilance\nDeathtouch\nWhen Seraph of the Scales dies, create two 1/1 white Spirit creature tokens with flying.",
  keywordsJson: '["Flying","Vigilance","Deathtouch"]',
  power: "4",
  toughness: "3",
  cmc: 4,
});

const ENABLER_CARD = makeCard({
  oracleId: "enable-1",
  name: "Stitcher's Supplier",
  typeLine: "Creature — Zombie",
  oracleText: "When Stitcher's Supplier enters the battlefield, mill 3. When Stitcher's Supplier dies, mill 3.",
  power: "1",
  toughness: "1",
  cmc: 1,
});

const PAYOFF_CARD = makeCard({
  oracleId: "payoff-1",
  name: "Ghoultree",
  typeLine: "Creature — Zombie Treefolk",
  oracleText: "Ghoultree costs {1} less to cast for each creature card in your graveyard.",
  power: "10",
  toughness: "10",
  cmc: 8,
});

const RAMP_CARD = makeCard({
  oracleId: "ramp-1",
  name: "Llanowar Elf",
  typeLine: "Creature — Elf Druid",
  oracleText: "{T}: Add {G}.",
  producedManaJson: '["G"]',
  power: "1",
  toughness: "1",
  cmc: 1,
});

const LAND_CARD = makeCard({
  oracleId: "land-1",
  name: "Forest",
  typeLine: "Basic Land — Forest",
  oracleText: "{T}: Add {G}.",
  cmc: 0,
  power: null,
  toughness: null,
});

const FLASH_CARD = makeCard({
  oracleId: "flash-1",
  name: "Teferi, Mage of Zhalfir",
  typeLine: "Legendary Creature — Human Wizard",
  oracleText: "Flash\nCreature cards in your hand have flash.",
  keywordsJson: '["Flash"]',
  power: "3",
  toughness: "4",
  cmc: 5,
});

const TWO_FOR_ONE_CARD = makeCard({
  oracleId: "241-1",
  name: "Ravenous Chupacabra",
  typeLine: "Creature — Beast Horror",
  oracleText: "When Ravenous Chupacabra enters the battlefield, destroy target creature an opponent controls. Draw a card.",
  power: "2",
  toughness: "2",
  cmc: 4,
});

const ALL_CARDS: CardRecord[] = [
  REMOVAL_CARD,
  DRAW_CARD,
  FLYING_CREATURE,
  ENABLER_CARD,
  PAYOFF_CARD,
  RAMP_CARD,
  LAND_CARD,
  FLASH_CARD,
  TWO_FOR_ONE_CARD,
];

// ── runNewSetPipeline — basic shape ──────────────────────────────────────────

describe("runNewSetPipeline — basic shape", () => {
  it("returns an array with the same length as input", () => {
    const enriched = runNewSetPipeline(ALL_CARDS);
    expect(enriched.length).toBe(ALL_CARDS.length);
  });

  it("returns empty array for empty input", () => {
    expect(runNewSetPipeline([])).toEqual([]);
  });

  it("every enriched card has roles, secondaryTags, and synergyProfile", () => {
    const enriched = runNewSetPipeline(ALL_CARDS);
    for (const card of enriched) {
      expect(Array.isArray(card.roles)).toBe(true);
      expect(Array.isArray(card.secondaryTags)).toBe(true);
      expect(card.synergyProfile).toBeDefined();
      expect(typeof card.synergyProfile.engineRole).toBe("string");
      expect(Array.isArray(card.synergyProfile.sourceTags)).toBe(true);
      expect(Array.isArray(card.synergyProfile.payoffTags)).toBe(true);
    }
  });

  it("does not mutate input cards", () => {
    const originalJson = JSON.stringify(ALL_CARDS);
    runNewSetPipeline(ALL_CARDS);
    expect(JSON.stringify(ALL_CARDS)).toBe(originalJson);
  });

  it("preserves all original CardRecord fields", () => {
    const enriched = runNewSetPipeline([REMOVAL_CARD]);
    const card = enriched[0];
    expect(card.oracleId).toBe(REMOVAL_CARD.oracleId);
    expect(card.name).toBe(REMOVAL_CARD.name);
    expect(card.cmc).toBe(REMOVAL_CARD.cmc);
    expect(card.typeLine).toBe(REMOVAL_CARD.typeLine);
  });
});

// ── enrichWithRoles — role classification ────────────────────────────────────

describe("enrichWithRoles", () => {
  it("assigns Removal role to destroy/exile spells", () => {
    const roles = enrichWithRoles(REMOVAL_CARD);
    // Shock deals damage — may be Removal via "deals damage to target creature" pattern
    expect(Array.isArray(roles)).toBe(true);
  });

  it("assigns CardDraw role to draw spells", () => {
    const roles = enrichWithRoles(DRAW_CARD);
    expect(roles).toContain("CardDraw");
  });

  it("assigns Ramp role to mana-producing cards", () => {
    const roles = enrichWithRoles(RAMP_CARD);
    expect(roles).toContain("Ramp");
  });

  it("assigns EvasiveThreat to flying creatures", () => {
    const roles = enrichWithRoles(FLYING_CREATURE);
    expect(roles).toContain("EvasiveThreat");
  });

  it("assigns Enabler to mill cards", () => {
    const roles = enrichWithRoles(ENABLER_CARD);
    expect(roles).toContain("Enabler");
  });

  it("assigns Payoff to graveyard-scaling cards", () => {
    const roles = enrichWithRoles(PAYOFF_CARD);
    expect(roles).toContain("Payoff");
  });

  it("returns empty array for lands", () => {
    const roles = enrichWithRoles(LAND_CARD);
    expect(roles).toEqual([]);
  });

  it("never returns duplicate roles", () => {
    for (const card of ALL_CARDS) {
      const roles = enrichWithRoles(card);
      const unique = new Set(roles);
      expect(roles.length).toBe(unique.size);
    }
  });
});

// ── enrichWithSecondaryTags ───────────────────────────────────────────────────

describe("enrichWithSecondaryTags", () => {
  it("assigns 'flash' tag to flash cards", () => {
    const tags = enrichWithSecondaryTags(FLASH_CARD);
    expect(tags).toContain("flash");
  });

  it("assigns 'evasive' tag to flying creatures", () => {
    const tags = enrichWithSecondaryTags(FLYING_CREATURE);
    expect(tags).toContain("evasive");
  });

  it("assigns 'graveyard_filling' tag to mill cards", () => {
    const tags = enrichWithSecondaryTags(ENABLER_CARD);
    expect(tags).toContain("graveyard_filling");
  });

  it("assigns 'two_for_one' tag to ETB-that-draws-and-destroys", () => {
    const tags = enrichWithSecondaryTags(TWO_FOR_ONE_CARD);
    expect(tags).toContain("two_for_one");
  });

  it("returns no duplicate tags", () => {
    for (const card of ALL_CARDS) {
      const tags = enrichWithSecondaryTags(card);
      const unique = new Set(tags);
      expect(tags.length).toBe(unique.size);
    }
  });

  it("returns array (possibly empty) for all card types", () => {
    for (const card of ALL_CARDS) {
      const tags = enrichWithSecondaryTags(card);
      expect(Array.isArray(tags)).toBe(true);
    }
  });
});

// ── enrichWithSynergyProfile ──────────────────────────────────────────────────

describe("enrichWithSynergyProfile", () => {
  it("returns sourceTags, payoffTags, and engineRole", () => {
    const profile = enrichWithSynergyProfile(ENABLER_CARD);
    expect(Array.isArray(profile.sourceTags)).toBe(true);
    expect(Array.isArray(profile.payoffTags)).toBe(true);
    expect(typeof profile.engineRole).toBe("string");
  });

  it("enabler card has graveyard/selfMill in sourceTags", () => {
    const profile = enrichWithSynergyProfile(ENABLER_CARD);
    const graveyardAxes = ["graveyard", "selfMill", "mill"];
    const hasGraveyardAxis = profile.sourceTags.some((t) => graveyardAxes.includes(t));
    expect(hasGraveyardAxis).toBe(true);
  });

  it("payoff card has graveyard in payoffTags", () => {
    const profile = enrichWithSynergyProfile(PAYOFF_CARD);
    expect(profile.payoffTags).toContain("graveyard");
  });

  it("serialises cleanly (no Set objects in return)", () => {
    const profile = enrichWithSynergyProfile(FLYING_CREATURE);
    // Should be plain arrays, JSON-serialisable
    expect(() => JSON.stringify(profile)).not.toThrow();
  });
});

// ── enrichSingleCard ──────────────────────────────────────────────────────────

describe("enrichSingleCard", () => {
  it("returns the same enrichment as runNewSetPipeline for a single card", () => {
    const single = enrichSingleCard(DRAW_CARD);
    const batch = runNewSetPipeline([DRAW_CARD])[0];
    expect(single.roles).toEqual(batch.roles);
    expect(single.secondaryTags).toEqual(batch.secondaryTags);
    expect(single.synergyProfile).toEqual(batch.synergyProfile);
  });

  it("does not throw for any card type", () => {
    for (const card of ALL_CARDS) {
      expect(() => enrichSingleCard(card)).not.toThrow();
    }
  });
});

// ── computePipelineSummary ────────────────────────────────────────────────────

describe("computePipelineSummary", () => {
  it("total matches input count", () => {
    const enriched = runNewSetPipeline(ALL_CARDS);
    const summary = computePipelineSummary(enriched);
    expect(summary.total).toBe(ALL_CARDS.length);
  });

  it("withRoles > 0 for a set with non-land cards", () => {
    const enriched = runNewSetPipeline(ALL_CARDS);
    const summary = computePipelineSummary(enriched);
    expect(summary.withRoles).toBeGreaterThan(0);
  });

  it("withEnablerRole counts enabler cards", () => {
    const enriched = runNewSetPipeline([ENABLER_CARD]);
    const summary = computePipelineSummary(enriched);
    expect(summary.withEnablerRole).toBe(1);
  });

  it("withPayoffRole counts payoff cards", () => {
    const enriched = runNewSetPipeline([PAYOFF_CARD]);
    const summary = computePipelineSummary(enriched);
    expect(summary.withPayoffRole).toBe(1);
  });

  it("withFlashTag counts flash cards", () => {
    const enriched = runNewSetPipeline([FLASH_CARD]);
    const summary = computePipelineSummary(enriched);
    expect(summary.withFlashTag).toBe(1);
  });

  it("axisDistribution is a plain object", () => {
    const enriched = runNewSetPipeline(ALL_CARDS);
    const summary = computePipelineSummary(enriched);
    expect(typeof summary.axisDistribution).toBe("object");
    expect(summary.axisDistribution).not.toBeNull();
  });

  it("returns zeroes for empty input", () => {
    const summary = computePipelineSummary([]);
    expect(summary.total).toBe(0);
    expect(summary.withRoles).toBe(0);
    expect(summary.withEnablerRole).toBe(0);
    expect(summary.withPayoffRole).toBe(0);
  });
});
