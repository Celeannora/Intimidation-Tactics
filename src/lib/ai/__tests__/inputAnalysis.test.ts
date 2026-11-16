import {afterEach,expect,it,vi} from 'vitest';
import {analyzeInputCards,clearInputAnalysisCache,getInputAnalysisKey} from '../inputAnalysis';
import {request,blueprint} from './inputAnalysis.fixtures';
import type {AIProvider} from '../provider';
afterEach(()=>{clearInputAnalysisCache();vi.useRealTimers();});
const provider=()=>({id:'test',label:'test',isReady:vi.fn(async()=>true),generate:vi.fn(async()=>JSON.stringify(blueprint()))}) satisfies AIProvider;
it('expires cached advice and invalidates on a new dataset version',async()=>{
 vi.useFakeTimers();vi.setSystemTime(1000000);const p=provider();await analyzeInputCards(request(),p);
 vi.setSystemTime(2000000);expect((await analyzeInputCards(request(),p)).fromCache).toBe(false);
 const r=request();r.datasetVersion='new';await analyzeInputCards(r,p);expect(p.generate).toHaveBeenCalledTimes(3);
});
it('cancels availability checks before any inference',async()=>{
 const p=provider(),ctl=new AbortController();p.isReady.mockImplementation(()=>new Promise(()=>{}));
 const pending=analyzeInputCards(request(),p,{signal:ctl.signal});ctl.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});expect(p.generate).not.toHaveBeenCalled();
});
it('sends independent full facts, returns advice and caches defensive copies',async()=>{
 const p=provider(),r=request();const a=await analyzeInputCards(r,p,{modelKey:'test/model1'});expect(p.generate).toHaveBeenCalledTimes(1);
 const sent=p.generate.mock.calls[0] as unknown as [{messages:{content:string}[]}];expect(sent[0].messages.map(m=>m.content).join(' ')).toContain('Flying');
 expect((sent[0] as unknown as {retry:{maxAttempts:number}}).retry.maxAttempts).toBe(1);
 a.blueprint.title='mutated';const b=await analyzeInputCards(r,p,{modelKey:'test/model1'});expect(b.fromCache).toBe(true);expect(b.blueprint.title).toBe('Angels');expect(p.generate).toHaveBeenCalledTimes(1);
 expect(a.requestKey).toBe(getInputAnalysisKey(r,'test/model1'));
});
it('repairs a malformed response once and no more',async()=>{
 const p=provider();p.generate.mockResolvedValueOnce('{}').mockResolvedValueOnce(JSON.stringify(blueprint()));expect((await analyzeInputCards(request(),p)).blueprint.title).toBe('Angels');expect(p.generate).toHaveBeenCalledTimes(2);
 clearInputAnalysisCache();p.generate.mockResolvedValue('{}');await expect(analyzeInputCards(request(),p)).rejects.toThrow();expect(p.generate).toHaveBeenCalledTimes(4);
});
it('rejects constrained inputs before spending a provider call',async()=>{
 const r=request(),p=provider();r.inputs[0].card.legalityStandard='banned';await expect(analyzeInputCards(r,p)).rejects.toThrow(/legal/);expect(p.generate).not.toHaveBeenCalled();
});
it('aborts an uncooperative pending provider and does not cache late output',async()=>{
 const p=provider(),ctl=new AbortController();let resolve!:(s:string)=>void;p.generate.mockImplementation(()=>new Promise(r=>{resolve=r;}));
 const pending=analyzeInputCards(request(),p,{signal:ctl.signal});await vi.waitFor(()=>expect(p.generate).toHaveBeenCalledTimes(1));ctl.abort();await expect(pending).rejects.toMatchObject({name:'AbortError'});resolve(JSON.stringify(blueprint()));
 p.generate.mockResolvedValue(JSON.stringify(blueprint()));expect((await analyzeInputCards(request(),p)).fromCache).toBe(false);
});
it('keys actual rules, faces, locks, data and model; caller mutation cannot rebind an inflight result',async()=>{
 const r=request(),key=getInputAnalysisKey(r,'m');r.inputs[0].card.oracleText='Changed';expect(getInputAnalysisKey(r,'m')).not.toBe(key);expect(getInputAnalysisKey(request(),'other')).not.toBe(key);
 const p=provider();let resolve!:(s:string)=>void;p.generate.mockImplementation(()=>new Promise(r=>{resolve=r;}));const snapshot=request();const pending=analyzeInputCards(snapshot,p);await vi.waitFor(()=>expect(p.generate).toHaveBeenCalled());snapshot.inputs[0].quantity=3;resolve(JSON.stringify(blueprint()));expect((await pending).blueprint.inputs[0].recommendedQuantity).toBe(2);
});
