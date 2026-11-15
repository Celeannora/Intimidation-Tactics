import { describe, expect, it } from "vitest";
import type { CardScoreContribution } from "../../generator/types";
import type { CardRecord } from "../../types";
import type { SeedSynergyGraph, SynergyGraphEdge } from "../synergyGraph";
import { buildCardBreakdown, buildCardBreakdowns, cardSynergyTags, quickSynergyView, topSynergyPairs } from "../reasoningView";

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
  it("retains small nonzero factors so rounding thresholds cannot break reconciliation", () => {
    const values = [0.01, 0.02, -0.005];
    const b = buildCardBreakdown(makeScore({
      oracleId: "small", name: "Small terms", rolePowerContribution: values[0], compositionBonus: values[1],
      pricePenalty: -values[2], preferCardBonus: 0, broadTagBonus: 0, seedAdjustment: 0,
      perCopyScore: values.reduce((sum, value) => sum + value, 0),
    }));
    expect(b.factors).toHaveLength(3);
    expect(b.factors.reduce((sum, factor) => sum + factor.value, 0)).toBeCloseTo(b.perCopy, 12);
    const legacy = buildCardBreakdown(makeScore({ oracleId: "tiny-legacy", name: "Tiny legacy", perCopyScore: 0.001 }));
    expect(legacy.factors[0]?.value).toBe(0.001);
  });
  it("transparently reconciles legacy scores missing the newer exported terms", () => {
    const b = buildCardBreakdown(makeScore({
      oracleId: "legacy", name: "Legacy", rolePowerContribution: 10, perCopyScore: 13,
    }));
    expect(b.factors.find((f) => f.label === "Legacy unitemized adjustment")).toEqual({
      label: "Legacy unitemized adjustment", value: 3, sign: "positive",
    });
    expect(b.factors.reduce((sum, factor) => sum + factor.value, 0)).toBe(b.perCopy);
  });
  it.each([-5, 7])("shows the explicit seed transformation (%s) rather than deriving a catch-all", (seedAdjustment) => {
    const score = makeScore({
      oracleId: "seed", name: "Seed adjusted", rolePowerContribution: 10,
      preferCardBonus: 0, broadTagBonus: 0, seedAdjustment,
      perCopyScore: 10 + seedAdjustment,
    });
    const b = buildCardBreakdown(score);
    expect(b.factors.find((f) => f.label === "Seed adjustment")?.value).toBe(seedAdjustment);
    expect(b.factors.reduce((sum, factor) => sum + factor.value, 0)).toBe(b.perCopy);
    // Corrupt totals must not be hidden by changing an explicitly exported term.
    const inconsistent = buildCardBreakdown({ ...score, perCopyScore: 999 });
    expect(inconsistent.factors).toEqual(b.factors);
  });
  it("explains every actual additive score term including scenario, combo and preferences", () => {
    const expected = {
      "Role & power": 10, "Directional synergy": 4, Efficiency: 2, Flexibility: 1,
      "Scenario robustness": 3, "Ladder meta": 5, Composition: 6, "Keyword focus": 7,
      "Focus card": 8, "Preferred card": 9, Tribal: 11, "Broad role": 12, Combo: 15,
      "Off-curve penalty": -13, "Price penalty": -14,
    };
    const perCopyScore = Object.values(expected).reduce((sum, value) => sum + value, 0);
    const score = makeScore({
      oracleId: "all-terms", name: "All terms", quantity: 2, perCopyScore, contribution: perCopyScore * 2,
      rolePowerContribution: 10, synergyContribution: 4, directionalContribution: 4, signalContribution: 0.48,
      efficiencyContribution: 2, flexibilityContribution: 1, scenarioRobustnessContribution: 3,
      ladderContribution: 5, compositionBonus: 6, focusBonus: 7, focusCardBonus: 8,
      preferCardBonus: 9, tribalBonus: 11, broadTagBonus: 12, comboContribution: 15,
      seedAdjustment: 0, cmcPenalty: 13, pricePenalty: 14,
    });
    const b = buildCardBreakdown(score);
    expect(Object.fromEntries(b.factors.map((f) => [f.label, f.value]))).toEqual(expected);
    expect(b.factors.reduce((sum, factor) => sum + factor.value, 0)).toBe(perCopyScore);
  });
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
        directionalContribution: 18,
        signalContribution: 5,
      }),
    );
    expect(b.name).toBe("Test Card");
    expect(b.total).toBe(60);
    expect(b.perCopy).toBe(30);
    // Directional is the scored term; synergy is its alias and signal is metadata.
    expect(b.factors.map((f) => f.label)).toEqual(["Directional synergy", "Role & power"]);
    expect(b.factors.reduce((sum, factor) => sum + factor.value, 0)).toBe(b.perCopy);
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

// ── Quick synergy view ──────────────────────────────────────────────────────

function makeCard(name: string, oracleText: string, typeLine = "Creature — Test"): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{G}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
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

describe("quickSynergyView", () => {
  it("returns a zeroed view when the deck has no non-land cards", () => {
    const candidate = makeCard("Token Maker", "Create a 1/1 green Saproling creature token.");
    const view = quickSynergyView(candidate, []);
    expect(view).toEqual({ score: 0, sharedAxes: [], feeds: [], fedBy: [], partnerCount: 0 });

    // A lands-only deck also has no non-land partners.
    const land = makeCard("Forest", "", "Basic Land — Forest");
    expect(quickSynergyView(candidate, [land])).toEqual({ score: 0, sharedAxes: [], feeds: [], fedBy: [], partnerCount: 0 });
  });

  it("surfaces the shared axis and the in-deck payoff a source card feeds", () => {
    const deck = [
      makeCard("Token Maker A", "Create a 1/1 green Saproling creature token.", "Creature — Fungus"),
      makeCard("Token Maker B", "Create a 1/1 white Soldier creature token.", "Creature — Soldier"),
      makeCard("Token Lord", "Tokens you control get +1/+1.", "Enchantment"),
    ];
    const candidate = makeCard("Fresh Token Maker", "Create a 1/1 green Saproling creature token.", "Sorcery");

    const view = quickSynergyView(candidate, deck);
    expect(view.sharedAxes).toContain("tokens");
    // Candidate's token source feeds the deck's token payoff.
    expect(view.feeds).toContain("Token Lord");
    expect(view.partnerCount).toBeGreaterThanOrEqual(1);
    expect(view.score).toBeGreaterThan(0);
  });

  it("reports no shared axes for an off-theme card", () => {
    const deck = [
      makeCard("Token Maker A", "Create a 1/1 green Saproling creature token.", "Creature — Fungus"),
      makeCard("Token Maker B", "Create a 1/1 white Soldier creature token.", "Creature — Soldier"),
      makeCard("Token Lord", "Tokens you control get +1/+1.", "Enchantment"),
    ];
    const vanilla = makeCard("Plain Bear", "", "Creature — Bear");

    const view = quickSynergyView(vanilla, deck);
    expect(view.sharedAxes).toEqual([]);
    expect(view.feeds).toEqual([]);
    expect(view.fedBy).toEqual([]);
  });
});

// ── Card synergy tags (empty-deck fallback) ──────────────────────────────────

describe("cardSynergyTags", () => {
  it("surfaces the source axes a token-maker produces", () => {
    const tags = cardSynergyTags(
      makeCard("Token Maker", "Create a 1/1 green Saproling creature token.", "Sorcery"),
    );
    expect(tags.sourceAxes).toContain("tokens");
    expect(typeof tags.engineRole).toBe("string");
    expect(tags.engineRole.length).toBeGreaterThan(0);
  });

  it("reports empty axes for a vanilla creature", () => {
    const tags = cardSynergyTags(makeCard("Plain Bear", "", "Creature — Bear"));
    expect(tags.sourceAxes).toEqual([]);
    expect(tags.payoffAxes).toEqual([]);
  });

  it("does not depend on deck context (deck-independent read)", () => {
    const card = makeCard("Token Lord", "Tokens you control get +1/+1.", "Enchantment");
    // Same result regardless of any surrounding deck — this is a single-card fingerprint.
    const a = cardSynergyTags(card);
    const b = cardSynergyTags(card);
    expect(a).toEqual(b);
    expect(a.payoffAxes).toContain("tokens");
  });
});
