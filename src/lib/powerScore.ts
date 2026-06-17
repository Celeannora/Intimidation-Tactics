/**
 * powerScore.ts — Raw card quality signal (0–40)
 *
 * Two sources, in priority order:
 *  1. Real competitive signal (`competitivePower`) when the card appears in the
 *     bundled top-decklist snapshot — this is the trustworthy anchor.
 *  2. Heuristic fallback (EDHREC rank, rarity, game_changer flag, cmc, type line)
 *     for cards with no competitive data (new/fringe cards).
 *
 * NOTE: EDHREC rank is Commander popularity, not constructed power; it remains a
 * weak *fallback-only* prior. Once the competitive snapshot has broad coverage,
 * the heuristic should matter only at the margins.
 */

import type { CardRecord } from "./types";

/**
 * Blend weight for the competitive signal when it is available. The heuristic is
 * kept as a small smoother/tiebreaker so two staples with identical play data
 * still order sensibly by curve/type.
 */
const COMPETITIVE_BLEND = 0.8;

/**
 * Returns a raw power score 0–40. Higher = stronger card in isolation.
 *
 * @param card - The card to score.
 * @param competitivePower - Optional 0–40 competitive signal (from
 *   `competitivePower.getCompetitivePower`). When provided (non-null), it
 *   dominates the score; the heuristic acts only as a minor smoother. When
 *   omitted/null, the pure heuristic is used (backwards-compatible).
 */
export function computePowerScore(card: CardRecord, competitivePower?: number | null): number {
  const heuristic = computeHeuristicPowerScore(card);
  if (competitivePower != null && Number.isFinite(competitivePower)) {
    const blended = COMPETITIVE_BLEND * competitivePower + (1 - COMPETITIVE_BLEND) * heuristic;
    return Math.min(40, Math.max(0, Math.round(blended * 10) / 10));
  }
  return heuristic;
}

/**
 * Pure heuristic power score 0–40 (no competitive data). Exported for tests and
 * for callers that explicitly want the data-free signal.
 */
export function computeHeuristicPowerScore(card: CardRecord): number {
  let score = 0;

  // Game changer flag (Wizards curated)
  if (card.gameChanger === 1) score += 12;

  // Rarity tier
  if (card.rarity === "mythic") score += 10;
  else if (card.rarity === "rare") score += 7;
  else if (card.rarity === "uncommon") score += 4;
  else score += 1; // common

  // EDHREC rank (lower = more played = stronger signal)
  if (card.edhrecRank != null) {
    if (card.edhrecRank < 500)        score += 12;
    else if (card.edhrecRank < 2000)  score += 9;
    else if (card.edhrecRank < 5000)  score += 6;
    else if (card.edhrecRank < 10000) score += 3;
  }

  // CMC efficiency bonus: low-cost cards with relevant types score higher
  const tl = card.typeLine ?? "";
  const isCreature = tl.includes("Creature");
  const isInstant  = tl.includes("Instant");
  const isSorcery  = tl.includes("Sorcery");

  if (card.cmc <= 2 && (isCreature || isInstant)) score += 4;
  else if (card.cmc <= 3 && (isCreature || isSorcery)) score += 2;

  // Planeswalkers are generically powerful
  if (tl.includes("Planeswalker")) score += 4;

  return Math.min(40, score);
}
