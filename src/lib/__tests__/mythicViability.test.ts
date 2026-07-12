/**
 * mythicViability.test.ts
 *
 * Unit tests for the two-track viability scorer (issue #5).
 * Track 1 (structural) is measurable from the decklist; Track 2 (competitive)
 * is grounded in a mocked live win-rate dataset. Uses in-memory DeckEntry
 * mocks — no real Scryfall data needed.
 */

import { describe, it, expect } from "vitest";
import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";
import type { LiveWinRateDataset } from "../meta/liveWinRate";
import {
  computeStructuralSoundness,
  resolveCompetitiveStrength,
  computeMythicViability,
  fourOfDensityScore,
} from "../mythicViability";

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
    priceUsd: 0.1,
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

function makeEntry(overrides: Partial<CardRecord> & { quantity?: number; board?: "main" | "side" }): DeckEntry {
  const { quantity = 4, board = "main", ...cardOverrides } = overrides;
  return { card: makeCard(cardOverrides), quantity, board };
}

function makeLand(name: string, qty: number, colorIdentity = '["W"]'): DeckEntry {
  return makeEntry({
    name,
    typeLine: "Basic Land — Plains",
    cmc: 0,
    oracleText: "{T}: Add {W}.",
    colorIdentityJson: colorIdentity,
    quantity: qty,
    keywordsJson: "[]",
  });
}

function make60CardDeck(): DeckEntry[] {
  return [
    makeEntry({ name: "Creature A", cmc: 2, quantity: 4, oracleId: "c-a" }),
    makeEntry({ name: "Creature B", cmc: 2, quantity: 4, oracleId: "c-b" }),
    makeEntry({ name: "Creature C", cmc: 2, quantity: 4, oracleId: "c-c" }),
    makeEntry({ name: "Creature D", cmc: 2, quantity: 4, oracleId: "c-d" }),
    makeEntry({ name: "Kill Spell", cmc: 2, oracleText: "Destroy target creature.", quantity: 4, oracleId: "kill-1" }),
    makeEntry({ name: "Kill Spell 2", cmc: 3, oracleText: "Exile target creature.", quantity: 4, oracleId: "kill-2" }),
    makeEntry({ name: "Draw Spell", cmc: 2, oracleText: "Draw two cards.", quantity: 4, oracleId: "draw-1" }),
    makeEntry({ name: "Ramp Spell", cmc: 2, oracleText: "Add {G}.", quantity: 4, oracleId: "ramp-1" }),
    makeEntry({ name: "Misc A", cmc: 3, quantity: 4, oracleId: "misc-a" }),
    makeLand("Plains", 24),
  ];
}

function makeDataset(overrides?: Partial<LiveWinRateDataset>): LiveWinRateDataset {
  return {
    format: "standard",
    environment: "ladder",
    source: "mtga.untapped.gg",
    lastUpdated: Date.now(),
    archetypes: [
      { id: "azorius-control", name: "Azorius Control", colors: ["W", "U"], macro: "Control", winRate: 53.2, playRate: 12, sampleSize: 8000, confidenceInterval: [52.1, 54.3] },
      { id: "mono-red-aggro", name: "Mono-Red Aggro", colors: ["R"], macro: "Aggro", winRate: 55.6, playRate: 18, sampleSize: 12000, confidenceInterval: [54.8, 56.4] },
      { id: "golgari-midrange", name: "Golgari Midrange", colors: ["B", "G"], macro: "Midrange", winRate: 51.0, playRate: 9, sampleSize: 6000 },
    ],
    ...overrides,
  };
}

// ── fourOfDensityScore (old Priority 7c cap fix) ──────────────────────────────

describe("fourOfDensityScore", () => {
  it("uses fourOfCount × 12.5 (does NOT saturate at 5 four-ofs)", () => {
    const fiveFourOfs: DeckEntry[] = Array.from({ length: 5 }, (_, i) =>
      makeEntry({ name: `X${i}`, oracleId: `x-${i}`, quantity: 4 }),
    );
    // Old cap-at-5 gave 100 here; the fixed formula gives 62.5.
    expect(fourOfDensityScore(fiveFourOfs)).toBeCloseTo(62.5, 5);
  });

  it("caps at 8 four-ofs (=100)", () => {
    const nineFourOfs: DeckEntry[] = Array.from({ length: 9 }, (_, i) =>
      makeEntry({ name: `X${i}`, oracleId: `x-${i}`, quantity: 4 }),
    );
    expect(fourOfDensityScore(nineFourOfs)).toBe(100);
  });
});

// ── computeStructuralSoundness (Track 1) ──────────────────────────────────────

describe("computeStructuralSoundness", () => {
  it("empty deck → all sub-scores 0", () => {
    const s = computeStructuralSoundness([]);
    expect(s.score).toBe(0);
    expect(s.manaBase).toBe(0);
    expect(s.synergyDensity).toBe(0);
  });

  it("all sub-scores are in [0, 100] and finite", () => {
    const s = computeStructuralSoundness(make60CardDeck());
    for (const v of [s.score, s.manaBase, s.curve, s.landRatio, s.fourOfDensity, s.synergyDensity]) {
      expect(Number.isFinite(v)).toBe(true);
      expect(v).toBeGreaterThanOrEqual(0);
      expect(v).toBeLessThanOrEqual(100);
    }
  });

  it("wires in mana-base coverage (Frank Karsten) as a real sub-score", () => {
    const s = computeStructuralSoundness(make60CardDeck());
    // A mono-white deck with 24 white sources should be well covered.
    expect(s.manaBase).toBeGreaterThan(0);
    expect(s.notes.some((n) => /Mana base/.test(n))).toBe(true);
  });

  it("well-built deck outscores an empty deck", () => {
    expect(computeStructuralSoundness(make60CardDeck()).score).toBeGreaterThan(
      computeStructuralSoundness([]).score,
    );
  });
});

// ── resolveCompetitiveStrength (Track 2) ──────────────────────────────────────

describe("resolveCompetitiveStrength", () => {
  it("returns 'data-not-loaded' for a supported format with no dataset", () => {
    const c = resolveCompetitiveStrength("Control", ["W", "U"], null, "standard");
    expect(c.matched).toBe(false);
    expect(c.reason).toBe("data-not-loaded");
    expect(c.winRate).toBeUndefined();
  });

  it("returns 'format-unsupported' for a format Untapped doesn't cover", () => {
    const c = resolveCompetitiveStrength("Control", ["W", "U"], null, "modern");
    expect(c.matched).toBe(false);
    expect(c.reason).toBe("format-unsupported");
  });

  it("matches a known archetype and surfaces the REAL win rate + interval", () => {
    const c = resolveCompetitiveStrength("Control", ["W", "U"], makeDataset(), "standard");
    expect(c.matched).toBe(true);
    expect(c.sourceArchetype).toBe("Azorius Control");
    expect(c.winRate).toBe(53.2);
    expect(c.confidenceInterval).toEqual([52.1, 54.3]);
    expect(c.sampleSize).toBe(8000);
    expect(c.source).toBe("mtga.untapped.gg");
  });

  it("does NOT synthesize a percentage for a novel/homebrew deck (no market data)", () => {
    // 5-colour Unknown pile — should match nothing.
    const c = resolveCompetitiveStrength("Unknown", ["W", "U", "B", "R", "G"], makeDataset(), "standard");
    expect(c.matched).toBe(false);
    expect(c.reason).toBe("no-market-data");
    expect(c.winRate).toBeUndefined();
    expect(c.confidenceInterval).toBeUndefined();
    // But it still carries provenance/timestamp of the dataset it was checked against.
    expect(c.lastUpdated).toBeGreaterThan(0);
  });
});

// ── computeMythicViability (two-track composite) ──────────────────────────────

describe("computeMythicViability", () => {
  it("returns the two-track shape (no blended composite / label)", () => {
    const report = computeMythicViability(make60CardDeck(), "Midrange");
    expect(report).toHaveProperty("structural");
    expect(report).toHaveProperty("competitive");
    expect(report).not.toHaveProperty("score");
    expect(report).not.toHaveProperty("label");
    expect(report).not.toHaveProperty("winRateEstimate");
  });

  it("competitive track is unmatched when no dataset is provided", () => {
    const report = computeMythicViability(make60CardDeck(), "Midrange", { format: "standard" });
    expect(report.competitive.matched).toBe(false);
  });

  it("competitive track uses real data when a matching dataset is provided", () => {
    const report = computeMythicViability(make60CardDeck(), "Aggro", {
      colors: ["R"],
      format: "standard",
      liveWinRate: makeDataset(),
    });
    expect(report.competitive.matched).toBe(true);
    expect(report.competitive.winRate).toBe(55.6);
  });

  it("empty deck → structural 0 and unmatched competitive (never a fake number)", () => {
    const report = computeMythicViability([], "Aggro", { format: "standard", liveWinRate: makeDataset() });
    expect(report.structural.score).toBe(0);
    // Empty deck has no colours → cannot match a real archetype.
    expect(report.competitive.winRate).toBeUndefined();
  });

  it("the whole report serializes to JSON round-trip without a synthesized WR", () => {
    const report = computeMythicViability(make60CardDeck(), "Unknown", {
      colors: ["W", "U", "B", "R", "G"],
      format: "standard",
      liveWinRate: makeDataset(),
    });
    const round = JSON.parse(JSON.stringify(report)) as typeof report;
    expect(round.competitive.matched).toBe(false);
    expect(round.competitive.reason).toBe("no-market-data");
    expect("winRate" in round.competitive).toBe(false);
    expect(Number.isFinite(round.structural.score)).toBe(true);
  });
});
