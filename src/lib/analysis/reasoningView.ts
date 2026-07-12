/**
 * reasoningView.ts — Pure view-model transforms for the reasoning UI.
 *
 * These functions turn already-computed generation data (per-card score
 * contributions and the deck synergy graph) into small, labelled, display-ready
 * shapes. They contain NO React and NO scoring logic — they only relabel and
 * rank data the pipeline already produced, so they are cheap to unit-test and
 * keep presentation concerns out of the generator.
 */

import type { CardScoreContribution } from "../generator/types";
import type { SeedSynergyGraph, SynergyEdgeKind, SynergyGraphEdge } from "./synergyGraph";

// ── Card breakdown ─────────────────────────────────────────────────────────

/** One labelled contributor to a card's per-copy score. */
export interface BreakdownFactor {
  label: string;
  /** Signed per-copy point value (penalties are negative). */
  value: number;
  sign: "positive" | "negative";
}

export interface CardBreakdown {
  oracleId: string;
  name: string;
  quantity: number;
  /** Per-copy composite score. */
  perCopy: number;
  /** Whole-deck contribution (perCopy × quantity). */
  total: number;
  /** Non-zero contributing factors, ordered by descending magnitude. */
  factors: BreakdownFactor[];
}

/**
 * Turn a raw {@link CardScoreContribution} into a labelled, human-readable
 * breakdown. Only non-zero factors are included; penalties surface as negative
 * values so a reader sees exactly why a card scored what it did.
 */
export function buildCardBreakdown(score: CardScoreContribution): CardBreakdown {
  const focusTribal = (score.focusBonus ?? 0) + (score.tribalBonus ?? 0);
  const raw: Array<{ label: string; value: number }> = [
    { label: "Role & power", value: score.rolePowerContribution },
    { label: "Synergy", value: score.synergyContribution },
    { label: "Directional synergy", value: score.directionalContribution },
    { label: "Meta signal", value: score.signalContribution },
    { label: "Efficiency", value: score.efficiencyContribution ?? 0 },
    { label: "Flexibility", value: score.flexibilityContribution ?? 0 },
    { label: "Ladder meta", value: score.ladderContribution ?? 0 },
    { label: "Composition", value: score.compositionBonus ?? 0 },
    { label: "Focus card", value: score.focusCardBonus ?? 0 },
    { label: "Focus / tribal", value: focusTribal },
    { label: "Off-curve penalty", value: -(score.cmcPenalty ?? 0) },
    { label: "Price penalty", value: -(score.pricePenalty ?? 0) },
  ];

  const factors: BreakdownFactor[] = raw
    .filter((f) => Math.abs(f.value) >= 0.05)
    .map((f): BreakdownFactor => ({ label: f.label, value: f.value, sign: f.value >= 0 ? "positive" : "negative" }))
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value));

  return {
    oracleId: score.oracleId,
    name: score.name,
    quantity: score.quantity,
    perCopy: score.perCopyScore,
    total: score.contribution,
    factors,
  };
}

/**
 * Build breakdowns for the most informative cards: the top `count` positive
 * contributors plus any card carrying a penalty (so users see the drags too),
 * capped and de-duplicated. Input is expected to be the mainboard card scores.
 */
export function buildCardBreakdowns(
  cardScores: CardScoreContribution[],
  count = 12,
): CardBreakdown[] {
  const mainOnly = cardScores.filter((s) => s.board === "main");
  const byContribution = [...mainOnly].sort((a, b) => b.contribution - a.contribution);
  const chosen = new Map<string, CardScoreContribution>();
  for (const s of byContribution.slice(0, count)) chosen.set(s.oracleId, s);
  // Always surface the worst penalised card even if it fell outside the top N,
  // so the breakdown is honest about drags on the score.
  const penalised = mainOnly
    .filter((s) => (s.cmcPenalty ?? 0) + (s.pricePenalty ?? 0) > 0.05)
    .sort((a, b) => (b.cmcPenalty + b.pricePenalty) - (a.cmcPenalty + a.pricePenalty));
  if (penalised[0] && !chosen.has(penalised[0].oracleId)) {
    chosen.set(penalised[0].oracleId, penalised[0]);
  }
  return [...chosen.values()]
    .sort((a, b) => b.contribution - a.contribution)
    .map(buildCardBreakdown);
}

// ── Synergy pairs ──────────────────────────────────────────────────────────

/** An undirected, display-ready synergy relationship between two cards. */
export interface SynergyPairView {
  a: string;
  b: string;
  kind: SynergyEdgeKind;
  axis: string;
  weight: number;
  label: string;
}

const KIND_LABEL: Record<SynergyEdgeKind, string> = {
  "mutual-engine": "mutual engine",
  "source-to-payoff": "source → payoff",
  "shared-axis": "shared axis",
};

/** Undirected key for a pair of oracle IDs (order-independent). */
function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/**
 * Collapse the directed synergy graph into a ranked list of undirected card
 * pairs. Directed duplicates (A→B and B→A) and multiple edge kinds between the
 * same two cards collapse to the single strongest relationship, so each pair
 * appears once at its highest weight. Sorted by weight descending, then name.
 */
export function topSynergyPairs(graph: SeedSynergyGraph | undefined, limit = 15): SynergyPairView[] {
  if (!graph || graph.edges.length === 0) return [];
  const best = new Map<string, SynergyGraphEdge>();
  for (const edge of graph.edges) {
    const key = pairKey(edge.fromOracleId, edge.toOracleId);
    const current = best.get(key);
    if (!current || edge.weight > current.weight) best.set(key, edge);
  }
  return [...best.values()]
    .map((edge): SynergyPairView => {
      // Present names alphabetically so the undirected pair reads consistently.
      const [a, b] = [edge.fromName, edge.toName].sort((x, y) => x.localeCompare(y));
      return {
        a,
        b,
        kind: edge.kind,
        axis: edge.axis,
        weight: edge.weight,
        label: `${KIND_LABEL[edge.kind]} · ${edge.axis} (${edge.weight.toFixed(1)})`,
      };
    })
    .sort((x, y) => y.weight - x.weight || x.a.localeCompare(y.a) || x.b.localeCompare(y.b))
    .slice(0, limit);
}
