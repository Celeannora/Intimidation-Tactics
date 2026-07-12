/**
 * archetypeMatch.ts — Track 2 fuzzy archetype matcher.
 *
 * Given a decklist's classified macro archetype + colour identity, try to match
 * it against the tracked archetypes in a live win-rate dataset. The match is
 * deliberately conservative: it *rejects* low-confidence matches (returning an
 * explicit "no comparable market data" state) rather than forcing a deck onto
 * the nearest tracked archetype. Forcing a match is what produced the old
 * fake-confidence behaviour where AI/homebrew decks inherited a netdeck's
 * favourable number.
 *
 * Confidence model (0–1), a weighted blend of two independent signals:
 *   - colour overlap  (0.6) — Jaccard similarity of WUBRG identity
 *   - macro agreement (0.4) — 1.0 when the deck's macro equals the tracked
 *                             archetype's inferred macro, else 0
 *
 * Accept requires BOTH a floor on absolute confidence AND a margin over the
 * runner-up, so genuinely ambiguous cases (two equally-plausible archetypes)
 * are rejected as unmatched. Thresholds were chosen so that:
 *   - a mono/2-colour deck whose macro matches a tracked deck of the same
 *     colours clears the floor comfortably (colour 1.0·0.6 + macro 1.0·0.4 = 1.0),
 *   - a same-colours-but-different-macro deck lands at 0.6 (accepted only if
 *     unambiguous — real archetypes are colour+strategy defined),
 *   - a 5-colour "pile" or Unknown-macro homebrew scores far below the floor
 *     against any focused tracked archetype and is rejected.
 */

import type { ManaColor } from "../types";
import type { Archetype } from "../archetype";
import type { LiveArchetypeWinRate, LiveWinRateDataset } from "./liveWinRate";

/** Minimum absolute confidence for a match to be accepted. */
export const ACCEPT_THRESHOLD = 0.5;
/** Minimum lead the best candidate must have over the runner-up. */
export const AMBIGUITY_MARGIN = 0.1;

export interface ArchetypeQuery {
  archetype: Archetype;
  colors: ManaColor[];
}

export interface ArchetypeMatch {
  matched: boolean;
  /** Best candidate seen (present even when rejected, for diagnostics). */
  candidate?: LiveArchetypeWinRate;
  /** Confidence of the best candidate, 0–1. */
  confidence: number;
  /** Why a match was rejected, when it was. */
  reason?: "empty-dataset" | "below-threshold" | "ambiguous";
}

function jaccard(a: ManaColor[], b: ManaColor[]): number {
  const sa = new Set(a);
  const sb = new Set(b);
  if (sa.size === 0 && sb.size === 0) return 1;
  if (sa.size === 0 || sb.size === 0) return 0;
  let inter = 0;
  for (const c of sa) if (sb.has(c)) inter++;
  const union = sa.size + sb.size - inter;
  return union === 0 ? 0 : inter / union;
}

/** Blended 0–1 confidence that `query` describes `candidate`. */
export function matchConfidence(query: ArchetypeQuery, candidate: LiveArchetypeWinRate): number {
  const colourScore = jaccard(query.colors, candidate.colors);
  const macroScore =
    candidate.macro && query.archetype !== "Unknown" && candidate.macro === query.archetype ? 1 : 0;
  return 0.6 * colourScore + 0.4 * macroScore;
}

/**
 * Attempt to match a decklist's classified archetype against the live dataset.
 * Rejects rather than forces when confidence is low or the top two candidates
 * are too close to distinguish.
 */
export function matchArchetype(query: ArchetypeQuery, dataset: LiveWinRateDataset | null | undefined): ArchetypeMatch {
  if (!dataset || dataset.archetypes.length === 0) {
    return { matched: false, confidence: 0, reason: "empty-dataset" };
  }

  const ranked = dataset.archetypes
    .map((candidate) => ({ candidate, confidence: matchConfidence(query, candidate) }))
    .sort((a, b) => b.confidence - a.confidence);

  const best = ranked[0];
  const runnerUp = ranked[1];

  if (best.confidence < ACCEPT_THRESHOLD) {
    return { matched: false, candidate: best.candidate, confidence: best.confidence, reason: "below-threshold" };
  }
  if (runnerUp && best.confidence - runnerUp.confidence < AMBIGUITY_MARGIN && best.confidence < 0.85) {
    // Two near-equal candidates and not a near-certain match → too ambiguous.
    return { matched: false, candidate: best.candidate, confidence: best.confidence, reason: "ambiguous" };
  }

  return { matched: true, candidate: best.candidate, confidence: best.confidence };
}
