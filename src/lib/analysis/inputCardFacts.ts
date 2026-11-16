import type { CardRecord, ManaColor } from '../types';
import type { ConstructedFormat } from '../formats';
import { isCardLegalInFormat } from '../formats';
import type { CardCastingView, InputAnalysisCard, InputCardFacts } from '../ai/inputAnalysisTypes';

type Face = { name?: string; mana_cost?: string; cmc?: number; type_line?: string; oracle_text?: string };
function faces(card: CardRecord): Face[] {
  if (card.cardFacesJson == null) return [];
  if (typeof card.cardFacesJson!=='string'||card.cardFacesJson.length>48000) throw new Error('Card face metadata exceeds analysis bounds');
  const value: unknown = JSON.parse(card.cardFacesJson);
  if (!Array.isArray(value) || value.length > 4 || !Array.from(value).every(v => v && typeof v === 'object' && !Array.isArray(v))) throw new Error('Invalid card face metadata');
  return value as Face[];
}
function manaValue(cost: string | null, fallback: number): number {
  if (cost != null) {
    const tokens=[...cost.matchAll(/\{([^}]+)\}/g)];
    if (tokens.length || cost==='') return tokens.reduce((sum,m)=>sum+Math.max(...m[1].split('/').map(t=>/^\d+$/.test(t)?Number(t):/^[XYZP]$/.test(t)?0:t.startsWith('H')?0.5:1)),0);
  }
  if (!Number.isFinite(fallback) || fallback<0) throw new Error('Invalid card mana value');
  return fallback;
}
function view(card: CardRecord, face?: Face): CardCastingView {
  for (const value of [face?.name,face?.mana_cost,face?.type_line,face?.oracle_text]) if (value!==undefined && typeof value!=='string') throw new Error('Invalid card face text');
  const cost=face?.mana_cost ?? card.manaCost;
  return {name:face?.name??card.name,manaCost:cost,manaValue:manaValue(cost,face?.cmc??card.cmc),typeLine:face?.type_line??card.typeLine,oracleText:face?.oracle_text??card.oracleText};
}
/** Default/front casting view, retaining alternatives separately for advice. X is zero. */
export function getCardCastingView(card: CardRecord): CardCastingView { return view(card,faces(card)[0]); }
export function buildInputCardFacts(input: InputAnalysisCard, format: ConstructedFormat): InputCardFacts {
  const c=input.card;
  if (typeof c?.colorIdentityJson!=='string'||c.colorIdentityJson.length>128||(c.oracleText?.length??0)>24000) throw new Error('Input metadata exceeds analysis bounds');
  if (!c || !c.oracleId || !c.name || !c.typeLine || !Number.isSafeInteger(input.quantity) || input.quantity<1) throw new Error('Invalid input card');
  const identity:unknown=JSON.parse(c.colorIdentityJson);
  if (!Array.isArray(identity) || !Array.from(identity).every(x=>typeof x==='string'&&['W','U','B','R','G'].includes(x)) || new Set(identity).size!==identity.length) throw new Error('Invalid color identity');
  const result=getCardCastingView(c);
  if ((c.oracleText?.length??0)>24000 || (c.cardFacesJson?.length??0)>48000) throw new Error('Input rules exceed analysis bounds');
  if (c.priceUsd!=null && (!Number.isFinite(c.priceUsd)||c.priceUsd<0)) throw new Error('Invalid card price');
  return {...result,oracleId:c.oracleId,quantity:input.quantity,required:input.required,quantityLocked:input.quantityLocked,colorIdentity:identity as ManaColor[],fullOracleText:c.oracleText,faces:faces(c).map(f=>view(c,f)),legalInFormat:isCardLegalInFormat(c,format),priceUsd:c.priceUsd??null};
}
