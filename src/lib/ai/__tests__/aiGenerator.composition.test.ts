import {expect,it} from 'vitest';
import {buildAIPrompts,clampAINonlandSpine} from '../aiGenerator';
import {request} from './inputAnalysis.fixtures';
import type {GenerateOptions} from '../../generator/types';
const options:GenerateOptions={engine:'ai',format:'standard',archetype:'Midrange',colors:['W'],mainboardSize:60};
it('prompts AI for the approved nonland/curve budget rather than the old heuristic',()=>{
 const configured={...options,landCountTarget:28,curveTargets:{'0':0,'1':32,'2':0,'3':0,'4':0,'5':0,'6+':0},targetAverageManaValue:1};
 const p=buildAIPrompts(configured,[request().inputs[0].card]);expect(p.system).toContain('Return 32-32 mainboard');expect(p.user).toContain('Soft composition targets');expect(p.user).toContain('28');
 expect(buildAIPrompts(options,[]).system).toContain('Return 33-39 mainboard');
});
it('reserves explicit lands in the locked AI spine without trimming original inputs',()=>{
 const c=request().inputs[0].card, seeds=[{card:c,quantity:2,board:'main' as const}];
 const picks=Array.from({length:10},(_,i)=>({card:{...c,oracleId:'other'+i,name:'Other '+i},quantity:4,board:'main' as const}));
 const value=clampAINonlandSpine(picks,seeds,60,{...options,landCountTarget:30});expect(value.landBudget).toBe(30);expect(value.maxCopies).toBe(28);expect(seeds[0].quantity).toBe(2);
});
