import type { InputAnalysisRequest, InputCardBlueprint } from '../inputAnalysisTypes';
import type { CardRecord } from '../../types';
export function request(): InputAnalysisRequest {
  return { inputs: [{ card: { id: 'print-a', oracleId: 'oracle-a', name: 'Angel', manaCost: '{W}', cmc: 1, typeLine: 'Creature — Angel', oracleText: 'Flying', cardFacesJson: null, colorIdentityJson: '["W"]', colorsJson: '["W"]', legalityStandard: 'legal', priceUsd: 2 } as CardRecord, quantity: 2, required: true, quantityLocked: true }], format: 'standard', mainboardSize: 60, colors: ['W'], allowColorExpansion: false, datasetVersion: 'test-1' };
}
export function blueprint(): InputCardBlueprint {
  return { schemaVersion: 1, title: 'Angels', strategy: 'Build a lifegain midrange shell.', rationale: 'Advice, not measured performance.', archetype: 'Midrange', secondaryArchetypes: ['Control'], themes: ['lifegain'], colors: ['W'], speed: 'midrange', spellRatio: 'creature-heavy', averageManaValue: 3, landCountTarget: 24, curveTargets: { '0': 0, '1': 4, '2': 8, '3': 10, '4': 8, '5': 4, '6+': 2 }, roleTargets: { threats: 30, removal: 12, boardWipes: 2, counterspells: 0, cardDraw: 10, ramp: 4, enablers: 20, payoffs: 15 }, inputs: [{ oracleId: 'oracle-a', role: 'Threat', recommendedQuantity: 2, support: ['Life gain'], rationale: 'Preserve the locked pair.' }], interactions: [], alternatives: [{ title: 'Control', tradeoffs: 'Slower clock.' }], uncertainties: ['Needs testing.'] };
}
