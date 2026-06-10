import type { CardRecord } from "../types";
import { assignRoles } from "../roles";

/**
 * Compress a CardRecord to a compact text line (~60–80 tokens) for LLM prompts.
 *
 * Format:
 *   <name> | <manaCost> CMC<n> | <typeLine> | [<roles>] | "<oracle>" | $<price>
 */
export function digestCard(card: CardRecord): string {
  const roles = assignRoles(card).join(",") || "—";
  const oracle = (card.oracleText ?? "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 140);
  const price = card.priceUsd != null ? `$${card.priceUsd.toFixed(2)}` : "—";
  const cost = card.manaCost ?? "—";
  return `${card.name} | ${cost} CMC${card.cmc} | ${card.typeLine} | [${roles}] | "${oracle}" | ${price}`;
}

export function digestPool(cards: CardRecord[], limit: number): string {
  return cards.slice(0, limit).map(digestCard).join("\n");
}