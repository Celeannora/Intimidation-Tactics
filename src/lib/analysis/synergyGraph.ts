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

  const prose = [
    "Seed synergy graph:",
    `- Density: ${Math.round(graph.density * 100)}%`,
    `- Summary: ${graph.narrative}`,
    "Connected axes:",
    axisLines,
    "Key seed links:",
    edgeLines,
  ].join("\n");

  // Structured constraint block: LLMs follow JSON constraints more reliably than prose.
  // The <synergy_constraints> block gives the model explicit axis priorities and the
  // confirmed source→payoff links it must honor when selecting/reasoning about cards.
  const constraints = buildSynergyConstraints(graph);
  const constraintBlock = `<synergy_constraints>\n${JSON.stringify(constraints, null, 2)}\n</synergy_constraints>`;

  return `${prose}\n\n${constraintBlock}`;
}

/**
 * Build a compact, structured constraint object from the seed synergy graph.
 * Serialised as JSON inside <synergy_constraints> so the LLM treats it as
 * hard requirements rather than advisory prose.
 */
export interface SynergyConstraints {
  /** Top axes the deck MUST build around, ordered by evidence strength. */
  requiredAxes: MechanicAxis[];
  /** Secondary axes that support the primary plan. */
  supportingAxes: MechanicAxis[];
  /** Graph density 0-1: lower density = seeds don't strongly connect; treat plan as ambiguous. */
  densityScore: number;
  /** Confirmed pairwise links — each represents a real source→payoff relationship between seed cards. */
  confirmedLinks: Array<{
    from: string;
    to: string;
    axis: MechanicAxis;
    kind: SynergyEdgeKind;
  }>;
  /** Instruction derived from density: how aggressively to enforce axis coherence. */
  buildInstruction: string;
}

function buildSynergyConstraints(graph: SeedSynergyGraph): SynergyConstraints {
  const sorted = [...graph.connectedAxes].sort((a, b) => b.edgeCount - a.edgeCount);
  const required = sorted.filter((a) => a.edgeCount >= 2).map((a) => a.axis).slice(0, 3);
  const supporting = sorted.filter((a) => a.edgeCount === 1).map((a) => a.axis).slice(0, 3);

  const confirmedLinks = graph.edges
    .filter((e) => e.kind === "source-to-payoff" || e.kind === "mutual-engine")
    .slice(0, 10)
    .map((e) => ({ from: e.fromName, to: e.toName, axis: e.axis, kind: e.kind }));

  let buildInstruction: string;
  if (graph.density >= 0.5) {
    buildInstruction = `High-density seed set (${Math.round(graph.density * 100)}%). Prioritize cards that connect to ≥2 required axes. Penalize off-axis inclusions unless they fill mandatory interaction roles.`;
  } else if (graph.density >= 0.2) {
    buildInstruction = `Moderate-density seed set (${Math.round(graph.density * 100)}%). Build around required axes but allow 30-40% supporting/off-axis cards to maintain resilience.`;
  } else if (required.length > 0) {
    buildInstruction = `Low-density seed set (${Math.round(graph.density * 100)}%) but ${required.length} confirmed axis/axes exist. Lean into those axes while treating other seed cards as flexible slots.`;
  } else {
    buildInstruction = `No confirmed axis pairs detected. Treat seed cards as role-based signals only, not mechanical-axis evidence. Build the most coherent competitive interpretation.`;
  }

  return { requiredAxes: required, supportingAxes: supporting, densityScore: round2(graph.density), confirmedLinks, buildInstruction };
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
