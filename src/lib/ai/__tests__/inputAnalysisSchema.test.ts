import { describe, expect, it } from 'vitest';
import { validateInputCardBlueprint, validateInputAnalysisRequest, INPUT_ANALYSIS_JSON_SCHEMA, MAX_INPUT_ANALYSIS_CARDS } from '../inputAnalysisSchema';
import type { InputAnalysisRequest, InputCardBlueprint } from '../inputAnalysisTypes';
import type { CardRecord } from '../../types';

export function request(): InputAnalysisRequest {
  return { inputs: [{ card: { id: 'print-a', oracleId: 'oracle-a', name: 'Angel', manaCost: '{W}', cmc: 1, typeLine: 'Creature — Angel', oracleText: 'Flying', cardFacesJson: null, colorIdentityJson: '["W"]', colorsJson: '["W"]', legalityStandard: 'legal', priceUsd: 2 } as CardRecord, quantity: 2, required: true, quantityLocked: true }], format: 'standard', mainboardSize: 60, colors: ['W'], allowColorExpansion: false, datasetVersion: 'test-1' };
}
export function blueprint(): InputCardBlueprint {
  return { schemaVersion: 1, title: 'Angels', strategy: 'Build a lifegain midrange shell.', rationale: 'Advice, not measured performance.', archetype: 'Midrange', secondaryArchetypes: ['Control'], themes: ['lifegain'], colors: ['W'], speed: 'midrange', spellRatio: 'creature-heavy', averageManaValue: 3, landCountTarget: 24, curveTargets: { '0': 0, '1': 4, '2': 8, '3': 10, '4': 8, '5': 4, '6+': 2 }, roleTargets: { threats: 30, removal: 12, boardWipes: 2, counterspells: 0, cardDraw: 10, ramp: 4, enablers: 20, payoffs: 15 }, inputs: [{ oracleId: 'oracle-a', role: 'Threat', recommendedQuantity: 2, support: ['Life gain'], rationale: 'Preserve the locked pair.' }], interactions: [], alternatives: [{ title: 'Control', tradeoffs: 'Slower clock.' }], uncertainties: ['Needs testing.'] };
}
describe('input analysis schema', () => {
  it.each([
    ['curve total', (v: InputCardBlueprint) => {v.curveTargets['1']++;}],
    ['locked quantity', (v: InputCardBlueprint) => {v.inputs[0].recommendedQuantity=3;}],
    ['missing input', (v: InputCardBlueprint) => {v.inputs=[];}],
    ['unknown reference', (v: InputCardBlueprint) => {v.interactions=[{oracleIds:['unknown'],explanation:'test',conditions:[]}];}],
    ['unapproved colors', (v: InputCardBlueprint) => {v.colors=['W','B'];}],
    ['missing required color', (v: InputCardBlueprint) => {v.colors=[];}],
    ['null', (v: InputCardBlueprint) => {v.strategy=null as unknown as string;}],
    ['nonfinite', (v: InputCardBlueprint) => {v.averageManaValue=NaN;}],
    ['sparse array', (v: InputCardBlueprint) => {v.uncertainties=new Array(1);}],
  ])('rejects %s after a complete positive control', (_label, mutate) => {
    const value=blueprint(); expect(()=>validateInputCardBlueprint(value,request())).not.toThrow();
    mutate(value); expect(()=>validateInputCardBlueprint(value,request())).toThrow();
  });
  it('accepts six-card and 250-card requests, then rejects requests beyond the raised bound', () => {
    const makeRequest = (count: number): InputAnalysisRequest => {
      const base = request();
      return { ...base, inputs: Array.from({ length: count }, (_, i) => ({ ...base.inputs[0], card: { ...base.inputs[0].card, id: `print-${i}`, oracleId: `oracle-${i}`, name: `Angel ${i}` }, required: false, quantityLocked: false })) };
    };
    expect(MAX_INPUT_ANALYSIS_CARDS).toBe(250);
    const expanded = makeRequest(6);
    expect(() => validateInputAnalysisRequest(expanded)).not.toThrow();
    const value = blueprint();
    value.inputs = expanded.inputs.map(input => ({ ...value.inputs[0], oracleId: input.card.oracleId, recommendedQuantity: 1 }));
    expect(validateInputCardBlueprint(value, expanded).inputs).toHaveLength(6);
    const maximum = makeRequest(250);
    const maximumBlueprint = blueprint();
    maximumBlueprint.inputs = maximum.inputs.map(input => ({ ...maximumBlueprint.inputs[0], oracleId: input.card.oracleId, recommendedQuantity: 1 }));
    maximumBlueprint.interactions = [{ oracleIds: maximum.inputs.map(input => input.card.oracleId), explanation: 'All supplied identities.', conditions: [] }];
    expect(validateInputCardBlueprint(maximumBlueprint, maximum).inputs).toHaveLength(250);
    expect(() => validateInputAnalysisRequest(makeRequest(251))).toThrow('Input analysis accepts 1–250 input cards');
  });
  it('accepts complete usable advice with overlapping role targets and produces a defensive copy', () => {
    const value = blueprint();
    expect(validateInputCardBlueprint(value, request())).toEqual(value);
    expect(validateInputCardBlueprint(value, request())).not.toBe(value);
    expect(INPUT_ANALYSIS_JSON_SCHEMA.strict).toBe(true);
  });
});
