/**
 * synergyGraph.weighted.test.ts
 *
 * Unit tests for weighted synergy edges and weightedDensity (Priority 10).
 * Verifies per-kind edge weights (mutual-engine=1.0, source-to-payoff=0.8,
 * shared-axis=0.4) and the weightedDensity aggregate.
 */

import { describe, it, expect, beforeEach } from "vitest";
import {
  buildSeedSynergyGraph,
  clearSynergyGraphCache,
  formatSynergyGraphForPrompt,
  type SynergyEdgeKind,
} from "../analysis/synergyGraph";
import type { CardRecord } from "../types";

function makeCard(overrides: Partial<CardRecord> & { name: string }): CardRecord {
  const { name, ...rest } = overrides;
  return {
    id: name, oracleId: name, name,
    lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{1}{B}", cmc: 2,
    colorsJson: JSON.stringify(["B"]),
    colorIdentityJson: JSON.stringify(["B"]),
    typeLine: "Creature — Human",
    oracleText: "",
    keywordsJson: "[]",
    power: "2", toughness: "2", loyalty: null, producedManaJson: "[]",
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: "legal" }),
    setCode: "TST", setName: "Test Set", setType: null, collectorNumber: null, rarity: "common",
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null,
    searchText: name.toLowerCase(), importedAt: "2026-01-01T00:00:00.000Z",
    ...rest,
  } as CardRecord;
}

const EXPECTED_WEIGHT: Record<SynergyEdgeKind, number> = {
  "mutual-engine": 1.0,
  "source-to-payoff": 0.8,
  "shared-axis": 0.4,
};

beforeEach(() => {
  clearSynergyGraphCache();
});

describe("weighted synergy edges", () => {
  it("assigns each edge a weight matching its kind", () => {
    const tokenSource = makeCard({
      name: "Token Maker", oracleId: "token-maker",
      oracleText: "Create a 1/1 white Soldier creature token.",
    });
    const tokenPayoff = makeCard({
      name: "Token Payoff", oracleId: "token-payoff",
      oracleText: "Whenever you create a token, you gain 1 life.",
    });
    const graph = buildSeedSynergyGraph([tokenSource, tokenPayoff]);

    expect(graph.edges.length).toBeGreaterThan(0);
    for (const edge of graph.edges) {
      expect(edge.weight).toBe(EXPECTED_WEIGHT[edge.kind]);
    }
  });

  it("produces a 1.0-weight edge for a mutual-engine relationship", () => {
    const engine = (id: string) =>
      makeCard({
        name: id, oracleId: id,
        oracleText: "Sacrifice a creature: Draw a card. Whenever you sacrifice a creature, you gain 1 life.",
      });
    const graph = buildSeedSynergyGraph([engine("engine-a"), engine("engine-b")]);

    const mutual = graph.edges.filter((e) => e.kind === "mutual-engine");
    expect(mutual.length).toBeGreaterThan(0);
    for (const e of mutual) expect(e.weight).toBe(1.0);
  });
});

describe("weightedDensity", () => {
  it("equals sum(edge weights) / possible directed edges", () => {
    const tokenSource = makeCard({
      name: "Token Maker", oracleId: "token-maker",
      oracleText: "Create a 1/1 white Soldier creature token.",
    });
    const tokenPayoff = makeCard({
      name: "Token Payoff", oracleId: "token-payoff",
      oracleText: "Whenever you create a token, you gain 1 life.",
    });
    const graph = buildSeedSynergyGraph([tokenSource, tokenPayoff]);

    const n = graph.nodes.length;
    const possible = n * (n - 1);
    const totalWeight = graph.edges.reduce((s, e) => s + e.weight, 0);
    const expected = Math.round((totalWeight / possible) * 100) / 100;
    expect(graph.weightedDensity).toBe(expected);
  });

  it("discounts weak shared-axis links below raw density", () => {
    // Source→payoff (0.8) one way + shared-axis (0.4) the other way => 2 edges
    // over 2 possible directed edges: density 1.0 but weightedDensity 0.6.
    const tokenSource = makeCard({
      name: "Token Maker", oracleId: "token-maker",
      oracleText: "Create a 1/1 white Soldier creature token.",
    });
    const tokenPayoff = makeCard({
      name: "Token Payoff", oracleId: "token-payoff",
      oracleText: "Whenever you create a token, you gain 1 life.",
    });
    const graph = buildSeedSynergyGraph([tokenSource, tokenPayoff]);

    expect(graph.weightedDensity).toBeLessThan(graph.density);
    expect(graph.weightedDensity).toBeGreaterThan(0);
  });

  it("is 0 for empty or single-card seed sets", () => {
    expect(buildSeedSynergyGraph([]).weightedDensity).toBe(0);
    clearSynergyGraphCache();
    const solo = buildSeedSynergyGraph([makeCard({ name: "Solo", oracleId: "solo" })]);
    expect(solo.weightedDensity).toBe(0);
  });
});

describe("formatSynergyGraphForPrompt — weighted density surfaced", () => {
  it("includes weighted density in prompt output and constraints", () => {
    const tokenSource = makeCard({
      name: "Token Maker", oracleId: "token-maker",
      oracleText: "Create a 1/1 white Soldier creature token.",
    });
    const tokenPayoff = makeCard({
      name: "Token Payoff", oracleId: "token-payoff",
      oracleText: "Whenever you create a token, you gain 1 life.",
    });
    const graph = buildSeedSynergyGraph([tokenSource, tokenPayoff]);
    const prompt = formatSynergyGraphForPrompt(graph);

    expect(prompt).toContain("weighted");
    expect(prompt).toContain("weightedDensityScore");
  });
});
