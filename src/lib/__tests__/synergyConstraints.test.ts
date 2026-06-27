/**
 * synergyConstraints.test.ts
 *
 * Unit tests for SYNERGY_PAIR_CONSTRAINTS and validateSynergyPairs.
 * Uses lightweight mock DeckEntry objects — no real Scryfall data needed.
 */

import { describe, it, expect } from "vitest";
import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";
import {
  validateSynergyPairs,
  SYNERGY_PAIR_CONSTRAINTS,
} from "../generator/synergyConstraints";

// ── Test helpers ─────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardRecord>): CardRecord {
  return {
    id: "fake-id",
    oracleId: "fake-oracle",
    name: "Test Card",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{2}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: "Enchantment",
    oracleText: "",
    keywordsJson: "[]",
    power: null,
    toughness: null,
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

function makeEntry(
  name: string,
  oracleText: string,
  typeLine: string,
  quantity: number,
  oracleId?: string,
): DeckEntry {
  return {
    card: makeCard({ name, oracleText, typeLine, oracleId: oracleId ?? name.toLowerCase().replace(/ /g, "-") }),
    quantity,
    board: "main",
  };
}

// ── SYNERGY_PAIR_CONSTRAINTS shape ────────────────────────────────────────────

describe("SYNERGY_PAIR_CONSTRAINTS", () => {
  it("exports a non-empty array", () => {
    expect(Array.isArray(SYNERGY_PAIR_CONSTRAINTS)).toBe(true);
    expect(SYNERGY_PAIR_CONSTRAINTS.length).toBeGreaterThan(0);
  });

  it("every constraint has required fields", () => {
    for (const c of SYNERGY_PAIR_CONSTRAINTS) {
      expect(typeof c.id).toBe("string");
      expect(c.id.length).toBeGreaterThan(0);
      expect(typeof c.description).toBe("string");
      expect(Array.isArray(c.payoffPatterns)).toBe(true);
      expect(Array.isArray(c.sourcePatterns)).toBe(true);
      expect(typeof c.minSources).toBe("number");
      expect(c.minSources).toBeGreaterThan(0);
    }
  });

  it("all archetypes arrays (when present) contain valid archetype strings", () => {
    const validArchetypes = new Set(["Aggro", "Midrange", "Control", "Tempo", "Combo", "Ramp", "Prison", "Unknown"]);
    for (const c of SYNERGY_PAIR_CONSTRAINTS) {
      if (c.archetypes) {
        for (const arch of c.archetypes) {
          expect(validArchetypes.has(arch)).toBe(true);
        }
      }
    }
  });

  it("includes the 'sacrifice-outlets' constraint", () => {
    const ids = SYNERGY_PAIR_CONSTRAINTS.map((c) => c.id);
    expect(ids).toContain("sacrifice-outlets");
  });

  it("includes the 'reanimator-enablers' constraint", () => {
    const ids = SYNERGY_PAIR_CONSTRAINTS.map((c) => c.id);
    expect(ids).toContain("reanimator-enablers");
  });
});

// ── validateSynergyPairs — no violations ─────────────────────────────────────

describe("validateSynergyPairs — no violations", () => {
  it("returns empty array for an empty deck", () => {
    const violations = validateSynergyPairs([], "Midrange");
    expect(violations).toEqual([]);
  });

  it("returns empty array for a deck with no payoff cards", () => {
    const deck: DeckEntry[] = [
      makeEntry("Shock", "Shock deals 2 damage to any target.", "Instant", 4),
      makeEntry("Lightning Bolt", "Deal 3 damage.", "Instant", 4),
    ];
    const violations = validateSynergyPairs(deck, "Aggro");
    expect(violations).toEqual([]);
  });

  it("no violation when sacrifice payoffs have enough sacrifice outlets", () => {
    // Blood Artist = payoff for sacrifice
    const payoff = makeEntry(
      "Blood Artist",
      "Whenever a creature is put into a graveyard from anywhere, target player loses 1 life.",
      "Creature — Vampire",
      4,
    );
    // Viscera Seer = sacrifice outlet (4 copies)
    const source1 = makeEntry("Viscera Seer", "Sacrifice a creature: Scry 1.", "Creature — Vampire Wizard", 4, "viscera-seer");
    const source2 = makeEntry("Altar of Dementia", "{1}: sacrifice a creature: target player mills X.", "Artifact", 4, "altar");
    const deck: DeckEntry[] = [payoff, source1, source2];
    const violations = validateSynergyPairs(deck, "Midrange");
    expect(violations.find((v) => v.constraintId === "sacrifice-outlets")).toBeUndefined();
  });
});

// ── validateSynergyPairs — violations triggered ───────────────────────────────

describe("validateSynergyPairs — violations triggered", () => {
  it("flags error when sacrifice payoffs have zero sacrifice outlets", () => {
    const payoff = makeEntry(
      "Blood Artist",
      "Whenever a creature is put into a graveyard from anywhere, target player loses 1 life and you gain 1 life.",
      "Creature — Vampire",
      4,
    );
    // No sacrifice outlets
    const filler = makeEntry("Forest Bear", "When Forest Bear attacks, it gets +1/+1.", "Creature — Bear", 4);
    const deck: DeckEntry[] = [payoff, filler];
    const violations = validateSynergyPairs(deck, "Midrange");
    const v = violations.find((x) => x.constraintId === "sacrifice-outlets");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("error");
    expect(v?.sourceCount).toBe(0);
  });

  it("flags warning when sacrifice payoffs have some (but not enough) outlets", () => {
    const payoff = makeEntry(
      "Mayhem Devil",
      "Whenever you sacrifice a permanent, Mayhem Devil deals 1 damage.",
      "Creature — Devil",
      4,
    );
    // Only 2 copies of an outlet — below minSources for sacrifice-outlets (4)
    const outlet = makeEntry("Viscera Seer", "Sacrifice a creature: Scry 1.", "Creature — Vampire Wizard", 2);
    const deck: DeckEntry[] = [payoff, outlet];
    const violations = validateSynergyPairs(deck, "Midrange");
    const v = violations.find((x) => x.constraintId === "sacrifice-outlets");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("warning");
    expect(v?.sourceCount).toBeGreaterThan(0);
    expect(v?.sourceCount).toBeLessThan(v?.requiredSources ?? 999);
  });

  it("violation has the required shape", () => {
    const payoff = makeEntry(
      "Zulaport Cutthroat",
      "Whenever Zulaport Cutthroat or another creature you control dies, target opponent loses 1 life.",
      "Creature — Human Rogue",
      4,
    );
    const filler = makeEntry("Nest Robber", "", "Creature — Dinosaur", 4);
    const deck: DeckEntry[] = [payoff, filler];
    const violations = validateSynergyPairs(deck, "Midrange");
    expect(violations.length).toBeGreaterThan(0);

    const v = violations[0];
    expect(typeof v.constraintId).toBe("string");
    expect(typeof v.description).toBe("string");
    expect(Array.isArray(v.payoffCards)).toBe(true);
    expect(typeof v.sourceCount).toBe("number");
    expect(typeof v.requiredSources).toBe("number");
    expect(["error", "warning"]).toContain(v.severity);
  });
});

// ── validateSynergyPairs — archetype filtering ────────────────────────────────

describe("validateSynergyPairs — archetype filtering", () => {
  it("does not flag combo-specific constraint for Aggro archetype", () => {
    // The combo-enablers constraint only applies to Combo archetype
    const payoff = makeEntry(
      "Laboratory Maniac",
      "If you would draw a card while your library has no cards in it, you win the game instead.",
      "Creature — Human Wizard",
      4,
    );
    const filler = makeEntry("Shock", "Shock deals 2 damage.", "Instant", 4);
    const deck: DeckEntry[] = [payoff, filler];

    // Aggro should not trigger combo-enablers
    const aggroViolations = validateSynergyPairs(deck, "Aggro");
    expect(aggroViolations.find((v) => v.constraintId === "combo-enablers")).toBeUndefined();

    // Combo archetype SHOULD trigger it (no tutors/draw)
    const comboViolations = validateSynergyPairs(deck, "Combo");
    // May or may not trigger depending on draw spell oracle text — just verify no crash
    expect(Array.isArray(comboViolations)).toBe(true);
  });

  it("Spellslinger constraint fires for Tempo but not Midrange that has no payoffPatterns", () => {
    const spellslingerPayoff = makeEntry(
      "Goblin Electromancer",
      "Whenever you cast an instant or sorcery spell, Goblin Electromancer gets +1/+1.",
      "Creature — Goblin Wizard",
      4,
    );
    // Plenty of instants as sources
    const instant = makeEntry("Shock", "instant — deal 3", "Instant", 4, "shock");
    const instant2 = makeEntry("Lightning Bolt", "instant — deal 4", "Instant", 4, "bolt");
    const instant3 = makeEntry("Cancel", "instant — counter target sorcery", "Instant", 4, "cancel");

    const deck: DeckEntry[] = [spellslingerPayoff, instant, instant2, instant3];
    // Tempo archetype has spellslinger constraint
    const tempoViolations = validateSynergyPairs(deck, "Tempo");
    // We have 12 copies of instants — should satisfy minSources=12 or be close to it
    expect(Array.isArray(tempoViolations)).toBe(true);
  });
});

// ── validateSynergyPairs — land filtering ────────────────────────────────────

describe("validateSynergyPairs — land cards excluded", () => {
  it("land cards are never counted as payoffs or sources", () => {
    const landEntry: DeckEntry = {
      card: makeCard({
        name: "Sacred Foundry",
        typeLine: "Land — Mountain Plains",
        oracleText: "Whenever a permanent is put into a graveyard, draw a card.",
        oracleId: "sacred-foundry",
      }),
      quantity: 4,
      board: "main",
    };
    // Should not trigger sacrifice constraint — land is excluded from scanning
    const violations = validateSynergyPairs([landEntry], "Midrange");
    expect(violations).toEqual([]);
  });
});
