import { expect,it } from 'vitest';
import { getCardCastingView,buildInputCardFacts } from '../inputCardFacts';
import { request } from '../../ai/__tests__/inputAnalysis.fixtures';
it('keeps complete authentic input rules and identity',()=>{
 const input=request().inputs[0];Object.assign(input.card,{name:'Hope Estheim',manaCost:'{W}{U}',cmc:2,typeLine:'Legendary Creature — Human Wizard',oracleText:'Lifelink\nAt the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.',colorIdentityJson:'["W","U"]'});
 const facts=buildInputCardFacts(input,'standard');expect(facts.manaValue).toBe(2);expect(facts.fullOracleText).toContain('mills X cards');expect(facts.colorIdentity).toEqual(['W','U']);expect(facts.quantityLocked).toBe(true);expect(facts.legalInFormat).toBe(true);
});
it('uses the front face without treating the transformed creature as available',()=>{
 const c={...request().inputs[0].card,manaCost:null,cmc:4,typeLine:'Enchantment — Saga // Creature',cardFacesJson:JSON.stringify([{name:'Front',mana_cost:'{2}{U}{U}',type_line:'Enchantment — Saga',oracle_text:'Read ahead.'},{name:'Back',mana_cost:'',type_line:'Creature — Avatar',oracle_text:'Flying'}])};
 const view=getCardCastingView(c);expect(view.typeLine).toBe('Enchantment — Saga');expect(view.manaCost).toBe('{2}{U}{U}');expect(view.manaValue).toBe(4);expect(buildInputCardFacts({...request().inputs[0],card:c},'standard').faces).toHaveLength(2);
});
it('handles X, hybrid and phyrexian symbols as printed costs',()=>{
 const c={...request().inputs[0].card,manaCost:'{X}{2/W}{U/P}',cmc:3};expect(getCardCastingView(c).manaValue).toBe(3);
});
it('rejects malformed face and identity metadata rather than inventing facts',()=>{
 const i=request().inputs[0];expect(()=>buildInputCardFacts({...i,card:{...i.card,colorIdentityJson:'null'}},'standard')).toThrow();expect(()=>getCardCastingView({...i.card,cardFacesJson:'broken'})).toThrow();
});
it('bounds face metadata before parsing, including direct casting-view callers',()=>{
 const c={...request().inputs[0].card,cardFacesJson:'['+' '.repeat(48000)+']'};
 expect(()=>getCardCastingView(c)).toThrow(/bound|large|limit/i);
});
