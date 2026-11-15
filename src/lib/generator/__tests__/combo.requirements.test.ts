import { describe, expect, it } from 'vitest';
import { deckComboBonus } from '../weights';
import { generateDeck } from '../generator';
import { getCommanderSpellbookCombos, parseStandardLegalCombos, type VerifiedCombo } from '../comboLookup';
import { db } from '../../db';
import type { CardRecord } from '../../types';
import type { DeckEntry } from '../../legality';
import type { GenerateOptions } from '../types';

const piece = (name: string) => ({ id: name, oracleId: name, name, typeLine: 'Creature', oracleText: '',
  cmc: 2, colorIdentityJson: '[]', keywordsJson: '[]', legalityStandard: 'legal', legalitiesJson: '{"standard":"legal"}' } as CardRecord);
const a = piece('A');
const b = piece('B');
const entries = (quantity: number): DeckEntry[] => [{ card: a, quantity, board: 'main' }, { card: b, quantity: 1, board: 'main' }];
const combo: VerifiedCombo = { id: 'two-a', cardOracleIds: ['A','B'], cardNames: ['A','B'], description: 'Package', explanation: 'Package', source: 'Commander Spellbook', requiredQuantities: { A: 2, B: 1 } };
const options = (value: VerifiedCombo): GenerateOptions => ({ engine: 'offline', archetype: 'Combo', colors: [], comboSynergyContext: { chains: [], verifiedCombos: [value] } });

describe('quantity-aware combo packages', () => {
  it('does not report a final package complete when a locked seed lacks required copies', () => {
    const seedA = { ...a, oracleText: 'Draw two cards.' };
    const seedB = { ...b, oracleText: 'Draw two cards.' };
    const result = generateDeck({ ...options(combo), optimizationIterations: 0, activeScenarios: [],
      seedEntries: [{ card: seedA, quantity: 1, board: 'main', quantityLocked: true }, { card: seedB, quantity: 1, board: 'main', quantityLocked: true }],
    }, [seedA, seedB]);
    expect(result.verifiedCombos).toEqual([]);
  });
  it('does not reuse a legal cached package after local legality changes', async () => {
    await db.commanderSpellbookCombos.clear();
    const payload = { results: { included: [{ id: 'cached', uses: [{ card: { oracleId: 'A' } }, { card: { oracleId: 'B' } }] }] } };
    const fetchImpl: typeof fetch = async () => new Response(JSON.stringify(payload), { status: 200 });
    expect(await getCommanderSpellbookCombos([a, b], fetchImpl)).toHaveLength(1);
    const banned = { ...b, legalityStandard: 'banned', legalitiesJson: '{"standard":"banned"}' } as CardRecord;
    expect(await getCommanderSpellbookCombos([a, banned], fetchImpl)).toEqual([]);
  });
  it('preserves required quantities and prerequisite prose from the external package record', () => {
    const parsed = parseStandardLegalCombos({ results: { included: [{ id: 'external',
      uses: [{ card: { oracleId: 'A' }, quantity: 2 }, { card: { oracleId: 'B' }, quantity: 1 }],
      easyPrerequisites: 'Ten mana available.',
    }] } }, [a, b]);
    expect(parsed).toHaveLength(1);
    expect(parsed[0].requiredQuantities).toEqual({ A: 2, B: 1 });
    expect(parsed[0].prerequisites).toBe('Ten mana available.');
    expect(deckComboBonus(entries(2), options(parsed[0]))).toBe(0);
  });
  it('does not assume written game-state prerequisites are satisfied by card membership', () => {
    const conditional = { ...combo, prerequisites: 'Ten mana available.' };
    expect(deckComboBonus(entries(2), options({ ...conditional, prerequisitesSatisfied: true }))).toBe(12);
    expect(deckComboBonus(entries(2), options(conditional))).toBe(0);
  });
  it('requires all requested copies rather than identity presence alone', () => {
    expect(deckComboBonus(entries(2), options(combo))).toBe(12);
    expect(deckComboBonus(entries(1), options(combo))).toBe(0);
  });
});
