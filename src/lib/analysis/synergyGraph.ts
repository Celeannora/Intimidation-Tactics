/**
 * synergyGraph.ts — Explainable seed synergy graph.
 *
 * Builds a compact directed graph from seed cards so the Analyze workflow can
 * explain how the initial cards imply a plan: source → payoff, shared engine,
 * or shared-axis relationships.
 */

import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
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
  /**
   * Relationship strength in [0,1]. A mutual engine (both cards produce AND
   * reward the axis) is the strongest signal; a directional source→payoff is
   * moderate; a mere shared-axis co-occurrence is weak. Downstream consumers
   * (prompt rendering, constraint synthesis) can weight axes by summed edge
   * strength instead of treating every link as equal.
   */
  weight: number;
}

export interface SeedSynergyGraph {
  nodes: SynergyGraphNode[];
  edges: SynergyGraphEdge[];
  connectedAxes: Array<{ axis: MechanicAxis; edgeCount: number; cards: string[] }>;
  /**
   * How many *distinct* seed cards directly participate in each axis
   * (i.e. the axis appears in the card's sourceTags or payoffTags).
   *
   * This is the correct signal for "is this a real build-around axis?"
   * edgeCount can be inflated by multiple edge *types* between the same
   * two cards, so it is not a reliable proxy for multi-card support.
   */
  axisSeedCardCounts: Partial<Record<MechanicAxis, number>>;
  density: number;
  /**
   * Weighted density: sum of all edge weights divided by the number of possible
   * directed edges. Unlike raw `density` (which counts every link equally), this
   * discounts weak shared-axis links so a set wired together by real
   * source→payoff / mutual-engine relationships scores higher than one merely
   * sharing tags.
   */
  weightedDensity: number;
  narrative: string;
}

/** Relationship-strength weights per edge kind (see SynergyGraphEdge.weight). */
const EDGE_KIND_WEIGHT: Record<SynergyEdgeKind, number> = {
  "mutual-engine": 1.0,
  "source-to-payoff": 0.8,
  "shared-axis": 0.4,
};

function edgeWeight(kind: SynergyEdgeKind): number {
  return EDGE_KIND_WEIGHT[kind];
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

  // ── Per-axis distinct seed card counts ─────────────────────────────────────
  // This is the authoritative signal for "how many distinct seed cards explicitly
  // participate in this axis?" — used downstream to decide whether an axis is a
  // true build-around (≥2 distinct cards) or just a single one-off card that
  // happened to share an axis with one other card.
  const axisSeedCardCounts: Partial<Record<MechanicAxis, number>> = {};
  for (const { profile } of profiles) {
    // Use a per-card set so a card that has the same axis in both source and payoff
    // is only counted once per card, not twice.
    const cardAxes = new Set<MechanicAxis>([...profile.sourceTags, ...profile.payoffTags]);
    for (const axis of cardAxes) {
      axisSeedCardCounts[axis] = (axisSeedCardCounts[axis] ?? 0) + 1;
    }
  }

  const possibleDirectedEdges = seeds.length * Math.max(0, seeds.length - 1);
  const density = possibleDirectedEdges > 0 ? round2(edges.length / possibleDirectedEdges) : 0;
  const totalWeight = edges.reduce((sum, e) => sum + e.weight, 0);
  const weightedDensity = possibleDirectedEdges > 0 ? round2(totalWeight / possibleDirectedEdges) : 0;
  const narrative = buildGraphNarrative(connectedAxes, edges.length, seeds.length);

  const graph: SeedSynergyGraph = { nodes, edges, connectedAxes, axisSeedCardCounts, density, weightedDensity, narrative };
  _graphCache.set(key, graph);
  return graph;
}

/**
 * Build a synergy graph over the cards of a finished deck. Uses the deck's
 * unique nonland cards (quantities are irrelevant to a card↔card relationship
 * graph), so the same source→payoff / mutual-engine / shared-axis analysis that
 * feeds the seed prompt is available to explain the assembled deck in the UI.
 */
export function buildDeckSynergyGraph(entries: DeckEntry[]): SeedSynergyGraph {
  const uniqueNonland = new Map<string, CardRecord>();
  for (const entry of entries) {
    if (entry.board !== "main") continue;
    if (entry.card.typeLine.includes("Land")) continue;
    if (!uniqueNonland.has(entry.card.oracleId)) uniqueNonland.set(entry.card.oracleId, entry.card);
  }
  return buildSeedSynergyGraph([...uniqueNonland.values()]);
}

export function formatSynergyGraphForPrompt(graph: SeedSynergyGraph): string {
  const axisLines = graph.connectedAxes.length > 0
    ? graph.connectedAxes.map((axis) => `- ${axis.axis}: ${axis.edgeCount} link(s), cards: ${axis.cards.join(", ")}`).join("\n")
    : "- No direct seed-to-seed synergy edges detected.";

  const edgeLines = graph.edges.slice(0, 12).map((edge) => `- [${edge.kind}, w=${edge.weight.toFixed(1)}] ${edge.explanation}`).join("\n") || "- None";

  const prose = [
    "Seed synergy graph:",
    `- Density: ${Math.round(graph.density * 100)}% (weighted ${Math.round(graph.weightedDensity * 100)}%)`,
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
  /** Weighted density 0-1: discounts weak shared-axis links; better cohesion signal than raw density. */
  weightedDensityScore: number;
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
  const { axisSeedCardCounts } = graph;
  const sorted = [...graph.connectedAxes].sort((a, b) => b.edgeCount - a.edgeCount);

  // ── Axis classification by distinct seed-card support ────────────────────
  // An axis is only "required" when ≥2 DISTINCT seed cards explicitly point
  // toward it.  Using edgeCount here is misleading: a single pair of cards (A, B)
  // can produce multiple edges for the same axis (source-to-payoff + shared-axis
  // = 2 edges), making it look like a strongly supported axis when it is really
  // just one interaction between two cards.
  const required = sorted
    .filter((a) => (axisSeedCardCounts[a.axis] ?? 0) >= 2)
    .map((a) => a.axis)
    .slice(0, 3);

  // "Supporting" = axis connected in the graph but only via a single seed card.
  // These are flavour hints — do NOT over-build around them.
  const supporting = sorted
    .filter((a) => (axisSeedCardCounts[a.axis] ?? 0) === 1 && a.edgeCount >= 1)
    .map((a) => a.axis)
    .slice(0, 3);

  // Axes present on only one seed card with exactly one graph edge —
  // the weakest possible signal; explicitly labelled so the LLM ignores them.
  const singleCardOnlyAxes = Object.entries(axisSeedCardCounts)
    .filter(([, count]) => (count ?? 0) === 1)
    .map(([axis]) => axis as MechanicAxis)
    .filter((a) => !required.includes(a) && !supporting.includes(a));

  const confirmedLinks = graph.edges
    .filter((e) => e.kind === "source-to-payoff" || e.kind === "mutual-engine")
    .slice(0, 10)
    .map((e) => ({ from: e.fromName, to: e.toName, axis: e.axis, kind: e.kind }));

  let buildInstruction: string;
  if (required.length === 0 && singleCardOnlyAxes.length > 0) {
    // All mechanical axes come from individual cards — high risk of one-off overfit.
    buildInstruction =
      `All detected axes are single-card signals only (axes: ${singleCardOnlyAxes.slice(0, 3).join(", ")}). ` +
      `Do NOT pivot the whole deck around any one of these axes; include only 1–2 cards per axis as flavour. ` +
      `Prioritise broad role value instead: interaction, card draw, ramp, and on-curve threats come first.`;
  } else if (required.length > 0 && graph.density >= 0.5) {
    buildInstruction =
      `High-density seed set (${Math.round(graph.density * 100)}%). ` +
      `Prioritise cards that support ≥2 required axes (${required.join(", ")}), each backed by multiple seed cards. ` +
      `Penalise off-axis inclusions unless they fill mandatory interaction, draw, or ramp roles.`;
  } else if (required.length > 0 && graph.density >= 0.2) {
    buildInstruction =
      `Moderate-density seed set (${Math.round(graph.density * 100)}%). ` +
      `Build around required axes (${required.join(", ")}) but keep 30–40% of slots for supporting/off-axis role cards to maintain resilience. ` +
      (supporting.length > 0 ? `Supporting axes (single-card evidence: ${supporting.join(", ")}) are hints only — 1–2 cards each is enough.` : "");
  } else if (required.length > 0) {
    buildInstruction =
      `Low-density seed set (${Math.round(graph.density * 100)}%) but ${required.length} axis/axes confirmed by multiple seed cards (${required.join(", ")}). ` +
      `Lean into those axes. Treat cards whose axes are supported by only one seed as flexible slots that may be swapped for better role coverage.`;
  } else {
    buildInstruction =
      `No multi-card axis pairs detected. Treat all seed cards as role-based signals only, not mechanical-axis evidence. ` +
      `Build the most coherent competitive interpretation based on roles (interaction, threats, draw, ramp) and colour identity.`;
  }

  return { requiredAxes: required, supportingAxes: supporting, densityScore: round2(graph.density), weightedDensityScore: round2(graph.weightedDensity), confirmedLinks, buildInstruction };
}

/**
 * Insert an edge (deduped by from→to:axis:kind). The `weight` is derived from
 * the edge kind here so call sites don't have to supply it.
 */
function pushEdge(edges: SynergyGraphEdge[], seen: Set<string>, edge: Omit<SynergyGraphEdge, "weight">): void {
  const key = `${edge.fromOracleId}->${edge.toOracleId}:${edge.axis}:${edge.kind}`;
  if (seen.has(key)) return;
  seen.add(key);
  edges.push({ ...edge, weight: edgeWeight(edge.kind) });
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
