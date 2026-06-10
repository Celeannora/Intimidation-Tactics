import type { CardRecord, ManaColor } from "../types";
import type { GenerateOptions } from "./types";
import { cardMatchesTribe, cardReferencesTribe } from "./synergyModel";
import { isCardLegalInFormat } from "../formats";

/**
 * Filter the master card list down to the legal candidate pool for a generation run:
 *  - Standard-legal and not banned
 *  - Color identity ⊆ chosen colors (colorless allowed)
 *  - Price below the per-card cap (if set)
 *
 * The result is sorted: gameChanger first, then by edhrecRank ascending (lower = more played).
 */
export function buildPool(allCards: CardRecord[], options: GenerateOptions): CardRecord[] {
  const allowed = new Set<ManaColor>(options.colors);

  const filtered = allCards.filter((card) => {
    if (!isCardLegalInFormat(card, options.format)) return false;

    const identity = parseColorIdentity(card.colorIdentityJson);
    if (!identity.every((c) => allowed.has(c))) return false;

    if (
      options.maxCardPriceUsd != null &&
      card.priceUsd != null &&
      card.priceUsd > options.maxCardPriceUsd
    ) {
      return false;
    }

    if (options.tribalSupport?.mode === "exclusive" && !isAllowedByExclusiveTribal(card, options)) {
      return false;
    }

    return true;
  });

  return filtered.sort((a, b) => {
    if (a.gameChanger !== b.gameChanger) return b.gameChanger - a.gameChanger;
    const rankA = a.edhrecRank ?? Number.POSITIVE_INFINITY;
    const rankB = b.edhrecRank ?? Number.POSITIVE_INFINITY;
    return rankA - rankB;
  });
}

function isAllowedByExclusiveTribal(card: CardRecord, options: GenerateOptions): boolean {
  const tribe = options.tribalSupport?.tribe;
  if (!tribe || card.typeLine.includes("Land")) return true;
  if (cardMatchesTribe(card, tribe) || cardReferencesTribe(card, tribe)) return true;

  // Keep essential non-tribal glue so "exclusive" tribal decks still function:
  // interaction, card selection/draw, ramp/fixing, and sweepers.
  const oracle = card.oracleText ?? "";
  return /destroy target|exile target|counter target|deals? \d+ damage|return target .* owner|draw .* cards?|look at the top|search your library|add \{|destroy all|exile all/i.test(oracle);
}

function parseColorIdentity(json: string): ManaColor[] {
  try {
    const parsed = JSON.parse(json);
    if (Array.isArray(parsed)) return parsed as ManaColor[];
  } catch {
    /* fall through */
  }
  return [];
}