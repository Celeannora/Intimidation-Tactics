import { describe, expect, it } from 'vitest';
import type { CardRecord } from '../../types';
import { generateDeck } from '../generator';
import { validateGenerationResult } from '../validation';
import type { DeckEntry } from '../../legality';
import type { GenerateOptions } from '../types';

function card(name: string, priceUsd: number): CardRecord {
  return { id: name, oracleId: name, name, cmc: 2, typeLine: 'Instant', oracleText: 'Draw two cards.',
    manaCost: '{2}', colorIdentityJson: '[]', keywordsJson: '[]', producedManaJson: '[]', rarity: 'common',
    power: null, toughness: null, legalityStandard: 'legal', legalitiesJson: '{"standard":"legal"}',
    priceUsd, gameChanger: 0, edhrecRank: null } as CardRecord;
}

describe('final generation acceptance validation', () => {
  it('does not accept a different mainboard size from the captured request', () => {
    const basic = { ...card('Wastes', 0), typeLine: 'Basic Land', cmc: 0 };
    const list: DeckEntry[] = [{ card: basic, quantity: 60, board: 'main' }];
    const opts: GenerateOptions = { engine: 'offline', archetype: 'Midrange', colors: [], mainboardSize: 60 };
    expect(validateGenerationResult(list, opts).legal).toBe(true);
    expect(validateGenerationResult(list, { ...opts, mainboardSize: 70 }).violations.some(v => v.rule === 'TARGET_SIZE')).toBe(true);
  });
  it('returns the effective pure score context used by the offline pipeline', () => {
    const seed = card('Seed draw', 0.1);
    const filler = card('Filler draw', 0.1);
    const result = generateDeck({ engine: 'offline', format: 'standard', archetype: 'Control', colors: [],
      optimizationIterations: 0, seedEntries: [{ card: seed, quantity: 1, board: 'main' }],
    }, [seed, filler]);
    expect(result).toHaveProperty('scoringOptions.seedSynergyContext');
    expect(result).toHaveProperty('scoringOptions.activeScenarios');
    expect(result.scoringOptions?.synergyAxes).toEqual(result.diagnostics.primaryAxes);
  });
  it('refuses a changed quantity-locked seed even when size and legality still pass', () => {
    const basic = { ...card('Wastes', 0), typeLine: 'Basic Land', cmc: 0 };
    const locked: DeckEntry = { card: basic, quantity: 60, board: 'main', quantityLocked: true };
    const opts: GenerateOptions = { engine: 'offline', archetype: 'Midrange', colors: [], seedEntries: [locked] };
    expect(validateGenerationResult([locked], opts).legal).toBe(true);
    const changed: DeckEntry[] = [{ ...locked, quantity: 59 }, { card: card('Replacement', 0), quantity: 1, board: 'main' }];
    expect(validateGenerationResult(changed, opts).violations.some(v => v.rule === 'LOCKED_QUANTITY')).toBe(true);
  });
  it('rejects an off-color final card while allowing the unchanged legal control', () => {
    const basic = { ...card('Wastes', 0), typeLine: 'Basic Land', cmc: 0 };
    const opts: GenerateOptions = { engine: 'offline', format: 'standard', archetype: 'Midrange', colors: ['W'] };
    const control: DeckEntry[] = [{ card: basic, quantity: 60, board: 'main' }];
    expect(validateGenerationResult(control, opts).legal).toBe(true);
    const red = { ...card('Red card', 0), colorIdentityJson: '["R"]' };
    const invalid: DeckEntry[] = [{ card: basic, quantity: 59, board: 'main' }, { card: red, quantity: 1, board: 'main' }];
    expect(validateGenerationResult(invalid, opts).violations.some(v => v.rule === 'COLOR_IDENTITY')).toBe(true);
  });
  it('treats an empty selected color set as colorless, not unrestricted', () => {
    const basic = { ...card('Wastes', 0), typeLine: 'Basic Land', cmc: 0 };
    const opts: GenerateOptions = { engine: 'offline', format: 'standard', archetype: 'Midrange', colors: [] };
    expect(validateGenerationResult([{ card: basic, quantity: 60, board: 'main' }], opts).legal).toBe(true);
    const red = { ...card('Red card', 0), colorIdentityJson: '["R"]' };
    const list: DeckEntry[] = [{ card: basic, quantity: 59, board: 'main' }, { card: red, quantity: 1, board: 'main' }];
    expect(validateGenerationResult(list, opts).violations.map(v => v.rule)).toEqual(['COLOR_IDENTITY']);
  });
  it.each(['not-json', '{}', 'null', '[null]', '["C"]', '["UR"]', '[""]'])(
    'rejects malformed identity %s for a colorless request', (colorIdentityJson) => {
      const basic = { ...card('Wastes', 0), typeLine: 'Basic Land', cmc: 0 };
      const opts: GenerateOptions = { engine: 'offline', format: 'standard', archetype: 'Midrange', colors: [] };
      expect(validateGenerationResult([{ card: basic, quantity: 60, board: 'main' }], opts).legal).toBe(true);
      const invalid: DeckEntry[] = [{ card: basic, quantity: 59, board: 'main' },
        { card: { ...card('Malformed identity', 0), colorIdentityJson }, quantity: 1, board: 'main' }];
      expect(validateGenerationResult(invalid, opts).violations.map(v => v.rule)).toEqual(['INVALID_COLOR_IDENTITY']);
    });
  it('expands an empty allowed set only with explicit seed color permission', () => {
    const basic = { ...card('Wastes', 0), typeLine: 'Basic Land', cmc: 0 };
    // Explicitly empty mana-source metadata cannot exempt a colored card.
    const red = { ...card('Red seed', 0), colorIdentityJson: '["R"]', producedManaJson: '[]' };
    const seed: DeckEntry = { card: red, quantity: 1, board: 'main' };
    const list: DeckEntry[] = [{ card: basic, quantity: 59, board: 'main' }, seed];
    const opts: GenerateOptions = { engine: 'offline', format: 'standard', archetype: 'Midrange', colors: [], seedEntries: [seed] };
    expect(validateGenerationResult(list, { ...opts, allowSeedColorExpansion: true }).legal).toBe(true);
    expect(validateGenerationResult(list, { ...opts, allowSeedColorExpansion: false }).violations.map(v => v.rule)).toEqual(['COLOR_IDENTITY']);
    expect(validateGenerationResult(list, opts).violations.map(v => v.rule)).toEqual(['COLOR_IDENTITY']);
    const malformed = { ...seed, card: { ...red, colorIdentityJson: '{}' } };
    expect(validateGenerationResult([list[0], malformed], { ...opts, seedEntries: [malformed], allowSeedColorExpansion: true })
      .violations.map(v => v.rule)).toEqual(['INVALID_COLOR_IDENTITY']);
  });
  it('reports a seed that violates the enabled per-card price limit after all construction stages', () => {
    const expensive = card('Locked expensive draw', 50);
    const cheap = card('Affordable draw', 0.1);
    const result = generateDeck({ engine: 'offline', format: 'standard', archetype: 'Control', colors: [],
      maxCardPriceUsd: 1, optimizationIterations: 0, activeScenarios: [],
      seedEntries: [{ card: expensive, quantity: 1, board: 'main', quantityLocked: true }],
    }, [expensive, cheap]);
    expect(result.validation?.violations.some(v => v.rule === 'MAX_CARD_PRICE')).toBe(true);
    expect(result.validation?.legal).toBe(false);
  });
});
