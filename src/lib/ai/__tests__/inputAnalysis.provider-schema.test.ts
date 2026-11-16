import { afterEach, describe, expect, it, vi } from 'vitest';
import { analyzeInputCards, clearInputAnalysisCache } from '../inputAnalysis';
import { LlamaCppProvider } from '../llamacpp';
import { OpenAIProvider } from '../openai';
import { INPUT_ANALYSIS_JSON_SCHEMA, validateInputCardBlueprint } from '../inputAnalysisSchema';
import { blueprint, request } from './inputAnalysis.fixtures';

const allowed = new Set(['type','properties','required','additionalProperties','items','enum','description']);
function unsupported(schema: Record<string,unknown>, path='root'):string|undefined {
  for(const key of Object.keys(schema)) if(!allowed.has(key)) return `${path}: ${key}`;
  for(const [key,child] of Object.entries((schema.properties??{}) as Record<string,Record<string,unknown>>)) {
    const issue=unsupported(child,`${path}.${key}`);if(issue)return issue;
  }
  return schema.items?unsupported(schema.items as Record<string,unknown>,path+'[]'):undefined;
}
afterEach(()=>{vi.unstubAllGlobals();clearInputAnalysisCache();});
describe('input analysis structured-output provider compatibility',()=>{
  it.each(['llamacpp','openai'] as const)('passes the strict supported schema through actual %s transport',async id=>{
    let posts=0;
    vi.stubGlobal('fetch',vi.fn(async (_url:unknown,init?:RequestInit)=>{
      if(init?.method==='GET')return new Response(JSON.stringify({data:[]}),{status:200});
      posts++;const body=JSON.parse(String(init?.body));const format=body.response_format;
      expect(format.type).toBe('json_schema');expect(format.json_schema.name).toBe('input_card_blueprint');expect(format.json_schema.strict).toBe(true);
      const issue=Object.hasOwn(format.json_schema.schema.properties.secondaryArchetypes,'uniqueItems')
        ? "In context=('properties', 'secondaryArchetypes'), 'uniqueItems' is not permitted"
        : unsupported(format.json_schema.schema);
      if(issue)return new Response(JSON.stringify({error:{message:`Invalid schema for response_format 'input_card_blueprint': ${issue} is not permitted`}}),{status:400});
      return new Response(JSON.stringify({choices:[{message:{content:JSON.stringify(blueprint())}}]}),{status:200});
    }));
    const provider=id==='llamacpp'?new LlamaCppProvider({providerId:'llamacpp',llamaCppUseJsonSchema:true}):new OpenAIProvider({providerId:'openai',openaiApiKey:'test-placeholder'});
    await expect(analyzeInputCards(request(),provider)).resolves.toMatchObject({blueprint:{title:'Angels'}});
    expect(posts).toBe(1);
    expect(unsupported(INPUT_ANALYSIS_JSON_SCHEMA.schema)).toBeUndefined();
  });
  it('keeps uniqueness and all local limits despite the portable wire schema',()=>{
    const good=blueprint();expect(()=>validateInputCardBlueprint(good,request())).not.toThrow();
    const mutations=[(b:typeof good)=>{b.colors=['W','W'];},(b:typeof good)=>{b.secondaryArchetypes=['Control','Control'];},(b:typeof good)=>{b.title='x'.repeat(161);},(b:typeof good)=>{b.averageManaValue=21;},(b:typeof good)=>{b.alternatives=Array.from({length:6},()=>({title:'x',tradeoffs:'y'}));},(b:typeof good)=>{b.schemaVersion=2 as 1;}];
    for(const mutate of mutations){const bad=structuredClone(good);mutate(bad);expect(()=>validateInputCardBlueprint(bad,request())).toThrow();}
  });
});
