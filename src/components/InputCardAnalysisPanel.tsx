import { useEffect, useRef, useState } from "react";
import type { DeckEntry } from "../lib/legality";
import type { ManaColor } from "../lib/types";
import type { ConstructedFormat } from "../lib/formats";
import { MACRO_LABELS, THEMES } from "../lib/archetypeVocab";
import { CURVE_BUCKETS } from "../lib/generator/compositionTypes";
import { loadAISettings } from "../lib/ai/provider";
import { makeProvider } from "../lib/ai/factory";
import { analyzeInputCards, getInputAnalysisKey } from "../lib/ai/inputAnalysis";
import { validateInputCardBlueprint } from "../lib/ai/inputAnalysisSchema";
import type { InputAnalysisRequest, InputBlueprintSettings, InputCardBlueprint } from "../lib/ai/inputAnalysisTypes";
import { db } from "../lib/db";

interface Props {
  entries: DeckEntry[]; pins?: Record<string, number>; format: ConstructedFormat; mainboardSize: number;
  colors: ManaColor[]; maxCardPriceUsd?: number; totalBudgetUsd?: number;
  onApply: (settings: InputBlueprintSettings) => void; onOpenSettings?: () => void;
}
const GROUPS = ["Strategy", "Colors", "Themes", "Roles", "Composition"] as const;
type Group = typeof GROUPS[number];
const colorCodes: ManaColor[] = ["W", "U", "B", "R", "G"];
async function datasetVersion() {
  try { return (await db.meta?.get("lastImportedAt"))?.value ?? "unknown"; } catch { return "unknown"; }
}
function providerContext() {
  const settings = loadAISettings();
  const model = settings.providerId === "openai" ? settings.openaiModel : settings.providerId === "ollama" ? settings.ollamaModel : settings.providerId === "llamacpp" ? settings.llamaCppModel : undefined;
  // Explicit allowlist: credentials must never enter request/cache identities.
  const identity = JSON.stringify([settings.providerId, model, settings.ollamaBaseUrl, settings.llamaCppBaseUrl, settings.llamaCppUseJsonSchema, settings.maxTokens, settings.requestTimeoutMs]);
  return { settings, model, identity };
}
export function InputCardAnalysisPanel({ entries, pins = {}, format, mainboardSize, colors, maxCardPriceUsd, totalBudgetUsd, onApply, onOpenSettings }: Props) {
  const mainEntries = [...new Map(entries.filter(e => e.board === "main").map(e => [e.card.oracleId, e])).values()];
  const [allowColorExpansion, setAllowColorExpansion] = useState(false);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [accepted, setAccepted] = useState<{ raw: InputCardBlueprint; request: InputAnalysisRequest; identity: string; providerIdentity: string } | null>(null);
  const [preview, setPreview] = useState<InputCardBlueprint | null>(null);
  const [numbers, setNumbers] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Group[]>([...GROUPS]);
  const controller = useRef<AbortController | null>(null);
  const mounted = useRef(true);
  const epoch = useRef(0);
  const activeContext = useRef<{ providerIdentity: string; datasetVersion?: string } | null>(null);
  const identity = JSON.stringify({ entries: mainEntries, pins, format, mainboardSize, colors, allowColorExpansion, maxCardPriceUsd, totalBudgetUsd });
  const currentIdentity = useRef(identity); currentIdentity.current = identity;
  const cancel = () => { epoch.current++; activeContext.current = null; controller.current?.abort(); controller.current = null; setBusy(false); setAccepted(null); setPreview(null); };
  useEffect(() => { cancel(); }, [identity]);
  useEffect(() => { epoch.current++; }, [preview, numbers, groups]);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; epoch.current++; controller.current?.abort(); controller.current = null; }; }, []);
  useEffect(() => {
    if (!accepted && !busy) return;
    let disposed = false;
    const refresh = async () => {
      const context = accepted ? { providerIdentity: accepted.providerIdentity, datasetVersion: accepted.request.datasetVersion } : activeContext.current;
      if (!context) return;
      if (providerContext().identity !== context.providerIdentity) { cancel(); return; }
      const version = await datasetVersion();
      if (!disposed && mounted.current && (providerContext().identity !== context.providerIdentity || context.datasetVersion !== undefined && version !== context.datasetVersion)) cancel();
    };
    const notify = () => { void refresh(); };
    window.addEventListener("focus", notify);
    window.addEventListener("storage", notify);
    const timer = window.setInterval(notify, 1000);
    return () => { disposed = true; window.removeEventListener("focus", notify); window.removeEventListener("storage", notify); window.clearInterval(timer); };
  }, [accepted, busy]);
  const analyze = async () => {
    epoch.current++;
    controller.current?.abort(); const abort = new AbortController(); controller.current = abort;
    const capturedIdentity = identity;
    const ctx = providerContext(); const provider = makeProvider(ctx.settings);
    activeContext.current = { providerIdentity: ctx.identity };
    setError(""); setBusy(true);
    // Keep valid same-context advice while refreshing; failure must not destroy it.
    if (accepted && (accepted.identity !== capturedIdentity || accepted.providerIdentity !== ctx.identity)) { setAccepted(null); setPreview(null); }
    const current = () => controller.current === abort && !abort.signal.aborted && currentIdentity.current === capturedIdentity && providerContext().identity === ctx.identity;
    try {
      if (!provider) throw new Error("Open AI Settings: no provider configured.");
      const version = await datasetVersion(); if (!current()) return;
      activeContext.current = { providerIdentity: ctx.identity, datasetVersion: version };
      const inputs = mainEntries.map(e => ({ card: e.card, quantity: pins[e.card.oracleId] ?? e.quantity, quantityLocked: e.quantityLocked === true || Object.hasOwn(pins, e.card.oracleId), required: true }));
      const inferredColors = colorCodes.filter(c => inputs.some(e => { try { return (JSON.parse(e.card.colorIdentityJson ?? "[]") as string[]).includes(c); } catch { return false; } }));
      const request: InputAnalysisRequest = { inputs, format, mainboardSize, colors: colors.length ? [...colors] : inferredColors, allowColorExpansion, maxCardPriceUsd, totalBudgetUsd, datasetVersion: version };
      const modelKey = ctx.model ? JSON.stringify([provider.id, ctx.identity]) : provider.id;
      const result = await analyzeInputCards(request, provider, { signal: abort.signal, modelKey });
      if (!current() || await datasetVersion() !== version || !current()) return;
      if (result.requestKey !== getInputAnalysisKey(request, modelKey)) throw new Error("Analysis snapshot mismatch. Analyze inputs again.");
      const raw = validateInputCardBlueprint(result.blueprint, request);
      setAccepted({ raw, request, identity: capturedIdentity, providerIdentity: ctx.identity });
      setPreview(structuredClone(raw)); setNumbers({}); setGroups([...GROUPS]);
    } catch (e) { if (current()) setError(e instanceof Error ? e.message : String(e)); }
    finally { if (controller.current === abort) { controller.current = null; setBusy(false); } }
  };
  const edited = (): InputCardBlueprint => {
    if (!preview || !accepted) throw new Error("Analyze inputs first.");
    const value = structuredClone(preview);
    for (const [key, text] of Object.entries(numbers)) {
      const n = text.trim() === "" ? NaN : Number(text);
      if (!Number.isFinite(n)) throw new Error("Enter finite numeric targets.");
      if (key.startsWith("curve:")) value.curveTargets[key.slice(6) as keyof typeof value.curveTargets] = n;
      else if (key.startsWith("role:")) value.roleTargets[key.slice(5) as keyof typeof value.roleTargets] = n;
      else if (key === "landCountTarget") value.landCountTarget = n;
      else value.averageManaValue = n;
    }
    if (CURVE_BUCKETS.reduce((sum, bin) => sum + value.curveTargets[bin], 0) + value.landCountTarget !== accepted.request.mainboardSize) throw new Error("Curve targets plus lands must equal deck size.");
    return validateInputCardBlueprint(value, accepted.request);
  };
  let invalid = "";
  if (preview) { try { edited(); } catch (e) { invalid = e instanceof Error ? e.message : String(e); } }
  const apply = async () => {
    if (!accepted || !preview) return;
    const capturedEpoch = epoch.current;
    try {
      const ctx = providerContext();
      if (!makeProvider(ctx.settings) || ctx.identity !== accepted.providerIdentity || identity !== accepted.identity || await datasetVersion() !== accepted.request.datasetVersion || currentIdentity.current !== accepted.identity) {
        cancel(); throw new Error("Analysis is stale. Analyze inputs again.");
      }
      if (!mounted.current || epoch.current !== capturedEpoch || providerContext().identity !== accepted.providerIdentity) return;
      const value = edited(); const settings: InputBlueprintSettings = {};
      if (groups.includes("Strategy")) Object.assign(settings, { archetype: value.archetype, secondaryArchetypes: value.secondaryArchetypes, speed: value.speed, spellRatio: value.spellRatio });
      if (groups.includes("Colors")) settings.colors = [...value.colors];
      if (groups.includes("Themes")) settings.themes = [...value.themes];
      if (groups.includes("Roles")) settings.roleTargetOverrides = { ...value.roleTargets };
      if (groups.includes("Composition")) Object.assign(settings, { landCountTarget: value.landCountTarget, curveTargets: { ...value.curveTargets }, targetAverageManaValue: value.averageManaValue });
      onApply(settings); setError("Selected SOFT settings applied. Cards and locks unchanged.");
    } catch (e) { if (mounted.current) setError(e instanceof Error ? e.message : String(e)); }
  };
  const numeric = (label: string, key: string, value: number) => <label key={key} className="block">{label}<input aria-label={label} type="number" min={0} step={key === "averageManaValue" ? "0.1" : "1"} value={numbers[key] ?? String(value)} onChange={e => setNumbers(n => ({ ...n, [key]: e.target.value }))} className="ml-2 w-20 rounded bg-zinc-950 p-1" /></label>;
  return <section className="space-y-3 rounded-lg border border-teal-900 bg-zinc-900/40 p-3 text-xs">
    <h3 className="font-medium text-teal-200">AI Input Analysis / Deck Blueprint</h3>
    <p>Independent planning advice; never generates or changes cards. All current Main deck cards are included automatically.</p>
    {!mainEntries.length ? <p>Add cards to Main first</p> : <div><h4>Current Main deck inputs ({mainEntries.length})</h4><ul aria-label="Current Main deck inputs">
      {mainEntries.map(e => { const locked = e.quantityLocked === true || Object.hasOwn(pins, e.card.oracleId); return <li key={e.card.oracleId}>{e.card.name} ×{pins[e.card.oracleId] ?? e.quantity} · required{locked && " · quantity locked"}</li>; })}
    </ul></div>}
    <label className="block"><input type="checkbox" checked={allowColorExpansion} onChange={e => setAllowColorExpansion(e.target.checked)} />Allow color expansion</label>
    <button disabled={busy || !mainEntries.length} onClick={analyze} className="rounded border border-teal-700 px-3 py-1 disabled:opacity-40">Analyze inputs</button>
    {busy && <button onClick={() => { cancel(); setError("Analysis cancelled."); }} className="ml-3">Cancel analysis</button>}
    {error && <div role="status">{error}{error.includes("AI Settings") && <button onClick={onOpenSettings}>Open AI Settings</button>}</div>}
    {accepted && preview && <>
      <div className="space-y-2 rounded border border-zinc-700 p-2"><h4>Raw advice (read-only)</h4><h4 className="font-semibold">{accepted.raw.title}</h4><p>{accepted.raw.strategy}</p><p>{accepted.raw.rationale}</p>
        <h5>Inputs — quantity recommendations are advisory only</h5>{accepted.raw.inputs.map(input => <div key={input.oracleId}>{accepted.request.inputs.find(e => e.card.oracleId === input.oracleId)?.card.name}: {input.role} · suggested {input.recommendedQuantity} copies · {input.rationale}<ul>{input.support.map((s, i) => <li key={i}>{s}</li>)}</ul></div>)}
        <h5>Interactions / conditions</h5>{accepted.raw.interactions.map((v, i) => <div key={i}>{v.explanation}<ul>{v.conditions.map((c, j) => <li key={j}>{c}</li>)}</ul></div>)}
        <h5>Alternatives</h5>{accepted.raw.alternatives.map((v, i) => <p key={i}>{v.title}: {v.tradeoffs}</p>)}
        <h5>Uncertainties</h5><ul>{accepted.raw.uncertainties.map((v, i) => <li key={i}>{v}</li>)}</ul>
        <details><summary>Complete raw advice</summary><pre className="max-h-48 overflow-auto whitespace-pre-wrap">{JSON.stringify(accepted.raw, null, 2)}</pre></details>
      </div>
      <fieldset className="space-y-2 rounded border border-teal-900 p-2"><legend>Editable preview — SOFT targets</legend>
        <label className="block">Blueprint archetype<select className="ml-2 rounded border border-zinc-700 bg-zinc-950 p-1 text-zinc-200" aria-label="Blueprint archetype" value={preview.archetype} onChange={e => setPreview({ ...preview, archetype: e.target.value as InputCardBlueprint["archetype"] })}>{MACRO_LABELS.map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="block">Blueprint speed<select className="ml-2 rounded border border-zinc-700 bg-zinc-950 p-1 text-zinc-200" aria-label="Blueprint speed" value={preview.speed} onChange={e => setPreview({ ...preview, speed: e.target.value as InputCardBlueprint["speed"] })}>{["fast", "midrange", "slow"].map(v => <option key={v}>{v}</option>)}</select></label>
        <label className="block">Blueprint spell ratio<select className="ml-2 rounded border border-zinc-700 bg-zinc-950 p-1 text-zinc-200" aria-label="Blueprint spell ratio" value={preview.spellRatio} onChange={e => setPreview({ ...preview, spellRatio: e.target.value as InputCardBlueprint["spellRatio"] })}>{["creature-heavy", "balanced", "spell-heavy"].map(v => <option key={v}>{v}</option>)}</select></label>
        <div>Blueprint colors {colorCodes.map(c => <label key={c} className="mr-2"><input aria-label={`Blueprint color ${c}`} type="checkbox" checked={preview.colors.includes(c)} onChange={e => setPreview({ ...preview, colors: e.target.checked ? [...preview.colors, c] : preview.colors.filter(v => v !== c) })} />{c}</label>)}</div>
        <details><summary>Blueprint themes</summary>{THEMES.map(t => <label key={t.id} className="block"><input type="checkbox" checked={preview.themes.includes(t.id)} onChange={e => setPreview({ ...preview, themes: e.target.checked ? [...preview.themes, t.id] : preview.themes.filter(v => v !== t.id) })} />{t.label}</label>)}</details>
        {numeric("Blueprint land target", "landCountTarget", preview.landCountTarget)}{numeric("Blueprint average mana value", "averageManaValue", preview.averageManaValue)}
        <div className="grid grid-cols-2 gap-2">{CURVE_BUCKETS.map(bin => numeric(`Blueprint curve ${bin}`, `curve:${bin}`, preview.curveTargets[bin]))}</div>
        <details><summary>Blueprint roles (overlapping, not a partition)</summary>{Object.entries(preview.roleTargets).map(([role, value]) => numeric(`Blueprint role ${role}`, `role:${role}`, value))}</details>
      </fieldset>
      <fieldset><legend>Approve setting groups</legend>{GROUPS.map(group => <label key={group} className="mr-2"><input aria-label={`Apply ${group}`} type="checkbox" checked={groups.includes(group)} onChange={e => setGroups(g => e.target.checked ? [...g, group] : g.filter(v => v !== group))} />{group}</label>)}</fieldset>
      {invalid && <p role="alert">{invalid}</p>}
      <button disabled={!!invalid || !groups.length || busy || accepted.identity !== identity} onClick={apply} className="rounded border border-teal-700 px-3 py-1 disabled:opacity-40">Apply selected settings</button>
      <p>Legality, card quantities and pins always override SOFT composition advice. Generate Deck remains a separate action.</p>
    </>}
  </section>;
}
