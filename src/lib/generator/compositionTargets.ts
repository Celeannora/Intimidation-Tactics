import type { GenerateOptions } from './types';
import { CURVE_BUCKETS, type CurveTargets, type CurveBucket } from './compositionTypes';
import type { CardRecord } from '../types';
import type { DeckEntry } from '../legality';
import { maxCopiesForCard } from '../legality';
import { getCardCastingView } from '../analysis/inputCardFacts';
import { generationMainboardSize } from './validation';
export interface CompositionTargets { landCountTarget?:number; curveTargets?:CurveTargets; targetAverageManaValue?:number }
/** Validate opt-in soft targets once at the boundary; never reinterpret malformed targets. */
export function normalizeCompositionTargets(options:GenerateOptions):CompositionTargets|undefined {
  if(options.landCountTarget===undefined&&options.curveTargets===undefined&&options.targetAverageManaValue===undefined)return undefined;
  const n=generationMainboardSize(options);
  let lands=options.landCountTarget;
  if(lands!==undefined&&(!Number.isSafeInteger(lands)||lands<0||lands>n))throw new Error('Invalid composition land target');
  const curve=options.curveTargets;
  if(curve!==undefined){
    if(!curve||typeof curve!=='object'||Array.isArray(curve)||Object.keys(curve).length!==CURVE_BUCKETS.length||!CURVE_BUCKETS.every(k=>Object.hasOwn(curve,k)&&Number.isSafeInteger(curve[k])&&curve[k]>=0&&curve[k]<=n))throw new Error('Invalid composition curve targets');
    const total=CURVE_BUCKETS.reduce((s,k)=>s+curve[k],0);
    if(total>n||(lands!==undefined&&total+lands!==n))throw new Error('Composition curve targets plus land target must equal deck size');
    lands??=n-total;
  }
  const avg=options.targetAverageManaValue;
  if(avg!==undefined&&(!Number.isFinite(avg)||avg<0||avg>20))throw new Error('Invalid composition average mana value target');
  return {landCountTarget:lands,curveTargets:curve?{...curve}:undefined,targetAverageManaValue:avg};
}

export function compositionCounts(entries:DeckEntry[]):{lands:number;curve:CurveTargets;average:number} {
  const curve=Object.fromEntries(CURVE_BUCKETS.map(k=>[k,0])) as CurveTargets;
  let lands=0,mana=0,copies=0;
  for(const e of entries){
    if(e.board!=='main')continue;
    const face=getCardCastingView(e.card);
    if(face.typeLine.includes('Land')){lands+=e.quantity;continue;}
    const bucket=(face.manaValue>=6?'6+':String(Math.floor(face.manaValue))) as CurveBucket;
    curve[bucket]+=e.quantity;mana+=face.manaValue*e.quantity;copies+=e.quantity;
  }
  return {lands,curve,average:copies?mana/copies:0};
}
export function compositionPenalty(entries:DeckEntry[],options:GenerateOptions):number {
  const t=normalizeCompositionTargets(options);if(!t)return 0;
  const actual=compositionCounts(entries);
  return (t.landCountTarget===undefined?0:15*Math.abs(actual.lands-t.landCountTarget))+
    (t.curveTargets?8*CURVE_BUCKETS.reduce((s,k)=>s+Math.abs(actual.curve[k]-t.curveTargets![k]),0):0)+
    (t.targetAverageManaValue===undefined?0:30*Math.abs(actual.average-t.targetAverageManaValue));
}
/** Bounded initial-fill repair, one legal copy per move; immutable input/pin identities win. */
export function fitInitialCurve(entries:DeckEntry[],pool:CardRecord[],options:GenerateOptions,locked:Set<string>,rank:(card:CardRecord)=>number):void {
  const target=normalizeCompositionTargets(options)?.curveTargets;if(!target)return;
  const bucket=(c:CardRecord)=>(getCardCastingView(c).manaValue>=6?'6+':String(Math.floor(getCardCastingView(c).manaValue))) as CurveBucket;
  const candidates=new Map(CURVE_BUCKETS.map(k=>[k,pool.filter(c=>!getCardCastingView(c).typeLine.includes('Land')&&bucket(c)===k).map(card=>({card,score:rank(card)})).filter(v=>Number.isFinite(v.score)).sort((a,b)=>b.score-a.score).map(v=>v.card)]));
  const maxMoves=generationMainboardSize(options);
  for(let move=0;move<maxMoves;move++){
    const actual=compositionCounts(entries), deficit=CURVE_BUCKETS.find(k=>actual.curve[k]<target[k]&&candidates.get(k)!.some(c=>!locked.has(c.oracleId)&&entries.filter(e=>e.card.oracleId===c.oracleId).reduce((s,e)=>s+e.quantity,0)<maxCopiesForCard(c,options.format)));
    if(!deficit)break;
    const donor=entries.filter(e=>e.board==='main'&&!locked.has(e.card.oracleId)&&!getCardCastingView(e.card).typeLine.includes('Land')&&actual.curve[bucket(e.card)]>target[bucket(e.card)]).sort((a,b)=>rank(a.card)-rank(b.card))[0];
    const next=candidates.get(deficit)!.find(c=>!locked.has(c.oracleId)&&entries.filter(e=>e.card.oracleId===c.oracleId).reduce((s,e)=>s+e.quantity,0)<maxCopiesForCard(c,options.format));
    if(!donor||!next)break;
    donor.quantity--;const existing=entries.find(e=>e.board==='main'&&e.card.oracleId===next.oracleId);
    if(existing)existing.quantity++;else entries.push({card:next,quantity:1,board:'main'});
    const empty=entries.findIndex(e=>e.quantity===0);if(empty>=0)entries.splice(empty,1);
  }
}
export function compositionWarnings(entries:DeckEntry[],options:GenerateOptions):string[] {
  const t=normalizeCompositionTargets(options);if(!t)return [];
  const a=compositionCounts(entries),warnings:string[]=[];
  if(t.landCountTarget!==undefined&&a.lands!==t.landCountTarget)warnings.push(`Soft composition land target ${t.landCountTarget}; actual ${a.lands}. Locks, legal pool and deck size take precedence.`);
  if(t.curveTargets){const delta=CURVE_BUCKETS.filter(k=>a.curve[k]!==t.curveTargets![k]);if(delta.length)warnings.push(`Soft composition curve deviation: ${delta.map(k=>`${k}: ${a.curve[k]}/${t.curveTargets![k]}`).join(', ')} (actual/target; front-face MV, X=0).`);}
  if(t.targetAverageManaValue!==undefined&&Math.abs(a.average-t.targetAverageManaValue)>0.1)warnings.push(`Soft composition average MV ${a.average.toFixed(2)} vs target ${t.targetAverageManaValue.toFixed(2)}.`);
  return warnings;
}
