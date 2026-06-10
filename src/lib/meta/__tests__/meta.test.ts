import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import type { DeckEntry } from "../../legality";
import { generateDeck } from "../../generator/generator";
import type { GenerateOptions } from "../../generator/types";
import {
  BUNDLED_STANDARD_SNAPSHOT,
  validateSnapshot,
  fetchRemoteSnapshot,
  getMetaSnapshot,
} from "../snapshot";
import { analyzeCounters } from "../counterAnalysis";
import type { MetaSnapshot, CounterPosture } from "../types";

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  colors: ManaColor[] = []
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: colors.length ? "{1}{U}" : "{1}",
    cmc: 2,
    colorsJson: JSON.stringify(colors),
    colorIdentityJson: JSON.stringify(colors),
    typeLine,
    oracleText,
    keywordsJson: "[]",
    power: typeLine.includes("Creature") ? "2" : null,
    toughness: typeLine.includes("Creature") ? "2" : null,
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
    searchText: `${name} ${oracleText} ${typeLine}`,
    importedAt: "",
  } as CardRecord;
}

function makeBasic(name: string): CardRecord {
  return { ...makeCard(name, "", "Basic Land", []), manaCost: "", cmc: 0 } as CardRecord;
}

describe("meta snapshot loader", () => {
  it("ships a valid bundled June 2026 Standard snapshot", () => {
    expect(BUNDLED_STANDARD_SNAPSHOT.schemaVersion).toBe(1);
    expect(BUNDLED_STANDARD_SNAPSHOT.format).toBe("standard");
    expect(BUNDLED_STANDARD_SNAPSHOT.archetypes.length).toBeGreaterThan(0);
    const result = validateSnapshot(BUNDLED_STANDARD_SNAPSHOT);
    expect(result.valid).toBe(true);
    expect(result.errors).toEqual([]);
  });

  it("includes the expected headline archetypes with sane shares", () => {
    const ids = BUNDLED_STANDARD_SNAPSHOT.archetypes.map((a) => a.id);
    expect(ids).toContain("izzet-prowess");
    expect(ids).toContain("mono-green-landfall");
    const prowess = BUNDLED_STANDARD_SNAPSHOT.archetypes.find((a) => a.id === "izzet-prowess");
    expect(prowess?.metaShare).toBeGreaterThan(0);
    expect(prowess?.keyCards.length).toBeGreaterThan(0);
  });

  it("rejects an unsupported schema version", () => {
    const bad = { ...BUNDLED_STANDARD_SNAPSHOT, schemaVersion: 2 } as unknown as MetaSnapshot;
    const result = validateSnapshot(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("schemaVersion"))).toBe(true);
  });

  it("rejects a snapshot whose shares sum above the bound", () => {
    const bad: MetaSnapshot = {
      ...BUNDLED_STANDARD_SNAPSHOT,
      archetypes: [
        { ...BUNDLED_STANDARD_SNAPSHOT.archetypes[0], id: "a", metaShare: 0.6 },
        { ...BUNDLED_STANDARD_SNAPSHOT.archetypes[0], id: "b", metaShare: 0.6 },
      ],
    };
    const result = validateSnapshot(bad);
    expect(result.valid).toBe(false);
    expect(result.errors.some((e) => e.includes("metaShare"))).toBe(true);
  });

  it("fetchRemoteSnapshot is a stub returning null", async () => {
    expect(await fetchRemoteSnapshot("https://example.invalid/meta.json")).toBeNull();
  });

  it("getMetaSnapshot returns the bundled snapshot when no remote is given", async () => {
    expect(await getMetaSnapshot()).toBe(BUNDLED_STANDARD_SNAPSHOT);
  });

  it("getMetaSnapshot falls back to bundled when remote yields nothing", async () => {
    expect(await getMetaSnapshot("https://example.invalid/meta.json")).toBe(BUNDLED_STANDARD_SNAPSHOT);
  });
});

describe("analyzeCounters", () => {
  const deck: DeckEntry[] = [
    { card: makeCard("Goblin Beater", "", "Creature — Goblin", ["R"]), quantity: 4, board: "main" },
    { card: makeCard("Burn Spell", "Deal 3 damage to any target.", "Instant", ["R"]), quantity: 4, board: "main" },
  ];
  const pool: CardRecord[] = [
    makeCard("Disenchant", "Destroy target artifact or enchantment.", "Instant", ["W"]),
    makeCard("Negate", "Counter target noncreature spell.", "Instant", ["U"]),
    makeCard("Duress", "Target player discards a card.", "Sorcery", ["B"]),
  ];

  it("returns a structurally valid CounterReport over the bundled snapshot", () => {
    const report = analyzeCounters(deck, pool, BUNDLED_STANDARD_SNAPSHOT);
    expect(typeof report.deckSummary).toBe("string");
    expect(report.perArchetype).toHaveLength(BUNDLED_STANDARD_SNAPSHOT.archetypes.length);

    const validPostures: CounterPosture[] = ["favored", "even", "unfavored", "unknown"];
    for (const entry of report.perArchetype) {
      expect(entry.archetype.id).toBeTruthy();
      expect(validPostures).toContain(entry.estimatedPosture);
      expect(Array.isArray(entry.suggestions)).toBe(true);
      for (const s of entry.suggestions) {
        expect(s.targetArchetypeId).toBe(entry.archetype.id);
        expect(s.slot === "main" || s.slot === "side").toBe(true);
        expect(s.card).toBeTruthy();
      }
    }
  });

  it("emits no suggestions for the aggregate 'other' bucket", () => {
    const report = analyzeCounters(deck, pool, BUNDLED_STANDARD_SNAPSHOT);
    const other = report.perArchetype.find((e) => e.archetype.id === "other");
    expect(other?.suggestions).toEqual([]);
    expect(other?.estimatedPosture).toBe("unknown");
  });

  it("caps suggestions per archetype at the requested limit", () => {
    const report = analyzeCounters(deck, pool, BUNDLED_STANDARD_SNAPSHOT, { suggestionsPerArchetype: 1 });
    for (const entry of report.perArchetype) {
      expect(entry.suggestions.length).toBeLessThanOrEqual(1);
    }
  });
});

describe("generator metaTargets hook", () => {
  it("accepts metaTargets without changing the generated deck", () => {
    const cards = [
      ...Array.from({ length: 24 }, (_, i) =>
        makeCard(`Beater ${i + 1}`, "", i % 2 === 0 ? "Creature — Test" : "Instant")
      ),
      makeBasic("Wastes"),
    ];
    const base: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const without = generateDeck(base, cards);
    const withTargets = generateDeck({ ...base, metaTargets: ["izzet-prowess", "mono-green-landfall"] }, cards);

    const norm = (r: typeof without) =>
      r.entries
        .map((e) => `${e.card.oracleId}:${e.quantity}:${e.board}`)
        .sort()
        .join("|");
    expect(norm(withTargets)).toBe(norm(without));

    expect(withTargets.diagnostics.reasoning.some((line) => line.includes("Meta targets (no-op)"))).toBe(true);
    expect(without.diagnostics.reasoning.some((line) => line.includes("Meta targets"))).toBe(false);
  });
});
