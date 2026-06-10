import { describe, expect, it } from "vitest";
import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import {
  detectArchetype,
  detectThemes,
  migrateArchetype,
  legacyArchetypeTheme,
} from "../archetype";

function card(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  cmc = 2,
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{U}",
    cmc,
    colorsJson: '["U"]',
    colorIdentityJson: '["W","U"]',
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
}

function entry(c: CardRecord, quantity = 1): DeckEntry {
  return { card: c, quantity, board: "main" };
}

const land = (name: string): CardRecord =>
  card(name, "", "Land", 0);

describe("migrateArchetype / legacyArchetypeTheme", () => {
  it("passes through current macros", () => {
    expect(migrateArchetype("Control")).toBe("Control");
    expect(migrateArchetype("Prison")).toBe("Prison");
  });

  it("maps legacy macro values onto the new taxonomy", () => {
    expect(migrateArchetype("Burn")).toBe("Aggro");
    expect(migrateArchetype("Tokens")).toBe("Midrange");
    expect(migrateArchetype("Graveyard")).toBe("Midrange");
    expect(migrateArchetype("Sacrifice")).toBe("Midrange");
  });

  it("falls back to Midrange for unknown strings and Unknown for empty", () => {
    expect(migrateArchetype("Nonsense")).toBe("Midrange");
    expect(migrateArchetype(null)).toBe("Unknown");
    expect(migrateArchetype(undefined)).toBe("Unknown");
  });

  it("recovers the theme implied by a legacy macro value", () => {
    expect(legacyArchetypeTheme("Burn")).toBe("burn");
    expect(legacyArchetypeTheme("Tokens")).toBe("tokens");
    expect(legacyArchetypeTheme("Graveyard")).toBe("graveyard");
    expect(legacyArchetypeTheme("Sacrifice")).toBe("sacrifice");
    expect(legacyArchetypeTheme("Control")).toBeUndefined();
  });
});

describe("detectArchetype — WU Lifegain/Mill", () => {
  // 6 lifegain SOURCES (lifelink + explicit life gain), none of which create tokens.
  const lifegainSources = [
    card("Soulful Cleric", "Lifelink"),
    card("Healer's Hawk", "Flying, lifelink"),
    card("Resplendent Angel", "When this creature attacks, you gain 3 life."),
    card("Ajani's Pridemate", "Whenever you gain life, put a +1/+1 counter on this. You gain 2 life."),
    card("Speaker of the Heavens", "You gain 1 life."),
    card("Light of Hope", "Choose one — You gain 4 life.", "Instant", 1),
  ];
  // 4 lifegain PAYOFFS.
  const lifegainPayoffs = [
    card("Heliod, Sun-Crowned", "Whenever you gain life, put a +1/+1 counter on target creature or enchantment you control."),
    card("Archangel of Thune", "Whenever you gain life, put a +1/+1 counter on each creature you control."),
    card("Cleric Class", "Whenever you gain life this turn, draw a card."),
    card("Voice of the Blessed", "Whenever you gain life, put a +1/+1 counter on this creature."),
  ];
  // 6 mill SOURCES targeting the opponent (deckout plan, not self-mill, not tokens).
  const millSources = [
    card("Drown in the Loch", "Target opponent mills 3 cards.", "Instant", 2),
    card("Maddening Cacophony", "Target opponent mills 5 cards.", "Sorcery", 2),
    card("Ruin Crab", "Target opponent mills 3 cards."),
    card("Tasha's Hideous Laughter", "Target opponent mills cards.", "Sorcery", 3),
    card("Fractured Sanity", "Target opponent mills 14 cards.", "Instant", 3),
    card("Bruvac the Grandiloquent", "Target opponent mills 2 cards."),
  ];

  // Control shell wrapped around the lifegain/mill engine: counters, removal,
  // sweepers and card draw at a higher curve so the macro reads as Control.
  const controlShell = [
    card("Counterspell", "Counter target spell.", "Instant", 2),
    card("Make Disappear", "Counter target spell unless its controller pays.", "Instant", 2),
    card("Dovin's Veto", "Counter target noncreature spell.", "Instant", 2),
    card("Three Steps Ahead", "Counter target spell.", "Instant", 3),
    card("Saw It Coming", "Counter target spell.", "Instant", 3),
    card("No More Lies", "Counter target spell unless its controller pays 3.", "Instant", 2),
    card("Get Lost", "Destroy target creature or planeswalker.", "Instant", 2),
    card("Go for the Throat", "Destroy target nonartifact creature.", "Instant", 2),
    card("The Wandering Emperor", "Destroy target attacking creature.", "Planeswalker", 4),
    card("Day of Judgment", "Destroy all creatures.", "Sorcery", 4),
    card("Sunfall", "Exile all creatures.", "Sorcery", 5),
    card("Memory Deluge", "Draw cards equal to the number.", "Instant", 4),
    card("Sphinx of Clear Skies", "Draw a card. You gain 3 life.", "Creature — Sphinx", 5),
    card("Behold the Multiverse", "Draw 2 cards.", "Instant", 4),
    card("Jace Reawakened", "Draw cards equal to two.", "Planeswalker", 4),
  ];

  const deck: DeckEntry[] = [
    ...lifegainSources.map((c) => entry(c)),
    ...lifegainPayoffs.map((c) => entry(c)),
    ...millSources.map((c) => entry(c)),
    ...controlShell.map((c) => entry(c)),
    ...Array.from({ length: 26 }, (_, i) => entry(land(`Island ${i}`))),
  ];

  it("detects Lifegain and Mill themes", () => {
    const themes = detectThemes(deck);
    const ids = themes.map((t) => t.id);
    expect(ids).toContain("lifegain");
    expect(ids).toContain("mill");
  });

  it("does NOT detect Tokens", () => {
    const ids = detectThemes(deck).map((t) => t.id);
    expect(ids).not.toContain("tokens");
  });

  it("classifies the macro as Control or Midrange (not Aggro)", () => {
    const { macro } = detectArchetype(deck);
    expect(["Control", "Midrange"]).toContain(macro);
  });

  it("returns macro under both archetype and macro fields", () => {
    const result = detectArchetype(deck);
    expect(result.archetype).toBe(result.macro);
    expect(result.themes.length).toBeGreaterThan(0);
  });
});

describe("detectArchetype — structural overrides", () => {
  it("detects Prison when stax pieces dominate", () => {
    const staxCards = Array.from({ length: 7 }, (_, i) =>
      entry(card(`Lock Piece ${i}`, "Your opponents can't draw more than one card each turn.", "Enchantment", 3)),
    );
    const wipes = Array.from({ length: 4 }, (_, i) =>
      entry(card(`Sweeper ${i}`, "Destroy all creatures.", "Sorcery", 4)),
    );
    const lands = Array.from({ length: 24 }, (_, i) => entry(land(`Plains ${i}`)));
    const { macro } = detectArchetype([...staxCards, ...wipes, ...lands]);
    expect(macro).toBe("Prison");
  });
});
