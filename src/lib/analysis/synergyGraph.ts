/**
 * synergyGraph.ts — Explainable seed synergy graph.
 *
 * Builds a compact directed graph from seed cards so the Analyze workflow can
 * explain how the initial cards imply a plan: source → payoff, shared engine,
 * or shared-axis relationships.
 */

import type { CardRecord } from "../types";
import { buildSynergyProfile, type EngineRole, type MechanicAxis } from "../generator/synergyModel";

export type SynergyEdgeKind = "source-to-payoff" | "mutual-engine" | "shared-axis";

export interface SynergyGraphNode {
  oracleId: string;
  name: string;
  engineRole: EngineRole;
  sourceTags: MechanicAxis[];
  payoffTags: MechanicAxis[];
}

export interface SynergyGraphEdge {
  fromOracleId: string;
  toOracleId: string;
  fromName: string;
  toName: string;
  axis: MechanicAxis;
  kind: SynergyEdgeKind;
  explanation: string;
}

export interface SeedSynergyGraph {
  nodes: SynergyGraphNode[];
  edges: SynergyGraphEdge[];
  connectedAxes: Array<{ axis: MechanicAxis; edgeCount: number; cards: string[] }>;
  density: number;
  narrative: string;
}

// ── Module-level cache ──────────────────────────────────────────────────────
// Keyed by a stable hash of sorted oracle IDs so repeated Analyze calls on
// the same seed set do not recompute the graph from scratch.
const _graphCache = new Map<string, SeedSynergyGraph>();

function seedCacheKey(seeds: CardRecord[]): string {
  return seeds
    .map((c) => c.oracleId)
    .slice()
    .sort()
    .join("|");
}

/** Clear the synergy graph cache (useful in tests or after bulk data refresh). */
export function clearSynergyGraphCache(): void {
  _graphCache.clear();
}

/** Build a deterministic synergy graph among seed cards (cached by seed set). */
export function buildSeedSynergyGraph(seeds: CardRecord[]): SeedSynergyGraph {
  const key = seedCacheKey(seeds);
  const cached = _graphCache.get(key);
  if (cached) return cached;

  const profiles = seeds.map((card) => ({ card, profile: buildSynergyProfile(card) }));
  const nodes: SynergyGraphNode[] = profiles.map(({ card, profile }) => ({
    oracleId: card.oracleId,
    name: card.name,
    engineRole: profile.engineRole,
    sourceTags: [...profile.sourceTags],
    payoffTags: [...profile.payoffTags],
  }));

  const edges: SynergyGraphEdge[] = [];
  const seen = new Set<string>();

  for (const a of profiles) {
    for (const b of profiles) {
      if (a.card.oracleId === b.card.oracleId) continue;

      // A produces an axis B rewards.
      for (const axis of a.profile.sourceTags) {
        if (b.profile.payoffTags.has(axis)) {
          pushEdge(edges, seen, {
            fromOracleId: a.card.oracleId,
            toOracleId: b.card.oracleId,
            fromName: a.card.name,
            toName: b.card.name,
            axis,
            kind: "source-to-payoff",
            explanation: `${a.card.name} supplies ${axis}; ${b.card.name} rewards ${axis}.`,
          });
        }
      }

      // Mutual engine relationship: both source and payoff for same axis.
      for (const axis of a.profile.sourceTags) {
        if (a.profile.payoffTags.has(axis) && b.profile.sourceTags.has(axis) && b.profile.payoffTags.has(axis)) {
          pushEdge(edges, seen, {
            fromOracleId: a.card.oracleId,
            toOracleId: b.card.oracleId,
            fromName: a.card.name,
            toName: b.card.name,
            axis,
            kind: "mutual-engine",
            explanation: `${a.card.name} and ${b.card.name} both produce and reward ${axis}.`,
          });
        }
      }

      // Shared-axis relationship when both participate but not directionally.
      const aAxes = new Set<MechanicAxis>([...a.profile.sourceTags, ...a.profile.payoffTags]);
      const bAxes = new Set<MechanicAxis>([...b.profile.sourceTags, ...b.profile.payoffTags]);
      for (const axis of aAxes) {
        if (bAxes.has(axis) && !a.profile.sourceTags.has(axis) && !b.profile.payoffTags.has(axis)) {
          pushEdge(edges, seen, {
            fromOracleId: a.card.oracleId,
            toOracleId: b.card.oracleId,
            fromName: a.card.name,
            toName: b.card.name,
            axis,
            kind: "shared-axis",
            explanation: `${a.card.name} and ${b.card.name} both point toward ${axis}.`,
          });
        }
      }
    }
  }

  const axisMap = new Map<MechanicAxis, { edgeCount: number; cards: Set<string> }>();
  for (const edge of edges) {
    const current = axisMap.get(edge.axis) ?? { edgeCount: 0, cards: new Set<string>() };
    current.edgeCount += 1;
    current.cards.add(edge.fromName);
    current.cards.add(edge.toName);
    axisMap.set(edge.axis, current);
  }

  const connectedAxes = [...axisMap.entries()]
    .map(([axis, data]) => ({ axis, edgeCount: data.edgeCount, cards: [...data.cards].sort() }))
    .sort((a, b) => b.edgeCount - a.edgeCount);

  const possibleDirectedEdges = seeds.length * Math.max(0, seeds.length - 1);
  const density = possibleDirectedEdges > 0 ? round2(edges.length / possibleDirectedEdges) : 0;
  const narrative = buildGraphNarrative(connectedAxes, edges.length, seeds.length);

  const graph: SeedSynergyGraph = { nodes, edges, connectedAxes, density, narrative };
  _graphCache.set(key, graph);
  return graph;
}

export function formatSynergyGraphForPrompt(graph: SeedSynergyGraph): string {
  const axisLines = graph.connectedAxes.length > 0
    ? graph.connectedAxes.map((axis) => `- ${axis.axis}: ${axis.edgeCount} link(s), cards: ${axis.cards.join(", ")}`).join("\n")
    : "- No direct seed-to-seed synergy edges detected.";

  const edgeLines = graph.edges.slice(0, 12).map((edge) => `- [${edge.kind}] ${edge.explanation}`).join("\n") || "- None";

  return [
    "Seed synergy graph:",
    `- Density: ${Math.round(graph.density * 100)}%`,
    `- Summary: ${graph.narrative}`,
    "Connected axes:",
    axisLines,
    "Key seed links:",
    edgeLines,
  ].join("\n");
}

function pushEdge(edges: SynergyGraphEdge[], seen: Set<string>, edge: SynergyGraphEdge): void {
  const key = `${edge.fromOracleId}->${edge.toOracleId}:${edge.axis}:${edge.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push(edge);
}

function buildGraphNarrative(
  axes: Array<{ axis: MechanicAxis; edgeCount: number; cards: string[] }>,
  edgeCount: number,
  seedCount: number,
): string {
  if (seedCount === 0) return "No seed cards were provided.";
  if (edgeCount === 0) return "Seeds do not directly connect through known source/payoff axes; treat the plan as ambiguous or role-based.";
  const top = axes[0];
  return `Seeds form ${edgeCount} explainable synergy link(s), primarily on ${top.axis}, involving ${top.cards.slice(0, 4).join(", ")}.`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}
