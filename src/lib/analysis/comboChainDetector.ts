/**
 * comboChainDetector.ts — bounded multi-hop source/payoff chain detection.
 *
 * This is deliberately an explainable heuristic, not a Magic rules engine.
 * It only follows the typed directional edges already inferred by
 * synergyGraph.ts, and it caps depth/branching/results so candidate pools of
 * several hundred cards remain safe to evaluate in the browser.
 */

import type { CardRecord } from "../types";
import {
  buildCandidatePoolSynergyGraph,
  type SeedSynergyGraph,
  type SynergyGraphEdge,
} from "./synergyGraph";
import type { MechanicAxis } from "../generator/synergyModel";

export type ComboChainKind = "linear" | "loop";

export interface ComboChain {
  /** Ordered, non-repeated cards. For a loop the final edge returns to index 0. */
  oracleIds: string[];
  cardNames: string[];
  kind: ComboChainKind;
  axes: MechanicAxis[];
  /**
   * Explainable heuristic strength. It is average eligible edge weight times
   * hop count, plus 1.5 for a closed loop: longer strong links matter, while
   * a loop earns a fixed premium because it can recur rather than resolve once.
   */
  chainScore: number;
  explanation: string;
}

const MAX_HOPS = 4;
const MAX_BRANCHES_PER_NODE = 12;
const MAX_CHAINS = 160;

type EligibleEdge = SynergyGraphEdge & {
  kind: "source-to-payoff" | "mutual-engine";
};

function isEligibleEdge(edge: SynergyGraphEdge): edge is EligibleEdge {
  return edge.kind === "source-to-payoff" || edge.kind === "mutual-engine";
}

/**
 * Detect chains from an existing graph. The graph parameter makes this pure
 * and easy to unit test with synthetic edges, while detectComboChainsForCards
 * is the convenient candidate-pool entry point.
 */
export function detectComboChains(graph: Pick<SeedSynergyGraph, "nodes" | "edges">): ComboChain[] {
  const nodesById = new Map(graph.nodes.map((node) => [node.oracleId, node]));
  const outgoing = buildPrunedAdjacency(graph.edges);
  const found = new Map<string, ComboChain>();

  const starts = [...outgoing.keys()].sort();
  for (const start of starts) {
    if (found.size >= MAX_CHAINS) break;
    const startEdges = outgoing.get(start);
    if (!startEdges?.length) continue;
    walk(start, start, [], [], new Set([start]), 0);
  }

  return [...found.values()].sort(
    (a, b) => b.chainScore - a.chainScore || a.cardNames.join("|").localeCompare(b.cardNames.join("|")),
  );

  function walk(
    start: string,
    current: string,
    path: string[],
    pathEdges: EligibleEdge[],
    visited: Set<string>,
    hops: number,
  ): void {
    if (found.size >= MAX_CHAINS || hops >= MAX_HOPS) return;

    for (const edge of outgoing.get(current) ?? []) {
      if (found.size >= MAX_CHAINS) return;
      const next = edge.toOracleId;
      const nextHops = hops + 1;

      if (next === start && path.length >= 2) {
        // `path` begins with start and contains all non-repeated loop nodes.
        addChain([...path, current].filter((id, index, ids) => index === 0 || id !== ids[index - 1]), [...pathEdges, edge], "loop");
        continue;
      }
      if (visited.has(next)) continue;

      const nextPath = path.length === 0 ? [start, next] : [...path, next];
      const nextEdges = [...pathEdges, edge];
      if (nextPath.length >= 3) addChain(nextPath, nextEdges, "linear");
      if (nextHops < MAX_HOPS) {
        const nextVisited = new Set(visited);
        nextVisited.add(next);
        walk(start, next, nextPath, nextEdges, nextVisited, nextHops);
      }
    }
  }

  function addChain(oracleIds: string[], edges: EligibleEdge[], kind: ComboChainKind): void {
    if (oracleIds.length < 3 || edges.length === 0 || oracleIds.some((id) => !nodesById.has(id))) return;
    const normalizedIds = kind === "loop" ? canonicalLoop(oracleIds) : oracleIds;
    const key = `${kind}:${normalizedIds.join(">")}`;
    if (found.has(key)) return;

    const axes = [...new Set(edges.map((edge) => edge.axis))].sort();
    const averageWeight = edges.reduce((sum, edge) => sum + edge.weight, 0) / edges.length;
    const chainScore = round2(averageWeight * edges.length + (kind === "loop" ? 1.5 : 0));
    const cardNames = normalizedIds.map((id) => nodesById.get(id)!.name);
    const explanation = kind === "loop"
      ? `${cardNames.join(" → ")} → ${cardNames[0]} forms a recurring ${axes.join("/") || "synergy"} engine.`
      : `${cardNames.join(" → ")} forms a ${edges.length}-hop ${axes.join("/") || "synergy"} chain.`;

    found.set(key, { oracleIds: normalizedIds, cardNames, kind, axes, chainScore, explanation });
  }
}

/** Build a graph using the shared synergy profile model, then traverse it. */
export function detectComboChainsForCards(cards: CardRecord[]): ComboChain[] {
  return detectComboChains(buildCandidatePoolSynergyGraph(cards));
}

/**
 * Keep the strongest edge per destination and cap fan-out. The graph can be
 * dense when many cards share one axis; without this pruning a depth-four DFS
 * would enumerate a combinatorial number of semantically identical paths.
 */
function buildPrunedAdjacency(edges: SynergyGraphEdge[]): Map<string, EligibleEdge[]> {
  const byFrom = new Map<string, Map<string, EligibleEdge>>();
  for (const edge of edges) {
    if (!isEligibleEdge(edge)) continue;
    const destinations = byFrom.get(edge.fromOracleId) ?? new Map<string, EligibleEdge>();
    const current = destinations.get(edge.toOracleId);
    if (!current || edge.weight > current.weight || (edge.weight === current.weight && edge.axis < current.axis)) {
      destinations.set(edge.toOracleId, edge);
    }
    byFrom.set(edge.fromOracleId, destinations);
  }

  return new Map(
    [...byFrom.entries()].map(([from, destinations]) => [
      from,
      [...destinations.values()]
        .sort((a, b) => b.weight - a.weight || a.toOracleId.localeCompare(b.toOracleId) || a.axis.localeCompare(b.axis))
        .slice(0, MAX_BRANCHES_PER_NODE),
    ]),
  );
}

function canonicalLoop(ids: string[]): string[] {
  const rotations = ids.map((_, index) => [...ids.slice(index), ...ids.slice(0, index)]);
  return rotations.sort((a, b) => a.join("|").localeCompare(b.join("|")))[0];
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
