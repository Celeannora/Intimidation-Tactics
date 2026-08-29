import type { CardRecord } from "./types";
import type { ConstructedFormat } from "./formats";
import { getCardLegality, getFormatRules } from "./formats";

export const BASIC_LAND_NAMES = new Set([
  "Island", "Plains", "Swamp", "Mountain", "Forest", "Wastes"
]);

/**
 * Returns true if the card's Oracle text contains a "A deck can have any
 * number of cards named …" clause (e.g. Rat Colony, Dragon's Approach,
 * Persistent Petitioners, Relentless Rats, etc.).
 * Basic lands always satisfy this as well.
 */
export function allowsAnyNumberOfCopies(card: CardRecord): boolean {
  if (BASIC_LAND_NAMES.has(card.name)) return true;
  const text = card.oracleText ?? "";
  return /a deck can have any number of cards named/i.test(text);
}

/**
 * Returns the maximum number of copies of this card that may appear
 * across mainboard + sideboard combined:
 *   - 99  if the card is a basic land OR has the "any number" clause
 *   - 1   if the format is restricted-list-aware (Vintage) and this specific
 *         card is on that format's restricted list
 *   - rules.maxCopies otherwise
 */
export function maxCopiesForCard(card: CardRecord, format?: ConstructedFormat): number {
  const rules = getFormatRules(format);
  if (allowsAnyNumberOfCopies(card)) return 99;
  // Vintage restricts specific cards to a single copy regardless of the
  // format's blanket 4-of cap. A restricted card's own legality string is
  // "restricted" rather than "legal".
  if (rules.restrictedListAware && getCardLegality(card, format) === "restricted") return 1;
  return rules.maxCopies;
}

export interface DeckEntry {
  card: CardRecord;
  quantity: number;
  board: "main" | "side";
}

export interface ValidationViolation {
  rule: string;
  message: string;
  cardNames?: string[];
}

export interface ValidationResult {
  legal: boolean;
  mainCount: number;
  sideCount: number;
  violations: ValidationViolation[];
}

export function validateDeck(entries: DeckEntry[], format?: ConstructedFormat): ValidationResult {
  const rules = getFormatRules(format);
  const main = entries.filter(e => e.board === "main");
  const side = entries.filter(e => e.board === "side");

  const mainCount = main.reduce((s, e) => s + e.quantity, 0);
  const sideCount = side.reduce((s, e) => s + e.quantity, 0);
  const violations: ValidationViolation[] = [];

  if (mainCount < rules.minMainboardSize) {
    violations.push({
      rule: "MIN_60",
      message: `Mainboard has ${mainCount} cards — minimum for ${rules.label} is ${rules.minMainboardSize}.`
    });
  }

  if (mainCount > rules.defaultMainboardSize) {
    violations.push({
      rule: "OVER_60",
      message: mainCount > rules.maxMainboardSize
        ? `Mainboard has ${mainCount} cards. Maximum for ${rules.label} is ${rules.maxMainboardSize}.`
        : `Mainboard has ${mainCount} cards. ${rules.defaultMainboardSize} is the recommended ${rules.label} deck size — extra cards dilute your best draws.`
    });
  }

  if (rules.sideboardSize == null && sideCount > 0) {
    violations.push({
      rule: "SIDE_SIZE",
      message: `${rules.label} decks do not use a sideboard in this builder mode.`
    });
  } else if (rules.sideboardSize != null && sideCount > 0 && sideCount !== rules.sideboardSize) {
    violations.push({
      rule: "SIDE_SIZE",
      message: `Sideboard has ${sideCount} cards — must be exactly 0 or ${rules.sideboardSize}.`
    });
  }

  const oracleCount = new Map<string, { card: CardRecord; total: number }>();
  for (const entry of entries) {
    // Cards that allow any number of copies (basics + "A deck can have any number…" text)
    if (allowsAnyNumberOfCopies(entry.card)) continue;
    const existing = oracleCount.get(entry.card.oracleId);
    if (existing) {
      existing.total += entry.quantity;
    } else {
      oracleCount.set(entry.card.oracleId, { card: entry.card, total: entry.quantity });
    }
  }

  const overLimit = [...oracleCount.values()]
    .filter(v => v.total > maxCopiesForCard(v.card, format))
    .map(v => v.card.name);

  if (overLimit.length > 0) {
    violations.push({
      rule: "MAX_COPIES",
      message: `Too many copies for ${rules.label}: ${overLimit.join(", ")}`,
      cardNames: overLimit
    });
  }

  const illegalCards = entries
    .filter(e => getCardLegality(e.card, format) !== "legal")
    .map(e => e.card.name);

  if (illegalCards.length > 0) {
    violations.push({
      rule: "NOT_LEGAL",
      message: `Cards not legal in ${rules.label}: ${[...new Set(illegalCards)].join(", ")}`,
      cardNames: [...new Set(illegalCards)]
    });
  }

  const bannedCards = entries
    .filter(e => getCardLegality(e.card, format) === "banned")
    .map(e => e.card.name);

  if (bannedCards.length > 0) {
    const uniq = [...new Set(bannedCards)];
    violations.push({
      rule: "BANNED",
      message: `Banned in ${rules.label}: ${uniq.join(", ")}`,
      cardNames: uniq
    });
  }

  return {
    legal: violations.length === 0,
    mainCount,
    sideCount,
    violations
  };
}
