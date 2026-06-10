/**
 * powerScore.ts — Raw card quality signal (0–40)
 *
 * Heuristics based on available CardRecord fields:
 * EDHREC rank, rarity, game_changer flag, cmc, type line.
 */

import type { CardRecord } from "./types";

/**
 * Returns a raw power score 0–40.
 * Higher = stronger card in isolation.
 */
export function computePowerScore(card: CardRecord): number {
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
