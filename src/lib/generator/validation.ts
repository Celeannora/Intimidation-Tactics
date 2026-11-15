import { validateDeck, type DeckEntry, type ValidationResult } from '../legality';
import type { GenerateOptions } from './types';
import { getFormatRules } from '../formats';

export function generationMainboardSize(options: GenerateOptions): number {
  const rules = getFormatRules(options.format);
  const requested = options.maxMainboardSize ?? options.mainboardSize ?? rules.defaultMainboardSize;
  if (!Number.isFinite(requested)) return rules.defaultMainboardSize;
  return Math.max(rules.minMainboardSize, Math.min(rules.maxMainboardSize, Math.round(requested)));
}

/** Final acceptance report; unlike pool filtering, this also sees seeds and lands. */
export function validateGenerationResult(entries: DeckEntry[], options: GenerateOptions): ValidationResult {
  const result = validateDeck(entries, options.format);
  const violations = [...result.violations];
  const target = generationMainboardSize(options);
  if (result.mainCount !== target) violations.push({ rule: 'TARGET_SIZE', message: `Generated mainboard has ${result.mainCount} cards; requested ${target}.` });
  for (const seed of options.seedEntries ?? []) {
    if (!seed.quantityLocked) continue;
    const actual = entries.filter(e => e.board === seed.board && e.card.oracleId === seed.card.oracleId).reduce((sum, e) => sum + e.quantity, 0);
    if (actual !== seed.quantity) violations.push({ rule: 'LOCKED_QUANTITY', message: `${seed.card.name} must retain its locked quantity ${seed.quantity}; received ${actual}.`, cardNames: [seed.card.name] });
  }
  {
    const allowed = new Set<string>(options.colors);
    if (options.allowSeedColorExpansion) {
      for (const entry of options.seedEntries ?? []) {
        try {
          const identity: unknown = JSON.parse(entry.card.colorIdentityJson);
          if (Array.isArray(identity)) for (const color of identity) if (typeof color === 'string' && 'WUBRG'.includes(color) && color.length === 1) allowed.add(color);
        } catch { /* The final card pass reports invalid identities. */ }
      }
    }
    const offColor: string[] = [];
    const invalidIdentity: string[] = [];
    for (const entry of entries) {
      try {
        const identity: unknown = JSON.parse(entry.card.colorIdentityJson);
        if (!Array.isArray(identity) || identity.some(c => typeof c !== 'string' || c.length !== 1 || !'WUBRG'.includes(c))) throw new Error('Invalid identity');
        if (identity.some(c => !allowed.has(c as string))) offColor.push(entry.card.name);
      } catch { invalidIdentity.push(entry.card.name); }
    }
    if (offColor.length) violations.push({ rule: 'COLOR_IDENTITY', message: `Cards outside selected colors: ${[...new Set(offColor)].join(', ')}`, cardNames: [...new Set(offColor)] });
    if (invalidIdentity.length) violations.push({ rule: 'INVALID_COLOR_IDENTITY', message: `Cannot validate color identity: ${[...new Set(invalidIdentity)].join(', ')}`, cardNames: [...new Set(invalidIdentity)] });
  }
  if (options.maxCardPriceUsd != null) {
    const overPrice = entries.filter(e => e.card.priceUsd != null && e.card.priceUsd > options.maxCardPriceUsd!).map(e => e.card.name);
    if (overPrice.length) violations.push({ rule: 'MAX_CARD_PRICE', message: `Cards exceed the per-card price limit: ${[...new Set(overPrice)].join(', ')}`, cardNames: [...new Set(overPrice)] });
  }
  return { ...result, violations, legal: violations.length === 0 };
}
