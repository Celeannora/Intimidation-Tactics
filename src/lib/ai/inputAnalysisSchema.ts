import { MACRO_LABELS, THEME_IDS } from '../archetypeVocab';
import type { AIJsonSchema } from './provider';
import type { InputAnalysisRequest, InputCardBlueprint } from './inputAnalysisTypes';
import { FORMAT_RULES, getFormatRules } from '../formats';
import { maxCopiesForCard } from '../legality';
import { buildInputCardFacts } from '../analysis/inputCardFacts';

export const MAX_INPUT_ANALYSIS_CARDS = 250;
export const MAX_INPUT_ANALYSIS_BYTES = 64 * 1024;
const COLORS = ['W', 'U', 'B', 'R', 'G'];
const text = (maxLength = 2000) => ({ type: 'string', minLength: 1, maxLength });
const integer = (maximum = 100) => ({ type: 'integer', minimum: 0, maximum });
const enumeration = (values: readonly string[]) => ({ type: 'string', enum: [...values] });
const array = (items: Record<string, unknown>, maxItems: number, minItems = 0, uniqueItems = false) => ({ type: 'array', items, minItems, maxItems, uniqueItems });
const object = (properties: Record<string, unknown>) => ({ type: 'object', properties, required: Object.keys(properties), additionalProperties: false });
const shape = object({
  schemaVersion: { type: 'integer', const: 1 }, title: text(160), strategy: text(4000), rationale: text(4000),
  archetype: enumeration(MACRO_LABELS), secondaryArchetypes: array(enumeration(MACRO_LABELS), 6, 0, true),
  themes: array(enumeration(THEME_IDS), 10, 0, true), colors: array(enumeration(COLORS), 5, 0, true),
  speed: enumeration(['fast', 'midrange', 'slow']), spellRatio: enumeration(['creature-heavy', 'balanced', 'spell-heavy']),
  averageManaValue: { type: 'number', minimum: 0, maximum: 20 }, landCountTarget: integer(),
  curveTargets: object(Object.fromEntries(['0', '1', '2', '3', '4', '5', '6+'].map(k => [k, integer()]))),
  roleTargets: object(Object.fromEntries(['threats', 'removal', 'boardWipes', 'counterspells', 'cardDraw', 'ramp', 'enablers', 'payoffs'].map(k => [k, integer()]))),
  inputs: array(object({ oracleId: text(128), role: text(500), recommendedQuantity: integer(), support: array(text(1000), 10), rationale: text(2000) }), MAX_INPUT_ANALYSIS_CARDS, 1),
  interactions: array(object({ oracleIds: array(text(128), MAX_INPUT_ANALYSIS_CARDS, 1, true), explanation: text(2000), conditions: array(text(1000), 10) }), 15),
  alternatives: array(object({ title: text(160), tradeoffs: text(2000) }), 5), uncertainties: array(text(1000), 15),
});
type Schema = Record<string, unknown>;
// Provider structured-output implementations support a smaller JSON Schema dialect.
// Keep all bounds/uniqueness in `shape` for mandatory local validation; only the
// transport copy is projected to the common strict object/array/type/enum subset.
function providerShape(schema: Schema): Schema {
  const portable=structuredClone(schema);
  const localOnly=['minLength','maxLength','minimum','maximum','minItems','maxItems','uniqueItems'];
  const hints=localOnly.filter(k=>schema[k]!==undefined&&schema[k]!==false).map(k=>`${k}: ${String(schema[k])}`);
  for(const key of localOnly)delete portable[key];
  if(Object.hasOwn(portable,'const')){portable.enum=[portable.const];delete portable.const;}
  if(hints.length)portable.description=`Local validation requires ${hints.join('; ')}.`;
  if(schema.properties)portable.properties=Object.fromEntries(Object.entries(schema.properties as Record<string,Schema>).map(([key,child])=>[key,providerShape(child)]));
  if(schema.items)portable.items=providerShape(schema.items as Schema);
  return portable;
}
export const INPUT_ANALYSIS_JSON_SCHEMA: AIJsonSchema = { name: 'input_card_blueprint', strict: true, schema: providerShape(shape) };

function validateShape(value: unknown, schema: Schema, path: string): void {
  const fail = (message: string): never => { throw new Error(`${path}: ${message}`); };
  if (schema.type === 'object') {
    if (!value || typeof value !== 'object' || Array.isArray(value) || ![Object.prototype, null].includes(Object.getPrototypeOf(value))) fail('expected plain object');
    const record = value as Record<string, unknown>;
    const props = schema.properties as Record<string, Schema>;
    for (const key of Object.keys(record)) if (!Object.hasOwn(props, key)) fail(`unknown field ${key}`);
    for (const [key, child] of Object.entries(props)) {
      if (!Object.hasOwn(record, key)) fail(`missing field ${key}`);
      validateShape(record[key], child, `${path}.${key}`);
    }
  } else if (schema.type === 'array') {
    if (!Array.isArray(value)) fail('expected array');
    const values = value as unknown[];
    if (values.length < Number(schema.minItems) || values.length > Number(schema.maxItems)) fail('array length out of bounds');
    if (schema.uniqueItems && new Set(values).size !== values.length) fail('duplicate values');
    Array.from(values).forEach((v, i) => validateShape(v, schema.items as Schema, `${path}[${i}]`));
  } else if (schema.type === 'string') {
    if (typeof value !== 'string') fail('expected string');
    const s = value as string;
    if (schema.enum && !(schema.enum as string[]).includes(s)) fail('unsupported enum');
    if (s.trim().length < Number(schema.minLength ?? 0) || s.length > Number(schema.maxLength ?? Infinity)) fail('string length out of bounds');
  } else {
    if (typeof value !== 'number' || !Number.isFinite(value)) fail('expected finite number');
    const n = value as number;
    if (schema.type === 'integer' && !Number.isSafeInteger(n)) fail('expected integer');
    if (schema.const !== undefined && value !== schema.const) fail('unsupported schema version');
    if (n < Number(schema.minimum ?? -Infinity) || n > Number(schema.maximum ?? Infinity)) fail('number out of bounds');
  }
}
export function validateInputAnalysisRequest(request: InputAnalysisRequest): void {
  if (!request || !Object.hasOwn(FORMAT_RULES,request.format)) throw new Error('Unsupported analysis format');
  const rules=getFormatRules(request.format);
  if (!Number.isSafeInteger(request.mainboardSize)||request.mainboardSize<rules.minMainboardSize||request.mainboardSize>rules.maxMainboardSize) throw new Error('Invalid analysis deck size');
  if (!Array.isArray(request.inputs)||request.inputs.length<1||request.inputs.length>MAX_INPUT_ANALYSIS_CARDS) throw new Error(`Input analysis accepts 1–${MAX_INPUT_ANALYSIS_CARDS} input cards`);
  if (!Array.isArray(request.colors)||request.colors.length>5||!Array.from(request.colors).every(c=>COLORS.includes(c))||new Set(request.colors).size!==request.colors.length) throw new Error('Invalid analysis colors');
  if (typeof request.allowColorExpansion!=='boolean'||typeof request.datasetVersion!=='string'||request.datasetVersion.length>512) throw new Error('Invalid analysis context');
  for (const cap of [request.maxCardPriceUsd,request.totalBudgetUsd]) if(cap!==undefined&&(!Number.isFinite(cap)||cap<0)) throw new Error('Invalid price constraint');
  const ids=new Set<string>();
  for (const input of Array.from(request.inputs)) {
    if (!input||typeof input.required!=='boolean'||typeof input.quantityLocked!=='boolean'||(input.quantityLocked&&!input.required)) throw new Error('Locked inputs must be required');
    const f=buildInputCardFacts(input,request.format);
    if (ids.has(f.oracleId)) throw new Error('Duplicate input identity'); ids.add(f.oracleId);
    if (!f.legalInFormat) throw new Error(`${f.name} is not legal in the selected format`);
    if (input.quantity>maxCopiesForCard(input.card,request.format)) throw new Error('Input quantity exceeds format copy limit');
    if ((input.required||input.quantityLocked)&&!request.allowColorExpansion&&f.colorIdentity.some(c=>!request.colors.includes(c))) throw new Error('Required input is outside allowed colors');
    if ((input.required||input.quantityLocked)&&request.maxCardPriceUsd!==undefined&&f.priceUsd!==null&&f.priceUsd>request.maxCardPriceUsd) throw new Error('Required input exceeds per-card price cap');
  }
}
export function validateInputCardBlueprint(value: unknown, request: InputAnalysisRequest): InputCardBlueprint {
  validateInputAnalysisRequest(request);
  validateShape(value, shape, 'blueprint');
  const b=value as InputCardBlueprint, n=request.mainboardSize;
  if (b.landCountTarget>n||Object.values(b.curveTargets).reduce((sum,v)=>sum+v,0)!==n-b.landCountTarget) throw new Error('Curve targets plus lands must equal deck size');
  if (Object.values(b.roleTargets).some(v=>v>n)) throw new Error('Role target exceeds deck size');
  if (b.secondaryArchetypes.includes(b.archetype)) throw new Error('Primary archetype repeated as secondary');
  if (!request.allowColorExpansion&&b.colors.some(c=>!request.colors.includes(c))) throw new Error('Unapproved color expansion');
  if (b.inputs.length!==request.inputs.length||new Set(b.inputs.map(x=>x.oracleId)).size!==b.inputs.length) throw new Error('Each input must be analyzed exactly once');
  let requiredLands=0,requiredSpells=0;
  for (const row of b.inputs) {
    const input=request.inputs.find(i=>i.card.oracleId===row.oracleId);
    if (!input) throw new Error('Unknown input reference');
    if (row.recommendedQuantity>maxCopiesForCard(input.card,request.format)||(input.required&&row.recommendedQuantity<1)||(input.quantityLocked&&row.recommendedQuantity!==input.quantity)) throw new Error('Input quantity recommendation violates constraints');
    const f=buildInputCardFacts(input,request.format);
    if (row.recommendedQuantity>0&&f.colorIdentity.some(c=>!b.colors.includes(c))) throw new Error('Recommended input outside blueprint colors');
    if (row.recommendedQuantity>0&&request.maxCardPriceUsd!==undefined&&f.priceUsd!==null&&f.priceUsd>request.maxCardPriceUsd) throw new Error('Recommended input exceeds price cap');
    if (input.required) { if(f.typeLine.includes('Land'))requiredLands+=input.quantityLocked?input.quantity:1; else requiredSpells+=input.quantityLocked?input.quantity:1; }
  }
  if (requiredLands>b.landCountTarget||requiredSpells>n-b.landCountTarget) throw new Error('Composition cannot fit required inputs');
  const ids=new Set(request.inputs.map(i=>i.card.oracleId));
  if (b.interactions.some(row=>row.oracleIds.some(id=>!ids.has(id)))) throw new Error('Unknown interaction reference');
  return structuredClone(b);
}
