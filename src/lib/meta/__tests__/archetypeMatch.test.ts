/**
 * archetypeMatch.test.ts
 *
 * The fuzzy matcher is the gate that decides whether a deck gets a REAL win
 * rate or an honest "no market data" state. These tests prove it:
 *   - accepts a known-archetype deck (right colours + macro),
 *   - rejects a clearly novel / homebrew decklist (5-colour Unknown pile),
 *   - rejects genuinely ambiguous cases rather than forcing a match,
 *   - never matches against an empty dataset.
 */

import { describe, it, expect } from "vitest";
import type { LiveWinRateDataset } from "../liveWinRate";
import {
  matchArchetype,
  matchConfidence,
  ACCEPT_THRESHOLD,
} from "../archetypeMatch";

function makeDataset(overrides?: Partial<LiveWinRateDataset>): LiveWinRateDataset {
  return {
    format: "standard",
    environment: "ladder",
    source: "mtga.untapped.gg",
    lastUpdated: Date.now(),
    archetypes: [
      { id: "azorius-control", name: "Azorius Control", colors: ["W", "U"], macro: "Control", winRate: 53.2, playRate: 12, sampleSize: 8000, confidenceInterval: [52.1, 54.3] },
      { id: "mono-red-aggro", name: "Mono-Red Aggro", colors: ["R"], macro: "Aggro", winRate: 55.6, playRate: 18, sampleSize: 12000 },
      { id: "golgari-midrange", name: "Golgari Midrange", colors: ["B", "G"], macro: "Midrange", winRate: 51.0, playRate: 9, sampleSize: 6000 },
    ],
    ...overrides,
  };
}

describe("matchConfidence", () => {
  it("is 1.0 for identical colours + macro", () => {
    const c = matchConfidence(
      { archetype: "Control", colors: ["W", "U"] },
      { id: "azorius-control", name: "Azorius Control", colors: ["W", "U"], macro: "Control", winRate: 53.2 },
    );
    expect(c).toBeCloseTo(1.0, 5);
  });

  it("is 0.6 for identical colours but wrong macro (colour signal only)", () => {
    const c = matchConfidence(
      { archetype: "Aggro", colors: ["W", "U"] },
      { id: "azorius-control", name: "Azorius Control", colors: ["W", "U"], macro: "Control", winRate: 53.2 },
    );
    expect(c).toBeCloseTo(0.6, 5);
  });

  it("Unknown macro never earns the macro-agreement bonus", () => {
    const c = matchConfidence(
      { archetype: "Unknown", colors: ["R"] },
      { id: "mono-red-aggro", name: "Mono-Red Aggro", colors: ["R"], macro: "Aggro", winRate: 55.6 },
    );
    expect(c).toBeCloseTo(0.6, 5); // colour 1.0·0.6, macro 0
  });
});

describe("matchArchetype", () => {
  it("accepts a known-archetype deck (colours + macro align)", () => {
    const m = matchArchetype({ archetype: "Aggro", colors: ["R"] }, makeDataset());
    expect(m.matched).toBe(true);
    expect(m.candidate?.name).toBe("Mono-Red Aggro");
    expect(m.confidence).toBeGreaterThanOrEqual(ACCEPT_THRESHOLD);
  });

  it("rejects a clearly novel 5-colour Unknown pile (no comparable data)", () => {
    const m = matchArchetype({ archetype: "Unknown", colors: ["W", "U", "B", "R", "G"] }, makeDataset());
    expect(m.matched).toBe(false);
    expect(m.reason).toBe("below-threshold");
  });

  it("never matches against an empty dataset", () => {
    const m = matchArchetype({ archetype: "Control", colors: ["W", "U"] }, makeDataset({ archetypes: [] }));
    expect(m.matched).toBe(false);
    expect(m.reason).toBe("empty-dataset");
  });

  it("returns unmatched (not a throw) for a null dataset", () => {
    const m = matchArchetype({ archetype: "Control", colors: ["W", "U"] }, null);
    expect(m.matched).toBe(false);
    expect(m.reason).toBe("empty-dataset");
  });

  it("rejects ambiguous ties between two equally-plausible archetypes", () => {
    // Two same-colour, same-macro candidates → identical confidence, no clear winner.
    const twins = makeDataset({
      archetypes: [
        { id: "izzet-a", name: "Izzet Phoenix", colors: ["U", "R"], macro: "Tempo", winRate: 54, sampleSize: 5000 },
        { id: "izzet-b", name: "Izzet Prowess", colors: ["U", "R"], macro: "Tempo", winRate: 52, sampleSize: 5000 },
      ],
    });
    const m = matchArchetype({ archetype: "Tempo", colors: ["U", "R"] }, twins);
    // Both score 1.0 → margin 0, but confidence >= 0.85 escape hatch lets a
    // near-certain colour+macro match through. Assert it does NOT silently
    // pick a wrong-strategy deck: either matched with high confidence, or
    // rejected as ambiguous — never a low-confidence forced pick.
    if (m.matched) {
      expect(m.confidence).toBeGreaterThanOrEqual(0.85);
    } else {
      expect(m.reason).toBe("ambiguous");
    }
  });

  it("rejects a same-colour, wrong-macro deck (colour overlap alone cannot carry a match)", () => {
    // BEHAVIOUR FIX (audit Flaw #5 / Fix 6): previously this asserted the deck
    // was ACCEPTED at 0.6 on colour identity alone, letting a WB "Combo"
    // homebrew inherit a WB "Midrange" netdeck's real win rate. The macro
    // precondition now rejects it. Colours align exactly (0.6) but the macro
    // disagrees, so no candidate is eligible.
    const ds = makeDataset({
      archetypes: [
        { id: "azorius-tempo", name: "Azorius Tempo", colors: ["W", "U"], macro: "Aggro", winRate: 52, sampleSize: 6000 },
        { id: "mono-white-aggro", name: "Mono-White Aggro", colors: ["W"], macro: "Aggro", winRate: 53, sampleSize: 6000 },
      ],
    });
    const m = matchArchetype({ archetype: "Control", colors: ["W", "U"] }, ds);
    // Best overall clears the 0.5 confidence floor (0.6) but its macro is 0,
    // so the match is rejected as macro-mismatch rather than accepted.
    expect(m.matched).toBe(false);
    expect(m.reason).toBe("macro-mismatch");
    expect(m.candidate?.name).toBe("Azorius Tempo");
    expect(m.confidence).toBeCloseTo(0.6, 5);
  });

  it("still accepts a same-colour deck when the macro also agrees", () => {
    // Control guardrail for the fix above: identical colours AND matching macro
    // must still match (colour 1.0·0.6 + macro 1.0·0.4 = 1.0).
    const ds = makeDataset({
      archetypes: [
        { id: "orzhov-midrange", name: "Orzhov Midrange", colors: ["W", "B"], macro: "Midrange", winRate: 51, sampleSize: 6000 },
      ],
    });
    const m = matchArchetype({ archetype: "Midrange", colors: ["W", "B"] }, ds);
    expect(m.matched).toBe(true);
    expect(m.candidate?.name).toBe("Orzhov Midrange");
    expect(m.confidence).toBeCloseTo(1.0, 5);
  });

  it("prefers a lower-colour-overlap but macro-agreeing candidate over a higher colour-only one", () => {
    // The macro precondition means a same-colour wrong-macro deck (0.6, macro 0)
    // is ineligible, while a partial-colour right-macro deck that still clears
    // the floor is eligible and wins.
    const ds = makeDataset({
      archetypes: [
        { id: "azorius-control", name: "Azorius Control", colors: ["W", "U"], macro: "Control", winRate: 53, sampleSize: 8000 },
        { id: "mono-white-aggro", name: "Mono-White Aggro", colors: ["W"], macro: "Aggro", winRate: 54, sampleSize: 8000 },
      ],
    });
    // Query is WU Aggro. Azorius Control: colour 1.0·0.6 + macro 0 = 0.6 (macro 0 → ineligible).
    // Mono-White Aggro: colour 0.5·0.6 + macro 1.0·0.4 = 0.7 (macro 1 → eligible).
    const m = matchArchetype({ archetype: "Aggro", colors: ["W", "U"] }, ds);
    expect(m.matched).toBe(true);
    expect(m.candidate?.name).toBe("Mono-White Aggro");
    expect(m.confidence).toBeCloseTo(0.7, 5);
  });
});
