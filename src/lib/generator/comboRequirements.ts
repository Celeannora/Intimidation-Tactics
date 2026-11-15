import type { DeckEntry } from '../legality';
import type { VerifiedCombo } from './comboLookup';

/** Structural package check, not a game-rules or infinite-combo proof. */
export function isComboPackagePresent(combo: VerifiedCombo, entries: DeckEntry[]): boolean {
  if (!combo.cardOracleIds.length) return false;
  if (combo.prerequisites?.trim() && combo.prerequisitesSatisfied !== true) return false;
  const counts = new Map<string, number>();
  for (const entry of entries) {
    if (entry.board === 'main') counts.set(entry.card.oracleId, (counts.get(entry.card.oracleId) ?? 0) + entry.quantity);
  }
  return combo.cardOracleIds.every(id => {
    const required = combo.requiredQuantities?.[id] ?? 1;
    return Number.isSafeInteger(required) && required > 0 && required <= 99 && (counts.get(id) ?? 0) >= required;
  });
}
