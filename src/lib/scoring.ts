/**
 * scoring.ts — Composite card scoring (0–100)
 *
 * Delegates to the unified scoreEngine.ts for V2 directional source→payoff
 * synergy scoring. Uses composite scores from the V2 pipeline with letter grades.
 * Used by ArchetypePanel, SuggestionPanel, and AdvisorPanel.
 */

import type { CardRecord } from "./types";
import type { DeckEntry } from "./legality";
import { computeCompositeScore } from "./scoreEngine";
import type { SynergyConnectionSummary } from "./generator/synergyModel";

export type Grade = "S" | "A" | "B" | "C" | "D";

export interface ScoredCard {
  card: CardRecord;
  composite: number;    // 0–100
  directionalScore: number;   // 0–40 — V2 axis score
  synergyMultiplier: number;  // 1.0–1.55 density multiplier
  compositionBonus: number;   // 0–18 cross-axis bonus
  synergyConnections: SynergyConnectionSummary;
  grade: Grade;
}

function toGrade(score: number): Grade {
  if (score >= 85) return "S";
  if (score >= 70) return "A";
  if (score >= 55) return "B";
  if (score >= 40) return "C";
  return "D";
}

export function scoreCard(card: CardRecord, deckEntries: DeckEntry[]): ScoredCard {
  const cs = computeCompositeScore(card, deckEntries, {
    archetype: "Unknown", // neutral archetype for UI scoring
  });

  // Map the V2 composite total (0–100 range from scoreEngine) to a 0–100 scale
  const composite = Math.round(Math.min(100, cs.total));

  return {
    card,
    composite,
    directionalScore: cs.directionalScore,
    synergyMultiplier: cs.synergyMultiplier,
    compositionBonus: cs.compositionBonus,
    synergyConnections: cs.synergyConnectionSummary,
    grade: toGrade(composite),
  };
}

export function scoreDeck(entries: DeckEntry[]): ScoredCard[] {
  return entries
    .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
    .map((e) => scoreCard(e.card, entries))
    .sort((a, b) => b.composite - a.composite);
}

export function rankCandidates(
  candidates: CardRecord[],
  deckEntries: DeckEntry[]
): ScoredCard[] {
  return candidates
    .map((c) => scoreCard(c, deckEntries))
    .sort((a, b) => b.composite - a.composite);
}
