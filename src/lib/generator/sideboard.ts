import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { GenerateOptions } from "./types";
import { rateSideboardCard } from "../sideboardPlan";
import { buildPool } from "./pool";
import { getFormatRules } from "../formats";
import { maxCopiesForCard } from "../legality";

/** Default meta archetypes the sideboard targets. Order ≈ field share. */
const META_ARCHETYPES = ["Aggro", "Midrange", "Control", "Tempo", "Combo", "Ramp", "Prison"] as const;

/**
 * Heuristic format-sized sideboard. For each meta archetype, pick the top-scoring
 * `rateSideboardCard` candidates from the pool that aren't already maindecked.
 */
export function generateSideboard(
  mainboard: DeckEntry[],
  allCards: CardRecord[],
  options: GenerateOptions
): DeckEntry[] {
  const sideboardSize = getFormatRules(options.format).sideboardSize ?? 0;
  if (sideboardSize === 0) return [];
  const slotsPerArchetype = Math.ceil(sideboardSize / META_ARCHETYPES.length);
  const inDeck = new Set(mainboard.map((e) => e.card.oracleId));
  const mainboardCopies = new Map<string, number>();
  for (const entry of mainboard) {
    mainboardCopies.set(entry.card.oracleId, (mainboardCopies.get(entry.card.oracleId) ?? 0) + entry.quantity);
  }
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
      if (placed >= slotsPerArchetype) break;
      const remainingSpace = sideboardSize - out.reduce((s, e) => s + e.quantity, 0);
      if (remainingSpace <= 0) break;
      const remainingCopies = maxCopiesForCard(c, options.format) - (mainboardCopies.get(c.oracleId) ?? 0);
      const qty = Math.min(2, remainingCopies, remainingSpace, slotsPerArchetype - placed);
      if (qty <= 0) continue;
      out.push({ card: c, quantity: qty, board: "side" });
      taken.add(c.oracleId);
      placed += qty;
    }
  }

  // Pad to the format's configured size with remaining eligible cards if needed.
  let total = out.reduce((s, e) => s + e.quantity, 0);
  if (total < sideboardSize) {
    const fillers = pool
      .filter((c) => !taken.has(c.oracleId))
      .slice(0, sideboardSize - total);
    for (const c of fillers) {
      const remainingCopies = maxCopiesForCard(c, options.format) - (mainboardCopies.get(c.oracleId) ?? 0);
      if (remainingCopies <= 0) continue;
      const quantity = Math.min(1, remainingCopies, sideboardSize - total);
      out.push({ card: c, quantity, board: "side" });
      taken.add(c.oracleId);
      total += quantity;
      if (total >= sideboardSize) break;
    }
  }

  return out;
}