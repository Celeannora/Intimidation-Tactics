import { describe, expect, it } from "vitest";
import type { CardScoreContribution } from "../../generator/types";
import type { SeedSynergyGraph, SynergyGraphEdge } from "../synergyGraph";
import { buildCardBreakdown, buildCardBreakdowns, topSynergyPairs } from "../reasoningView";

function makeScore(overrides: Partial<CardScoreContribution> & { oracleId: string; name: string }): CardScoreContribution {
  return {
    quantity: 1,
    board: "main",
    perCopyScore: 0,
    contribution: 0,
    roleMultiplier: 1,
    powerScore: 0,
    rolePowerContribution: 0,
    colorAffinity: 0,
    synergyScore: 0,
    synergyContribution: 0,
    directionalScore: 0,
    directionalContribution: 0,
    signalScore: 0,
    signalContribution: 0,
    focusBonus: 0,
    focusCardBonus: 0,
    tribalBonus: 0,
    cmcPenalty: 0,
    pricePenalty: 0,
    ...overrides,
  };
}

describe("buildCardBreakdown", () => {
  it("labels non-zero factors and orders them by magnitude", () => {
    const b = buildCardBreakdown(
      makeScore({
        oracleId: "x",
        name: "Test Card",
        quantity: 2,
        perCopyScore: 30,
        contribution: 60,
        rolePowerContribution: 12,
        synergyContribution: 18,
        directionalContribution: 3,
        signalContribution: 0,
      }),
    );
    expect(b.name).toBe("Test Card");
    expect(b.total).toBe(60);
    expect(b.perCopy).toBe(30);
    // Ordered by absolute magnitude: synergy(18) > role(12) > directional(3).
    expect(b.factors.map((f) => f.label)).toEqual(["Synergy", "Role & power", "Directional synergy"]);
    expect(b.factors.every((f) => f.sign === "positive")).toBe(true);
  });

  it("drops zero factors and surfaces penalties as negative", () => {
    const b = buildCardBreakdown(
      makeScore({
        oracleId: "y",
        name: "Pricey Bomb",
        rolePowerContribution: 10,
        cmcPenalty: 4,
        pricePenalty: 6,
      }),
    );
    const price = b.factors.find((f) => f.label === "Price penalty");
    const cmc = b.factors.find((f) => f.label === "Off-curve penalty");
    expect(price).toEqual({ label: "Price penalty", value: -6, sign: "negative" });
    expect(cmc).toEqual({ label: "Off-curve penalty", value: -4, sign: "negative" });
    // No zero-value factor leaks in.
    expect(b.factors.some((f) => f.value === 0)).toBe(false);
    // Largest-magnitude factor first (price -6 beats cmc -4 and role +10 is top).
    expect(b.factors[0].label).toBe("Role & power");
  });
});

describe("buildCardBreakdowns", () => {
  it("keeps only mainboard cards and always includes the worst-penalised card", () => {
    const scores = [
      makeScore({ oracleId: "a", name: "A", contribution: 100 }),
      makeScore({ oracleId: "b", name: "B", contribution: 90 }),
      makeScore({ oracleId: "side", name: "Side", board: "side", contribution: 999 }),
      makeScore({ oracleId: "drag", name: "Drag", contribution: 1, cmcPenalty: 8 }),
    ];
    const out = buildCardBreakdowns(scores, 2);
    const names = out.map((o) => o.name);
    expect(names).not.toContain("Side"); // sideboard excluded
    expect(names).toContain("A");
    expect(names).toContain("B");
    expect(names).toContain("Drag"); // penalised card force-included despite low contribution
  });
});

// ── Synergy pairs ──────────────────────────────────────────────────────────

function edge(overrides: Partial<SynergyGraphEdge>): SynergyGraphEdge {
  return {
    fromOracleId: "f",
    toOracleId: "t",
    fromName: "From",
    toName: "To",
    axis: "tokens",
    kind: "shared-axis",
    explanation: "",
    weight: 0.4,
    ...overrides,
  };
}

function makeGraph(edges: SynergyGraphEdge[]): SeedSynergyGraph {
  return {
    nodes: [],
    edges,
    connectedAxes: [],
    axisSeedCardCounts: {},
    density: 0,
    weightedDensity: 0,
    narrative: "",
  };
}

describe("topSynergyPairs", () => {
  it("returns empty for an undefined or edgeless graph", () => {
    expect(topSynergyPairs(undefined)).toEqual([]);
    expect(topSynergyPairs(makeGraph([]))).toEqual([]);
  });

  it("collapses directed duplicates into one undirected pair at the strongest weight", () => {
    const graph = makeGraph([
      edge({ fromOracleId: "1", toOracleId: "2", fromName: "Bravo", toName: "Alpha", kind: "shared-axis", axis: "tokens", weight: 0.4 }),
      edge({ fromOracleId: "2", toOracleId: "1", fromName: "Alpha", toName: "Bravo", kind: "source-to-payoff", axis: "tokens", weight: 0.8 }),
    ]);
    const pairs = topSynergyPairs(graph);
    expect(pairs).toHaveLength(1);
    expect(pairs[0].weight).toBe(0.8);
    expect(pairs[0].kind).toBe("source-to-payoff");
    // Names presented alphabetically regardless of edge direction.
    expect([pairs[0].a, pairs[0].b]).toEqual(["Alpha", "Bravo"]);
    expect(pairs[0].label).toBe("source → payoff · tokens (0.8)");
  });

  it("ranks pairs by weight descending and respects the limit", () => {
    const graph = makeGraph([
      edge({ fromOracleId: "1", toOracleId: "2", fromName: "A", toName: "B", kind: "shared-axis", weight: 0.4 }),
      edge({ fromOracleId: "3", toOracleId: "4", fromName: "C", toName: "D", kind: "mutual-engine", weight: 1.0 }),
      edge({ fromOracleId: "5", toOracleId: "6", fromName: "E", toName: "F", kind: "source-to-payoff", weight: 0.8 }),
    ]);
    const pairs = topSynergyPairs(graph, 2);
    expect(pairs.map((p) => p.weight)).toEqual([1.0, 0.8]);
    expect(pairs[0].kind).toBe("mutual-engine");
  });
});
