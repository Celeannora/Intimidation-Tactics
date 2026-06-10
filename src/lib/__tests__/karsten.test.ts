import { describe, it, expect } from "vitest";
import { karstenSourcesNeeded, naturalTurn } from "../karsten";
import {
  countLandSources,
  landSourceWeight,
  MDFC_UNTAPPED_WEIGHT,
  MDFC_TAPPED_WEIGHT,
} from "../landSources";
import { recommendColorSources } from "../manaBase";
import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";

function makeCard(overrides: Partial<CardRecord> & { cmc: number }): CardRecord {
  return {
    id: overrides.id ?? "id-" + Math.random(),
    oracleId: overrides.oracleId ?? "oid-" + Math.random(),
    name: overrides.name ?? "Test Card",
    lang: "en",
    layout: overrides.layout ?? "normal",
    cardFacesJson: overrides.cardFacesJson ?? null,
    manaCost: overrides.manaCost ?? "{1}",
    colorsJson: "[]",
    colorIdentityJson: overrides.colorIdentityJson ?? "[]",
    typeLine: overrides.typeLine ?? "Creature",
    oracleText: overrides.oracleText ?? null,
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: overrides.producedManaJson ?? "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
    setCode: "tst",
    setName: "Test",
    setType: "expansion",
    collectorNumber: "1",
    rarity: "common",
    imageNormal: null,
    priceUsd: null,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: null,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "",
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

function entry(card: CardRecord, quantity: number): DeckEntry {
  return { card, quantity, board: "main" };
}

// ── Karsten 2022 table (60-card) ───────────────────────────────────────────
describe("karstenSourcesNeeded — published 60-card figures", () => {
  it("single pip on turn 1 needs 14 sources", () => {
    expect(karstenSourcesNeeded(1, 1)).toBe(14);
  });

  it("single pip relaxes on later turns (turn 5 -> 10)", () => {
    expect(karstenSourcesNeeded(1, 5)).toBe(10);
  });

  it("double pip on turn 2 needs 20 sources", () => {
    expect(karstenSourcesNeeded(2, 2)).toBe(20);
  });

  it("double pip on turn 3 needs 18 sources", () => {
    expect(karstenSourcesNeeded(2, 3)).toBe(18);
  });

  it("triple pip on turn 3 needs 23 sources", () => {
    expect(karstenSourcesNeeded(3, 3)).toBe(23);
  });

  it("rounds half-pips (hybrid 0.5) up to a whole pip", () => {
    // 0.5 -> ceil 1 pip
    expect(karstenSourcesNeeded(0.5, 1)).toBe(14);
  });

  it("clamps 4+ pips to the triple-pip row", () => {
    expect(karstenSourcesNeeded(4, 3)).toBe(karstenSourcesNeeded(3, 3));
  });

  it("clamps turns below/above the row range", () => {
    // double-pip row starts at turn 2; turn 1 clamps up to turn 2's value
    expect(karstenSourcesNeeded(2, 1)).toBe(20);
    // beyond turn 8 clamps to turn 8's value
    expect(karstenSourcesNeeded(1, 99)).toBe(karstenSourcesNeeded(1, 8));
  });

  it("zero/negative pips need no sources", () => {
    expect(karstenSourcesNeeded(0, 3)).toBe(0);
  });
});

describe("naturalTurn", () => {
  it("is the later of mana value and pip count", () => {
    // {W}{W}{W} at MV 3 -> turn 3
    expect(naturalTurn(3, 3)).toBe(3);
    // {3}{B}{B} at MV 5 -> turn 5 (MV dominates)
    expect(naturalTurn(5, 2)).toBe(5);
    // cheap-generic triple pip can't be cast before turn 3
    expect(naturalTurn(3, 3)).toBeGreaterThanOrEqual(3);
  });
});

// ── Counting actual sources from typed lands / MDFCs ─────────────────────────
describe("countLandSources", () => {
  it("counts basics as a full source for their color", () => {
    const island = makeCard({
      cmc: 0,
      name: "Island",
      typeLine: "Basic Land — Island",
      producedManaJson: '["U"]',
    });
    const sources = countLandSources([entry(island, 18)]);
    expect(sources.U).toBe(18);
    expect(sources.W).toBe(0);
  });

  it("counts a typed dual as a source for BOTH colors", () => {
    const dual = makeCard({
      cmc: 0,
      name: "Hallowed Fountain",
      typeLine: "Land — Plains Island",
      producedManaJson: '["W","U"]',
      colorIdentityJson: '["W","U"]',
    });
    const sources = countLandSources([entry(dual, 4)]);
    expect(sources.W).toBe(4);
    expect(sources.U).toBe(4);
  });

  it("counts a triome as a source for all three colors", () => {
    const triome = makeCard({
      cmc: 0,
      name: "Triome",
      typeLine: "Land — Plains Island Swamp",
      producedManaJson: '["W","U","B"]',
    });
    const sources = countLandSources([entry(triome, 4)]);
    expect(sources.W).toBe(4);
    expect(sources.U).toBe(4);
    expect(sources.B).toBe(4);
  });

  it("weights an untapped MDFC land face at 0.74", () => {
    const mdfc = makeCard({
      cmc: 1,
      name: "Spell // Land MDFC",
      layout: "modal_dfc",
      typeLine: "Instant",
      manaCost: "{U}",
      cardFacesJson: JSON.stringify([
        { type_line: "Instant", oracle_text: "Draw a card." },
        { type_line: "Land", oracle_text: "{T}: Add {U}." },
      ]),
      producedManaJson: '["U"]',
    });
    expect(landSourceWeight(mdfc)).toBeCloseTo(MDFC_UNTAPPED_WEIGHT);
    const sources = countLandSources([entry(mdfc, 4)]);
    expect(sources.U).toBeCloseTo(4 * MDFC_UNTAPPED_WEIGHT);
  });

  it("weights a tapped MDFC land face at 0.38", () => {
    const mdfc = makeCard({
      cmc: 2,
      name: "Tapped MDFC",
      layout: "modal_dfc",
      typeLine: "Sorcery",
      manaCost: "{1}{B}",
      cardFacesJson: JSON.stringify([
        { type_line: "Sorcery", oracle_text: "Destroy target creature." },
        { type_line: "Land", oracle_text: "This land enters tapped. {T}: Add {B}." },
      ]),
      producedManaJson: '["B"]',
    });
    expect(landSourceWeight(mdfc)).toBeCloseTo(MDFC_TAPPED_WEIGHT);
  });

  it("ignores pure nonland spells", () => {
    const spell = makeCard({ cmc: 2, typeLine: "Creature", producedManaJson: '["G"]' });
    expect(landSourceWeight(spell)).toBe(0);
  });
});

// ── recommendColorSources — Karsten-driven, actual-source-aware ──────────────
describe("recommendColorSources", () => {
  // A WU control deck running 18 Islands (18 U sources) whose hardest U card is
  // a single-pip {U} counterspell on turn 2 must NOT be flagged undersourced —
  // this is the exact false flag from the gap analysis.
  it("does NOT flag a WU deck with 18 U sources for a single U pip", () => {
    const entries: DeckEntry[] = [
      entry(makeCard({ cmc: 0, name: "Island", typeLine: "Basic Land — Island", producedManaJson: '["U"]' }), 18),
      entry(makeCard({ cmc: 0, name: "Plains", typeLine: "Basic Land — Plains", producedManaJson: '["W"]' }), 6),
      // single U pip, castable turn 2
      entry(makeCard({ cmc: 2, name: "Counter", typeLine: "Instant", manaCost: "{1}{U}" }), 4),
      entry(makeCard({ cmc: 2, name: "Removal", typeLine: "Instant", manaCost: "{1}{W}" }), 4),
    ];
    const recs = recommendColorSources(entries, 24);
    const u = recs.find(r => r.color === "U")!;
    expect(u.requiredPips).toBe(1);
    expect(u.recommendedSources).toBe(karstenSourcesNeeded(1, 2)); // 13
    expect(u.actualSources).toBe(18);
    expect(u.criticallyUndersourced).toBe(false);
  });

  // A double-pip card (WW at MV3) requires ~18 sources; running only 12 W
  // sources must be flagged.
  it("flags a double-pip WW@3 card when only 12 W sources are present", () => {
    const entries: DeckEntry[] = [
      entry(makeCard({ cmc: 0, name: "Plains", typeLine: "Basic Land — Plains", producedManaJson: '["W"]' }), 12),
      entry(makeCard({ cmc: 0, name: "Island", typeLine: "Basic Land — Island", producedManaJson: '["U"]' }), 12),
      entry(makeCard({ cmc: 3, name: "WW Three", typeLine: "Creature", manaCost: "{1}{W}{W}" }), 4),
    ];
    const recs = recommendColorSources(entries, 24);
    const w = recs.find(r => r.color === "W")!;
    expect(w.requiredPips).toBe(2);
    expect(w.requiredByTurn).toBe(3);
    expect(w.recommendedSources).toBe(18);
    expect(w.actualSources).toBe(12);
    expect(w.criticallyUndersourced).toBe(true);
  });

  it("counts a typed dual toward both colors' source totals", () => {
    const entries: DeckEntry[] = [
      entry(makeCard({ cmc: 0, name: "WU Dual", typeLine: "Land — Plains Island", producedManaJson: '["W","U"]' }), 4),
      entry(makeCard({ cmc: 0, name: "Plains", typeLine: "Basic Land — Plains", producedManaJson: '["W"]' }), 10),
      entry(makeCard({ cmc: 0, name: "Island", typeLine: "Basic Land — Island", producedManaJson: '["U"]' }), 10),
      entry(makeCard({ cmc: 2, name: "WW", typeLine: "Creature", manaCost: "{W}{W}" }), 4),
      entry(makeCard({ cmc: 2, name: "UU", typeLine: "Creature", manaCost: "{U}{U}" }), 4),
    ];
    const recs = recommendColorSources(entries, 24);
    const w = recs.find(r => r.color === "W")!;
    const u = recs.find(r => r.color === "U")!;
    // 10 basics + 4 duals = 14 each
    expect(w.actualSources).toBe(14);
    expect(u.actualSources).toBe(14);
  });

  it("derives the requirement from the hardest card of each color", () => {
    // U has both a 1-pip 2-drop and a 2-pip 2-drop -> hardest is 2 pips @ turn 2
    const entries: DeckEntry[] = [
      entry(makeCard({ cmc: 0, name: "Island", typeLine: "Basic Land — Island", producedManaJson: '["U"]' }), 17),
      entry(makeCard({ cmc: 2, name: "soft", typeLine: "Instant", manaCost: "{1}{U}" }), 4),
      entry(makeCard({ cmc: 2, name: "hard", typeLine: "Creature", manaCost: "{U}{U}" }), 4),
    ];
    const recs = recommendColorSources(entries, 24);
    const u = recs.find(r => r.color === "U")!;
    expect(u.requiredPips).toBe(2);
    expect(u.requiredByTurn).toBe(2);
    expect(u.recommendedSources).toBe(20);
  });
});
