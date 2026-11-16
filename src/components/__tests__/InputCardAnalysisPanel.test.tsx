import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { InputCardAnalysisPanel } from "../InputCardAnalysisPanel";
import { card } from "../../store/__tests__/generated.fixtures";
import { makeProvider } from "../../lib/ai/factory";
import { loadAISettings, type AIProvider, type AISettings } from "../../lib/ai/provider";
import type { AIChatMessage } from "../../lib/ai/provider";
import { db } from "../../lib/db";
import type { InputCardBlueprint } from "../../lib/ai/inputAnalysisTypes";
import type { DeckEntry } from "../../lib/legality";
vi.mock("../../lib/ai/factory", () => ({ makeProvider: vi.fn() }));
vi.mock("../../lib/ai/provider", () => ({ loadAISettings: vi.fn() }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
const advice: InputCardBlueprint = {
  schemaVersion: 1, title: "Component plan", strategy: "Pressure", rationale: "Early threats", archetype: "Aggro", secondaryArchetypes: [], themes: [], colors: ["R"], speed: "fast", spellRatio: "balanced", averageManaValue: 2, landCountTarget: 24,
  curveTargets: { "0": 0, "1": 12, "2": 12, "3": 8, "4": 4, "5": 0, "6+": 0 },
  roleTargets: { threats: 24, removal: 8, boardWipes: 0, counterspells: 0, cardDraw: 4, ramp: 0, enablers: 4, payoffs: 4 },
  inputs: [{ oracleId: "source", role: "Threat", recommendedQuantity: 1, support: [], rationale: "Pressure" }], interactions: [], alternatives: [], uncertainties: [],
};
let root: Root, host: HTMLDivElement;
let entries: DeckEntry[];
let settings: AISettings;
let sequence = 0;
const onApply = vi.fn();
const adviceFor = (messages: AIChatMessage[]) => {
  const payload = JSON.parse(messages.at(-1)!.content) as { inputs: { oracleId: string; quantity: number; quantityLocked: boolean }[] };
  return JSON.stringify({ ...advice, inputs: payload.inputs.map(input => ({ ...advice.inputs[0], oracleId: input.oracleId, recommendedQuantity: input.quantityLocked ? input.quantity : Math.max(input.quantity, 1) })) });
};
const button = (text: string) => [...host.querySelectorAll("button")].find(b => b.textContent === text);
const click = async (text: string) => { await act(async () => button(text)!.click()); };
const render = async (extra = {}) => { await act(async () => root.render(<InputCardAnalysisPanel entries={entries} format="standard" mainboardSize={60} colors={[]} onApply={onApply} {...extra} />)); };
beforeEach(async () => {
  sequence++;
  entries = [{ card: card("source", { typeLine: "Creature", colorIdentityJson: '["R"]', cmc: 2 }), quantity: 1, board: "main" }];
  settings = { providerId: "openai", openaiModel: `component-${sequence}`, openaiApiKey: "never-in-cache" };
  vi.mocked(loadAISettings).mockImplementation(() => settings);
  vi.mocked(makeProvider).mockReturnValue({ id: `provider-${sequence}`, label: "Mock", isReady: vi.fn().mockResolvedValue(true), generate: vi.fn(async (request: Parameters<AIProvider["generate"]>[0]) => adviceFor(request.messages)) });
  vi.spyOn(db.meta, "get").mockResolvedValue({ key: "lastImportedAt", value: "dataset-1" });
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
  await render();
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); vi.restoreAllMocks(); vi.clearAllMocks(); });
it("keeps pinned quantities and required state read-only", async () => {
  entries = [{ ...entries[0], quantity: 2 }];
  await render({ pins: { source: 3 } });
  expect(host.textContent).toContain("source ×3 · required · quantity locked");
  expect(host.querySelector('[aria-label="Analyze source"]')).toBeNull();
  await click("Analyze inputs"); await click("Apply selected settings");
  expect(onApply).toHaveBeenCalledWith(expect.not.objectContaining({ inputs: expect.anything() }));
  expect(entries[0].quantity).toBe(2);
});
it("only applies explicitly checked setting groups", async () => {
  await click("Analyze inputs");
  for (const group of ["Strategy", "Colors", "Themes", "Roles"]) await act(async () => host.querySelector<HTMLInputElement>(`[aria-label="Apply ${group}"]`)!.click());
  await click("Apply selected settings");
  expect(onApply).toHaveBeenCalledWith({ landCountTarget: 24, curveTargets: advice.curveTargets, targetAverageManaValue: 2 });
});
it("refreshes provider settings before Apply and rejects a changed model", async () => {
  await click("Analyze inputs"); settings = { ...settings, openaiModel: "different" };
  await click("Apply selected settings"); expect(onApply).not.toHaveBeenCalled();
  expect(host.textContent).toContain("stale");
});
it("invalidates visible advice on provider settings notification", async () => {
  await click("Analyze inputs"); settings = { ...settings, openaiModel: "changed" };
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(button("Apply selected settings")).toBeUndefined();
});
it("cannot apply after unmount while dataset preflight is pending", async () => {
  await click("Analyze inputs");
  let resolve!: (v: { key: string; value: string }) => void;
  vi.mocked(db.meta.get).mockImplementationOnce(() => new Promise(r => { resolve = r; }) as ReturnType<typeof db.meta.get>);
  await click("Apply selected settings");
  await act(async () => root.unmount());
  await act(async () => resolve({ key: "lastImportedAt", value: "dataset-1" }));
  expect(onApply).not.toHaveBeenCalled();
  root = createRoot(host);
});
it("invalidates visible advice when the dataset changes", async () => {
  await click("Analyze inputs");
  vi.mocked(db.meta.get).mockResolvedValue({ key: "lastImportedAt", value: "dataset-2" });
  await act(async () => window.dispatchEvent(new Event("focus")));
  expect(button("Apply selected settings")).toBeUndefined();
});
it("does not apply an old approval selection after the user edits it during preflight", async () => {
  await click("Analyze inputs");
  let resolve!: (v: { key: string; value: string }) => void;
  vi.mocked(db.meta.get).mockImplementationOnce(() => new Promise(r => { resolve = r; }) as ReturnType<typeof db.meta.get>);
  await click("Apply selected settings");
  await act(async () => host.querySelector<HTMLInputElement>('[aria-label="Apply Composition"]')!.click());
  await act(async () => resolve({ key: "lastImportedAt", value: "dataset-1" }));
  expect(onApply).not.toHaveBeenCalled();
});
it("preserves accepted advice when a same-context refresh fails", async () => {
  await click("Analyze inputs");
  const ai=vi.mocked(makeProvider).mock.results.at(-1)!.value!;
  vi.spyOn(Date,"now").mockReturnValue(9000000000000);
  vi.mocked(ai.generate).mockRejectedValue(new Error("Refresh failed"));
  await click("Analyze inputs");
  expect(host.textContent).toContain("Refresh failed");
  expect(host.textContent).toContain("Component plan");
  expect(button("Apply selected settings")?.disabled).toBe(false);
  expect(onApply).not.toHaveBeenCalled();
});
it("reports provider errors without applying settings", async () => {
  vi.mocked(makeProvider).mockReturnValue({ id: `error-${sequence}`, label: "Mock", isReady: vi.fn().mockResolvedValue(true), generate: vi.fn().mockRejectedValue(new Error("Provider refused")) });
  await click("Analyze inputs");
  expect(host.textContent).toContain("Provider refused"); expect(onApply).not.toHaveBeenCalled();
});
it("does not reuse advice across distinct configured provider endpoints", async () => {
  settings = { providerId: "ollama", ollamaModel: "same-model", ollamaBaseUrl: "http://first.invalid" };
  await click("Analyze inputs");
  const ai = vi.mocked(makeProvider).mock.results.at(-1)!.value!;
  settings = { ...settings, ollamaBaseUrl: "http://second.invalid" };
  await click("Analyze inputs");
  expect(ai.generate).toHaveBeenCalledTimes(2);
});
it("invalidates a pending provider result on settings notification even if settings later revert", async () => {
  let finish!: (v: string) => void;
  const ai = vi.mocked(makeProvider).mock.results.at(-1)?.value;
  const generate = vi.fn(() => new Promise<string>(resolve => { finish = resolve; }));
  vi.mocked(makeProvider).mockReturnValue({ id: ai?.id ?? `pending-${sequence}`, label: "Mock", isReady: vi.fn().mockResolvedValue(true), generate });
  await click("Analyze inputs");
  const previous = settings; settings = { ...settings, openaiModel: "temporary" };
  await act(async () => window.dispatchEvent(new Event("focus")));
  settings = previous;
  await act(async () => finish(JSON.stringify(advice)));
  expect(button("Apply selected settings")).toBeUndefined();
  expect(button("Cancel analysis")).toBeUndefined();
});
it("automatically sends every distinct current mainboard card in one Analyze action", async () => {
  entries = Array.from({ length: 7 }, (_, i) => ({ ...entries[0], card: card(`input-${i}`, { typeLine: "Creature", manaCost: `{${i + 1}}`, colorIdentityJson: '["R"]', cmc: i + 1 }), quantity: i === 0 ? 2 : 1, quantityLocked: i === 1 }));
  const currentMainEntries = [...entries];
  entries.push({ ...entries[0], card: card("sideboard-only", { typeLine: "Creature" }), board: "side" });
  const pins = { "input-0": 3 };
  await render({ pins });
  expect(host.textContent).toContain("Current Main deck inputs (7)");
  expect(host.querySelector('[aria-label^="Analyze input-"]')).toBeNull();
  expect(host.querySelector('[aria-label^="Required input-"]')).toBeNull();
  await click("Analyze inputs");
  const ai = vi.mocked(makeProvider).mock.results.at(-1)!.value!;
  expect(ai.generate).toHaveBeenCalledTimes(1);
  const payload = JSON.parse(ai.generate.mock.calls[0][0].messages[1].content);
  expect(payload.inputs).toHaveLength(7);
  expect(payload.inputs.map((input: { oracleId: string }) => input.oracleId)).toEqual(currentMainEntries.map(e => e.card.oracleId));
  expect(payload.inputs.map((input: { name: string }) => input.name)).toEqual(currentMainEntries.map(e => e.card.name));
  expect(payload.inputs[0]).toMatchObject({ quantity: 3, quantityLocked: true, required: true, typeLine: "Creature", manaValue: 1 });
  expect(payload.inputs[1]).toMatchObject({ quantity: 1, quantityLocked: true, required: true });
  expect(payload.inputs.slice(2).every((input: { quantityLocked: boolean; required: boolean }) => !input.quantityLocked && input.required)).toBe(true);
});
it("automatically includes new and replacement mainboard cards and excludes removed cards", async () => {
  await click("Analyze inputs");
  const ai = vi.mocked(makeProvider).mock.results.at(-1)!.value!;
  const userPayload = () => JSON.parse(ai.generate.mock.calls.at(-1)![0].messages[1].content);
  expect(userPayload().inputs.map((input: { oracleId: string }) => input.oracleId)).toEqual(["source"]);
  entries = [...entries, { ...entries[0], card: card("added", { typeLine: "Creature", colorIdentityJson: "[]" }) }];
  await render();
  await click("Analyze inputs");
  expect(userPayload().inputs.map((input: { oracleId: string }) => input.oracleId)).toEqual(["source", "added"]);
  entries = entries.filter(e => e.card.oracleId !== "source");
  await render();
  await click("Analyze inputs");
  expect(userPayload().inputs.map((input: { oracleId: string }) => input.oracleId)).toEqual(["added"]);
  entries = [{ ...entries[0], card: card("replacement", { typeLine: "Creature", colorIdentityJson: "[]" }) }];
  await render();
  await click("Analyze inputs");
  expect(userPayload().inputs.map((input: { oracleId: string }) => input.oracleId)).toEqual(["replacement"]);
});
it("asks for cards in Main and disables analysis for an empty deck", async () => {
  entries = []; await render();
  expect(host.textContent).toContain("Add cards to Main first");
  expect(button("Analyze inputs")!.disabled).toBe(true);
});
it("renders all three blueprint selectors with explicit dark, legible field styling", async () => {
  await click("Analyze inputs");
  const selectors = [...host.querySelectorAll("select")];
  expect(selectors).toHaveLength(3);
  for (const label of ["Blueprint archetype", "Blueprint speed", "Blueprint spell ratio"]) {
    const select = host.querySelector<HTMLSelectElement>(`select[aria-label="${label}"]`)!;
    expect(select).not.toBeNull();
    for (const className of ["rounded", "border", "border-zinc-700", "bg-zinc-950", "text-zinc-200", "p-1"]) {
      expect(select.classList.contains(className), `${label}: ${className}`).toBe(true);
    }
  }
});
