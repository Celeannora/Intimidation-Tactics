import { describe, expect, it } from 'vitest';
import type { CardRecord } from '../../types';
import type { DeckEntry } from '../../legality';
import type { GenerateOptions } from '../types';
import { generateDeck } from '../generator';
import { deckScore,buildScoreBreakdown } from '../weights';
import { optimize,makeRng } from '../optimizer';
import { validateDeck } from '../../legality';

function card(name: string, mv = 2, land = false): CardRecord {
  return { id: name, oracleId: name, name, lang: 'en', layout: 'normal', cardFacesJson: null,
    manaCost: land ? '' : `{${mv}}`, cmc: land ? 0 : mv, colorsJson: '[]', colorIdentityJson: '[]',
    typeLine: land ? 'Basic Land' : 'Creature — Test', oracleText: '', keywordsJson: '[]',
    power: land ? null : '3', toughness: land ? null : '3', loyalty: null, producedManaJson: '[]',
    legalityStandard: 'legal', legalityFuture: 'legal', bannedInStandard: 0,
    legalitiesJson: '{"standard":"legal"}', setCode: 'TST', setName: 'Test', rarity: 'common',
    priceUsd: 0, gameChanger: 0, searchText: name, importedAt: '' } as CardRecord;
}
const options: GenerateOptions = { engine: 'offline', format: 'standard', archetype: 'Midrange',
  colors: [], mainboardSize: 60, optimizationIterations: 0, activeScenarios: [] };
const pool = [...Array.from({ length: 32 }, (_, i) => card(`Candidate ${i}`)), card('Wastes', 0, true)];
const lands = (entries: DeckEntry[]) => entries.filter(e => e.board === 'main' && e.card.typeLine.includes('Land')).reduce((n,e) => n + e.quantity, 0);

describe('soft composition targets', () => {
  it('the actual optimizer improves a feasible curve objective without breaking legality',()=>{
    const varied=[...Array.from({length:16},(_,i)=>card(`Cheap ${i}`,1)),...Array.from({length:16},(_,i)=>card(`Heavy ${i}`,5)),card('Wastes',0,true)];
    const curve={ '0':0,'1':36,'2':0,'3':0,'4':0,'5':0,'6+':0 };
    const start=generateDeck({...options,landCountTarget:24,curveTargets:{...curve,'1':0,'5':36}},varied);
    const desired={...options,landCountTarget:24,curveTargets:curve};
    const before=deckScore(start.entries,desired,3);
    const improved=optimize(start.entries,{pool:varied,options:desired,targetAvgCmc:3,locked:new Set<string>(),iterations:40,rng:makeRng(123)});
    expect(improved.steps).toBeGreaterThan(0);expect(deckScore(improved.entries,desired,3).compositionPenalty).toBeLessThan(before.compositionPenalty!);
    expect(validateDeck(improved.entries,'standard').legal).toBe(true);
  });
  it('keeps locked quantities and explains infeasible soft targets',()=>{
    const seed=card('Locked',5);
    const result=generateDeck({...options,landCountTarget:24,curveTargets:{'0':0,'1':36,'2':0,'3':0,'4':0,'5':0,'6+':0},seedEntries:[{card:seed,quantity:4,board:'main',quantityLocked:true}]},[...pool,seed]);
    expect(result.entries.find(e=>e.card.oracleId==='Locked')?.quantity).toBe(4);
    expect(result.validation?.legal).toBe(true);expect(result.warnings?.length).toBeGreaterThan(0);
  });
  it('skips an unavailable curve bucket while improving achievable buckets',()=>{
    const varied=[...Array.from({length:16},(_,i)=>card(`Cheap ${i}`,1)),...Array.from({length:16},(_,i)=>card(`Heavy ${i}`,5)),card('Wastes',0,true)];
    const result=generateDeck({...options,landCountTarget:24,curveTargets:{'0':1,'1':0,'2':0,'3':0,'4':0,'5':35,'6+':0}},varied);
    expect(result.validation?.legal).toBe(true);
    expect(result.entries.filter(e=>e.card.cmc===5).reduce((s,e)=>s+e.quantity,0)).toBeGreaterThanOrEqual(35);
    expect(result.warnings?.some(w=>w.includes('composition curve'))).toBe(true);
  });
  it('uses curve targets in real initial construction and the reconciled search objective',()=>{
    const varied=[...Array.from({length:16},(_,i)=>card(`Cheap ${i}`,1)),...Array.from({length:16},(_,i)=>card(`Heavy ${i}`,5)),card('Wastes',0,true)];
    const cheap={ '0':0,'1':36,'2':0,'3':0,'4':0,'5':0,'6+':0 };
    const heavy={ ...cheap,'1':0,'5':36 };
    const a={...options,landCountTarget:24,curveTargets:cheap}, b={...options,landCountTarget:24,curveTargets:heavy};
    const low=generateDeck(a,varied),high=generateDeck(b,varied);
    const copies=(entries:DeckEntry[],mv:number)=>entries.filter(e=>e.board==='main'&&!e.card.typeLine.includes('Land')&&e.card.cmc===mv).reduce((s,e)=>s+e.quantity,0);
    expect(low.validation?.legal).toBe(true);expect(high.validation?.legal).toBe(true);
    expect(copies(low.entries,1)).toBe(36);expect(copies(high.entries,5)).toBe(36);
    const score=deckScore(low.entries,a,3),other=deckScore(low.entries,b,3),breakdown=buildScoreBreakdown(low.entries,a,3);
    expect(score.total).toBeGreaterThan(other.total);expect(breakdown.totals.compositionPenalty).toBe(0);expect(breakdown.totals.finalScore).toBe(score.total);
  });
  it('rejects invalid supplied targets clearly before constructing or scoring', () => {
    for (const mutation of [
      { landCountTarget: NaN }, { landCountTarget: -1 }, { landCountTarget: 61 },
      { landCountTarget: 20.5 }, { targetAverageManaValue: Infinity }, { targetAverageManaValue: -1 },
      { landCountTarget: 20, curveTargets: { '0': 0, '1': 0, '2': 39, '3': 0, '4': 0, '5': 0, '6+': 0 } },
      { landCountTarget: 20, curveTargets: { '2': 40 } },
    ]) expect(() => generateDeck({ ...options, ...mutation } as GenerateOptions, pool)).toThrow(/composition|target/i);
  });

  it('one-field land target mutation changes actual legal mana construction', () => {
    const low = generateDeck({ ...options, landCountTarget: 18 }, pool);
    const high = generateDeck({ ...options, landCountTarget: 28 }, pool);
    expect(low.validation?.legal).toBe(true);
    expect(high.validation?.legal).toBe(true);
    expect(lands(low.entries)).toBe(18);
    expect(lands(high.entries)).toBe(28);
    expect(low.totalCards).toBe(60);
    expect(high.totalCards).toBe(60);
  });
});
