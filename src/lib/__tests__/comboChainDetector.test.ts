import { describe, expect, it } from "vitest";
import { detectComboChains, detectComboChainsForCards } from "../analysis/comboChainDetector";
import type { SeedSynergyGraph, SynergyGraphEdge, SynergyGraphNode } from "../analysis/synergyGraph";
import type { CardRecord } from "../types";

function node(id: string): SynergyGraphNode {
  return { oracleId: id, name: id, engineRole: "engine", sourceTags: ["tokens"], payoffTags: ["tokens"] };
}

function edge(from: string, to: string, weight = 0.8): SynergyGraphEdge {
  return {
    fromOracleId: from,
    toOracleId: to,
    fromName: from,
    toName: to,
    axis: "tokens",
    kind: weight === 1 ? "mutual-engine" : "source-to-payoff",
    weight,
    explanation: `${from} supplies tokens; ${to} rewards tokens.`,
  };
}

function graph(nodes: string[], edges: SynergyGraphEdge[]): Pick<SeedSynergyGraph, "nodes" | "edges"> {
  return { nodes: nodes.map(node), edges };
}

function makeCard(index: number): CardRecord {
  const name = `Card ${index}`;
  return {
    id: name, oracleId: `card-${index}`, name,
    lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{1}", cmc: 1, colorsJson: "[]", colorIdentityJson: "[]",
    typeLine: "Creature — Test", oracleText: "",
    keywordsJson: "[]", power: "1", toughness: "1", loyalty: null, producedManaJson: "[]",
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0, legalitiesJson: "{\"standard\":\"legal\"}",
    setCode: "TST", setName: "Test", setType: null, collectorNumber: null, rarity: "common",
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null, searchText: name, importedAt: "",
  };
}

describe("combo-chain detector", () => {
  it("finds a three-card linear source-to-payoff chain", () => {
    const chains = detectComboChains(graph(["A", "B", "C"], [edge("A", "B"), edge("B", "C")]));
    const chain = chains.find((candidate) => candidate.kind === "linear" && candidate.oracleIds.join(",") === "A,B,C");

    expect(chain).toMatchObject({
      cardNames: ["A", "B", "C"],
      axes: ["tokens"],
      chainScore: 1.6,
    });
    expect(chain?.explanation).toContain("A → B → C");
  });

  it("recognizes a closed recurring engine loop and ranks it above its linear path", () => {
    const chains = detectComboChains(graph(
      ["A", "B", "C"],
      [edge("A", "B", 1), edge("B", "C", 1), edge("C", "A", 1)],
    ));
    const loop = chains.find((candidate) => candidate.kind === "loop");

    expect(loop).toBeDefined();
    expect(loop?.oracleIds).toEqual(["A", "B", "C"]);
    expect(loop?.chainScore).toBe(4.5);
    expect(loop?.explanation).toContain("recurring");
    expect(loop!.chainScore).toBeGreaterThan(chains.find((candidate) => candidate.kind === "linear")!.chainScore);
  });

  it("bounds work on a dense 240-card candidate pool", () => {
    const cards = Array.from({ length: 240 }, (_, index) => ({
      ...makeCard(index),
      oracleText: "Create a 1/1 token. Whenever you create a token, put a +1/+1 counter on this creature.",
    }));
    const started = performance.now();
    const chains = detectComboChainsForCards(cards);
    const elapsed = performance.now() - started;

    expect(chains.length).toBeGreaterThan(0);
    expect(chains.length).toBeLessThanOrEqual(160);
    expect(elapsed).toBeLessThan(1_500);
  });
});
