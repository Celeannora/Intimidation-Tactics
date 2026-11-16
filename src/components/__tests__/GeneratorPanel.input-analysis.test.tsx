import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, expect, it, vi } from "vitest";
import { GeneratorPanel } from "../GeneratorPanel";
import { db } from "../../lib/db";
import { useDeckStore } from "../../store/deckStore";
import { card } from "../../store/__tests__/generated.fixtures";
import { MockGeneratorWorker } from "./generator.worker.fixtures";
import { makeProvider } from "../../lib/ai/factory";
import type { InputCardBlueprint } from "../../lib/ai/inputAnalysisTypes";

const blueprint: InputCardBlueprint = {
  schemaVersion: 1, title: "Red plan", strategy: "Apply pressure", rationale: "Keep the curve low",
  archetype: "Aggro", secondaryArchetypes: [], themes: [], colors: ["R"], speed: "fast", spellRatio: "creature-heavy",
  averageManaValue: 2, landCountTarget: 24,
  curveTargets: { "0": 0, "1": 12, "2": 12, "3": 8, "4": 4, "5": 0, "6+": 0 },
  roleTargets: { threats: 24, removal: 8, boardWipes: 0, counterspells: 0, cardDraw: 4, ramp: 0, enablers: 4, payoffs: 4 },
  inputs: [{ oracleId: "Input", role: "Threat", recommendedQuantity: 4, support: ["Early threats"], rationale: "Pressure" }],
  interactions: [], alternatives: [{ title: "Go slower", tradeoffs: "Less early pressure" }], uncertainties: ["Advice, not a win-rate prediction"],
};
let providerSequence = 0;
const provider = (generate = vi.fn().mockResolvedValue(JSON.stringify(blueprint))) => ({ id: `test-ui-${++providerSequence}`, label: "Test", isReady: vi.fn().mockResolvedValue(true), generate });
async function chooseInput() {
  await act(async () => useDeckStore.getState().addCard(card("Input", { typeLine: "Creature", cmc: 2, colorIdentityJson: '["R"]' }), "main"));
}

vi.mock("../../lib/meta/liveWinRate", () => ({ getLiveWinRateData: vi.fn().mockResolvedValue(null) }));
vi.mock("../../lib/generator/comboLookup", () => ({ getCommanderSpellbookCombos: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/ai/factory", () => ({ makeProvider: vi.fn() }));
vi.mock("../../lib/ai/provider", () => ({ loadAISettings: vi.fn(() => ({ providerId: "none" })) }));
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const button = (text: string) => [...container.querySelectorAll("button")].find(b => b.textContent === text);
const click = async (text: string) => { await act(async () => button(text)!.click()); };
beforeEach(async () => {
  useDeckStore.getState().newDeck();
  vi.spyOn(db.cards, "toArray").mockResolvedValue([card()]);
  vi.spyOn(db.meta, "get").mockResolvedValue({ key: "lastImportedAt", value: "ui-test" });
  vi.stubGlobal("Worker", MockGeneratorWorker);
  MockGeneratorWorker.instances = [];
  container = document.createElement("div"); document.body.append(container);
  root = createRoot(container);
  await act(async () => root.render(<GeneratorPanel />));
});
afterEach(async () => { await act(async () => root.unmount()); container.remove(); vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks(); });
it("offers independent input analysis without generating a deck, and guides empty inputs to Search", async () => {
  const before = useDeckStore.getState();
  expect(container.textContent).toContain("AI Input Analysis / Deck Blueprint");
  expect(container.textContent).toContain("Add cards to Main first");
  expect(button("Analyze inputs")?.disabled).toBe(true);
  expect(MockGeneratorWorker.instances).toHaveLength(0);
  expect(useDeckStore.getState()).toBe(before);
  expect(button("Analyze")).toBeDefined();
  expect(button("Generate Deck")).toBeDefined();
});
it("requires AI Settings without an offline fallback or store writes", async () => {
  await act(async () => useDeckStore.getState().addCard(card("Input", { typeLine: "Creature", colorIdentityJson: '["R"]' }), "main"));
  const before = useDeckStore.getState();
  await click("Analyze inputs");
  expect(container.textContent).toContain("Open AI Settings");
  expect(MockGeneratorWorker.instances).toHaveLength(0);
  expect(useDeckStore.getState()).toBe(before);
});
it("analyzes and applies approved settings without a Worker or store write, then forwards targets on explicit Generate", async () => {
  await chooseInput();
  const ai = provider(); vi.mocked(makeProvider).mockReturnValue(ai);
  const before = useDeckStore.getState();
  await click("Analyze inputs");
  expect(container.textContent).toContain("Red plan");
  expect(container.textContent).toContain("Raw advice (read-only)");
  expect(container.textContent).toContain("Editable preview");
  await click("Apply selected settings");
  expect(useDeckStore.getState()).toBe(before);
  expect(MockGeneratorWorker.instances).toHaveLength(0);
  expect(ai.generate).toHaveBeenCalledTimes(1);
  await click("Generate Deck");
  expect(MockGeneratorWorker.instances).toHaveLength(1);
  expect(MockGeneratorWorker.instances[0].request?.options).toMatchObject({ engine: "offline", format: "standard", mainboardSize: 60, archetype: "Aggro", speed: "fast", landCountTarget: 24, curveTargets: blueprint.curveTargets, targetAverageManaValue: 2, roleTargetOverrides: blueprint.roleTargets });
  expect(ai.generate).toHaveBeenCalledTimes(1);
});
it.each(["clear", "format", "size"])("clears composition overrides on %s before the next explicit generation", async reason => {
  await chooseInput(); vi.mocked(makeProvider).mockReturnValue(provider());
  await click("Analyze inputs"); await click("Apply selected settings");
  if (reason === "clear") await click("Clear blueprint settings");
  else {
    const label = [...container.querySelectorAll("label")].find(l => l.textContent === (reason === "format" ? "Format" : "Deck size"))!;
    const control = label.parentElement!.querySelector<HTMLInputElement | HTMLSelectElement>(reason === "format" ? "select" : "input")!;
    await act(async () => {
      Object.getOwnPropertyDescriptor(reason === "format" ? HTMLSelectElement.prototype : HTMLInputElement.prototype, "value")!.set!.call(control, reason === "format" ? "modern" : "61");
      control.dispatchEvent(new Event(reason === "format" ? "change" : "input", { bubbles: true }));
    });
  }
  await click("Generate Deck");
  const options = MockGeneratorWorker.instances[0].request!.options;
  expect(options.landCountTarget).toBeUndefined(); expect(options.curveTargets).toBeUndefined();
  expect(options.targetAverageManaValue).toBeUndefined(); expect(options.roleTargetOverrides).toBeUndefined();
});
it("cancels pending advice and ignores its late provider response", async () => {
  await chooseInput();
  let finish!: (s: string) => void;
  const ai = provider(vi.fn(() => new Promise<string>(resolve => { finish = resolve; })));
  vi.mocked(makeProvider).mockReturnValue(ai);
  await click("Analyze inputs");
  expect(button("Cancel analysis")).toBeDefined();
  await click("Cancel analysis");
  await act(async () => finish(JSON.stringify(blueprint)));
  expect(button("Apply selected settings")).toBeUndefined();
  expect(container.textContent).not.toContain("Red plan");
});
it("invalidates advice after input quantity changes", async () => {
  await chooseInput(); vi.mocked(makeProvider).mockReturnValue(provider());
  await click("Analyze inputs");
  expect(button("Apply selected settings")?.disabled).toBe(false);
  await act(async () => useDeckStore.getState().setQuantity("Input", "main", 2));
  expect(button("Apply selected settings")).toBeUndefined();
});
it("rejects an edited invalid curve sum without mutating the deck", async () => {
  await chooseInput(); vi.mocked(makeProvider).mockReturnValue(provider());
  await click("Analyze inputs");
  const before = useDeckStore.getState();
  const input = container.querySelector<HTMLInputElement>('input[aria-label="Blueprint curve 1"]')!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")!.set!.call(input, "13");
    input.dispatchEvent(new Event("input", { bubbles: true }));
  });
  expect(button("Apply selected settings")?.disabled).toBe(true);
  expect(useDeckStore.getState()).toBe(before);
});
