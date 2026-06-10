import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { GenerateOptions } from "./types";
import { rateSideboardCard } from "../sideboardPlan";
import { buildPool } from "./pool";

/** Default meta archetypes the sideboard targets. Order ≈ field share. */
const META_ARCHETYPES = ["Aggro", "Midrange", "Control", "Combo"] as const;

const SIDEBOARD_SIZE = 15;
const SLOT_PER_ARCH = Math.ceil(SIDEBOARD_SIZE / META_ARCHETYPES.length);

/**
 * Heuristic 15-card sideboard. For each meta archetype, pick the top-scoring
 * `rateSideboardCard` candidates from the pool that aren't already maindecked.
 */
export function generateSideboard(
  mainboard: DeckEntry[],
  allCards: CardRecord[],
  options: GenerateOptions
): DeckEntry[] {
  const inDeck = new Set(mainboard.map((e) => e.card.oracleId));
  const pool = buildPool(allCards, options).filter(
    (c) => !c.typeLine.includes("Land") && !inDeck.has(c.oracleId)
  );

  const taken = new Set<string>();
  const out: DeckEntry[] = [];

  for (const arch of META_ARCHETYPES) {
    const ranked = pool
      .filter((c) => !taken.has(c.oracleId))
      .map((c) => ({ c, score: rateSideboardCard(c, arch) }))
      .filter((p) => p.score > 0)
      .sort((a, b) => b.score - a.score);

    let placed = 0;
    for (const { c } of ranked) {
      if (placed >= SLOT_PER_ARCH) break;
      const remainingSpace = SIDEBOARD_SIZE - out.reduce((s, e) => s + e.quantity, 0);
      if (remainingSpace <= 0) break;
      const qty = Math.min(2, remainingSpace, SLOT_PER_ARCH - placed);
      out.push({ card: c, quantity: qty, board: "side" });
      taken.add(c.oracleId);
      placed += qty;
    }
  }

  // Pad to exactly 15 with the highest-scoring remaining pool cards if needed.
  let total = out.reduce((s, e) => s + e.quantity, 0);
  if (total < SIDEBOARD_SIZE) {
    const fillers = pool
      .filter((c) => !taken.has(c.oracleId))
      .slice(0, SIDEBOARD_SIZE - total);
    for (const c of fillers) {
      out.push({ card: c, quantity: 1, board: "side" });
      taken.add(c.oracleId);
      total++;
      if (total >= SIDEBOARD_SIZE) break;
    }
  }

  return out;
}