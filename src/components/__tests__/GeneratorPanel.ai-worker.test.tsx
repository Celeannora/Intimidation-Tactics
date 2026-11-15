import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratorPanel } from "../GeneratorPanel";
import { db } from "../../lib/db";
import { useDeckStore } from "../../store/deckStore";
import * as generator from "../../lib/generator/generator";
import type { AIProvider, AIGenerationRequest } from "../../lib/ai/provider";
import { card } from "../../store/__tests__/generated.fixtures";
import { generated, MockGeneratorWorker } from "./generator.worker.fixtures";

// Keep the real AI module AND real Worker client: only external/provider seams are fake.
vi.mock("../../lib/meta/liveWinRate", async (importOriginal) => ({
  ...await importOriginal<typeof import("../../lib/meta/liveWinRate")>(),
  getLiveWinRateData: vi.fn().mockResolvedValue(null),
}));
vi.mock("../../lib/generator/comboLookup", () => ({ getCommanderSpellbookCombos: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/ai/factory", () => ({ makeProvider: vi.fn(() => provider) }));
vi.mock("../../lib/ai/provider", () => ({ loadAISettings: vi.fn(() => ({})) }));

const beasts = Array.from({ length: 50 }, (_, i) => card(`UI Worker Beast ${i}`, {
  manaCost: "{1}{G}", cmc: 2, typeLine: "Creature — Beast", colorsJson: '["G"]', colorIdentityJson: '["G"]',
  oracleText: "When this creature enters, destroy target creature an opponent controls.",
  power: "3", toughness: "3", producedManaJson: "[]",
}));
const forest = card("Forest", { typeLine: "Basic Land — Forest", producedManaJson: '["G"]', colorIdentityJson: '["G"]' });
const raw = JSON.stringify({ main: beasts.slice(0, 9).map((c) => ({ name: c.name, qty: 4 })), side: [] });
let signal: AbortSignal | undefined;
const provider: AIProvider = {
  id: "fixture", label: "Fixture", isReady: async () => true, generate: vi.fn(async () => raw),
  generateStream: vi.fn(async (request: AIGenerationRequest, emit: (chunk: string) => void) => {
    signal = request.signal;
    emit("Provider is streaming");
    return raw;
  }),
};
function assembled() {
  return { ...generated(), entries: [
    ...beasts.slice(0, 9).map((c) => ({ card: c, quantity: 4, board: "main" as const })),
    { card: forest, quantity: 24, board: "main" as const },
  ] };
}
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
const button = (label: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === label)!;
async function click(label: string) { await act(async () => button(label).click()); }

beforeEach(async () => {
  useDeckStore.getState().newDeck();
  MockGeneratorWorker.instances = [];
  vi.stubGlobal("Worker", MockGeneratorWorker);
  vi.spyOn(db.cards, "toArray").mockResolvedValue([...beasts, forest]);
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  await act(async () => root.render(<GeneratorPanel />));
  await click("AI Feed");
  await click("G");
});
afterEach(async () => {
  await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks(); vi.unstubAllGlobals(); vi.clearAllMocks();
});

describe("GeneratorPanel real AI worker integration", () => {
  it("cancels pending AI assembly and ignores a captured late worker callback", async () => {
    const synchronous = vi.spyOn(generator, "generateDeck");
    const before = useDeckStore.getState();
    await click("Generate Deck");
    expect(MockGeneratorWorker.instances, container.querySelector(".text-red-200")?.textContent ?? "worker dispatch").toHaveLength(1);
    expect(synchronous).not.toHaveBeenCalled();
    expect(signal?.aborted).toBe(false);
    const worker = MockGeneratorWorker.instances[0];
    const late = worker.onmessage!;
    expect(useDeckStore.getState()).toBe(before);
    await click("Cancel generation");
    expect(signal?.aborted).toBe(true);
    expect(worker.terminated).toBe(true);
    await act(async () => late({ data: { type: "result", requestId: worker.request?.requestId,
      payload: { variants: [assembled()], bestIndex: 0 } } } as MessageEvent));
    expect(useDeckStore.getState()).toBe(before);
    expect(container.textContent).toContain("Generation cancelled.");
  });

  it("applies completed AI assembly once, then keeps that deck when refinement assembly is cancelled", async () => {
    const states: unknown[] = [];
    const unsubscribe = useDeckStore.subscribe((state) => states.push(state));
    try {
      await click("Generate Deck");
      expect(MockGeneratorWorker.instances, container.querySelector(".text-red-200")?.textContent ?? "worker dispatch").toHaveLength(1);
      await act(async () => MockGeneratorWorker.instances[0].respond({ variants: [assembled()], bestIndex: 0 }));
      expect(states, container.querySelector(".text-red-200")?.textContent ?? `pending workers: ${MockGeneratorWorker.instances.length}`).toHaveLength(1);
      expect(useDeckStore.getState().validation.legal).toBe(true);
      const accepted = useDeckStore.getState();
      const input = container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Feedback"]')!;
      await act(async () => {
        Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(input, "Keep the core.");
        input.dispatchEvent(new Event("input", { bubbles: true }));
      });
      await click("Send & Regenerate");
      expect(MockGeneratorWorker.instances).toHaveLength(2);
      const worker = MockGeneratorWorker.instances[1];
      await click("Cancel generation");
      expect(worker.terminated).toBe(true);
      await act(async () => worker.respond({ variants: [assembled()], bestIndex: 0 }));
      expect(useDeckStore.getState()).toBe(accepted);
      expect(states, container.querySelector(".text-red-200")?.textContent ?? `pending workers: ${MockGeneratorWorker.instances.length}`).toHaveLength(1);
    } finally { unsubscribe(); }
  });
});
