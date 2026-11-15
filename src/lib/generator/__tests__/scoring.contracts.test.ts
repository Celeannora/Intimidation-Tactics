import { describe, expect, it } from 'vitest';
import { deckScore, buildScoreBreakdown, manaBaseCoverage, cardScoreDetail } from '../weights';
import type { CardRecord } from '../../types';
import type { DeckEntry } from '../../legality';
import type { GenerateOptions } from '../types';
import { ARCHETYPE_PROFILES, computeProfileLoss } from '../../config/archetypeProfiles';
import { SEED_ROLE_TARGETS } from '../seedSynergy';

function card(name: string, overrides: Partial<CardRecord> = {}): CardRecord {
  return { id: name, oracleId: name, name, cmc: 2, typeLine: 'Creature — Test', oracleText: 'Draw a card.',
    manaCost: '{2}', colorIdentityJson: '[]', keywordsJson: '[]', producedManaJson: '[]', rarity: 'common',
    power: '2', toughness: '2', legalityStandard: 'legal', legalitiesJson: '{"standard":"legal"}',
    priceUsd: 1, gameChanger: 0, edhrecRank: null, ...overrides } as CardRecord;
}
const options: GenerateOptions = { engine: 'offline', format: 'standard', archetype: 'Midrange', colors: [], activeScenarios: [] };
const main: DeckEntry[] = [
  { card: card('Main spell'), quantity: 4, board: 'main' },
  { card: card('Wastes', { typeLine: 'Basic Land', cmc: 0, oracleText: '{T}: Add {C}.', manaCost: '' }), quantity: 56, board: 'main' },
];

describe('generation score contracts', () => {
  it('uses explicit inferred mechanical axes consistently without requiring a UI keyword mapping', () => {
    const payoff = card('Life payoff', { oracleText: 'Whenever you gain life, put a +1/+1 counter on this creature.' });
    const source: DeckEntry = { card: card('Life source', { oracleText: 'Lifelink', keywordsJson: '["Lifelink"]' }), quantity: 4, board: 'main' };
    const context: GenerateOptions = { ...options, synergyAxes: ['lifegain'] };
    expect(cardScoreDetail(payoff, [source], context, 3).directionalContribution).toBeGreaterThan(0);
  });
  it('exports the same finite rejection penalty that the deck objective actually uses', () => {
    const vetoed = card('Vetoed', { oracleText: '' });
    const list: DeckEntry[] = [{ card: vetoed, quantity: 1, board: 'main' }, { ...main[1], quantity: 59 }];
    const opts: GenerateOptions = { ...options, seedSynergyContext: { seedPackage: [{ name: 'Vetoed', quantity: 1 }], resourceSpec: null, anthemSpec: null, roleTargets: SEED_ROLE_TARGETS } };
    const report = buildScoreBreakdown(list, opts, 3);
    expect(report.cardScores[0].perCopyScore).toBe(-1000);
    expect(report.cardScores.reduce((sum, e) => sum + e.contribution, 0)).toBe(report.totals.cardScoreSum);
  });
  it('exports only the mainboard and its context in the breakdown', () => {
    const side: DeckEntry = { card: card('Side payoff', { oracleText: 'Whenever you draw a card, create a token.' }), quantity: 4, board: 'side' };
    expect(buildScoreBreakdown([...main, side], options, 3)).toEqual(buildScoreBreakdown(main, options, 3));
  });
  it('scales role-profile loss to the actual mainboard size', () => {
    const lands: DeckEntry[] = [{ ...main[1], quantity: 50 }, { card: card('Island', { typeLine: 'Basic Land', cmc: 0, manaCost: '' }), quantity: 50, board: 'main' }];
    const expected = computeProfileLoss({}, { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 }, 100, ARCHETYPE_PROFILES.Midrange, 100);
    expect(deckScore(lands, { ...options, format: 'commander' }, 3).profileLoss).toBe(expected);
  });
  it('uses actual produced mana rather than color identity for source coverage', () => {
    const rainbow: DeckEntry[] = Array.from({ length: 14 }, (_, i) => ({
      card: card(`Rainbow ${i}`, { typeLine: 'Land', cmc: 0, producedManaJson: '["W","U","B","R","G"]', colorIdentityJson: '[]' }),
      quantity: 1, board: 'main',
    }));
    const white: DeckEntry = { card: card('White spell', { cmc: 1, manaCost: '{W}', colorIdentityJson: '["W"]' }), quantity: 4, board: 'main' };
    const wastes: DeckEntry = { ...main[1], quantity: 42 };
    expect(manaBaseCoverage([...rainbow, white, wastes])).toBe(1);
  });
  it('exports all additive card and deck terms for exact explanations', () => {
    const breakdown = buildScoreBreakdown(main, options, 3);
    expect(breakdown.cardScores[0]).toHaveProperty('preferCardBonus');
    expect(breakdown.cardScores[0]).toHaveProperty('broadTagBonus');
    expect(breakdown.cardScores[0]).toHaveProperty('seedAdjustment', 0);
    expect(breakdown.totals).toHaveProperty('metaPerformanceContribution', 0);
    expect(breakdown.totals).toHaveProperty('scenarioConsistencyContribution', 0);
  });
  it('scores the same mainboard identically with or without sideboard cards', () => {
    const side: DeckEntry = { card: card('Side engine', { oracleText: 'Create a token. Whenever a token enters, draw a card.' }), quantity: 4, board: 'side' };
    expect(deckScore([...main, side], options, 3)).toEqual(deckScore(main, options, 3));
  });
});
