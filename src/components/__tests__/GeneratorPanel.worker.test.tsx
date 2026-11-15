import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GeneratorPanel } from "../GeneratorPanel";
import { db } from "../../lib/db";
import { useDeckStore } from "../../store/deckStore";
import { generateDecks } from "../../lib/generator/generator";
import { card } from "../../store/__tests__/generated.fixtures";
import { generated, MockGeneratorWorker } from "./generator.worker.fixtures";
import { generateDeckAI, refineDeckAI } from "../../lib/ai/aiGenerator";
import { getLiveWinRateData } from "../../lib/meta/liveWinRate";

vi.mock("../../lib/generator/generator", () => ({ generateDecks: vi.fn() }));
vi.mock("../../lib/meta/liveWinRate", () => ({ getLiveWinRateData: vi.fn().mockResolvedValue(null) }));
vi.mock("../../lib/generator/comboLookup", () => ({ getCommanderSpellbookCombos: vi.fn().mockResolvedValue([]) }));
vi.mock("../../lib/ai/factory", () => ({ makeProvider: vi.fn(() => ({ label: "Mock provider", isReady: vi.fn().mockResolvedValue(true) })) }));
vi.mock("../../lib/ai/provider", () => ({ loadAISettings: vi.fn(() => ({})) }));
vi.mock("../../lib/ai/aiGenerator", () => ({
  generateDeckAI: vi.fn(), generateDeckAISequential: vi.fn(), refineDeckAI: vi.fn(),
  buildAIPrompts: vi.fn(), salvageDeckJSON: vi.fn(), DEFAULT_AI_TEMPERATURE: 0.4, DEFAULT_DIGEST_LIMIT: 220,
}));

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let container: HTMLDivElement;
let mounted: boolean;
const button = (text: string) => [...container.querySelectorAll("button")].find((b) => b.textContent === text)!;
async function click(text: string) { await act(async () => button(text).click()); }
async function type(element: HTMLInputElement | HTMLTextAreaElement, value: string) {
  await act(async () => {
    const prototype = element instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(prototype, "value")!.set!.call(element, value);
    element.dispatchEvent(new Event("input", { bubbles: true }));
  });
}

beforeEach(async () => {
  useDeckStore.getState().newDeck();
  MockGeneratorWorker.instances = [];
  vi.stubGlobal("Worker", MockGeneratorWorker);
  vi.spyOn(db.cards, "toArray").mockResolvedValue([card()]);
  vi.mocked(generateDecks).mockReturnValue({ variants: [generated()], bestIndex: 0 });
  container = document.createElement("div");
  document.body.appendChild(container);
  root = createRoot(container);
  mounted = true;
  await act(async () => root.render(<GeneratorPanel />));
});
afterEach(async () => {
  if (mounted) await act(async () => root.unmount());
  container.remove();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  vi.clearAllMocks();
});

describe("GeneratorPanel worker dispatch", () => {
  it("rechecks a variant before applying and preserves the accepted deck on failure", async () => {
    await click("R");
    await click("Generate Deck");
    const bad = generated();
    bad.entries = [{ card: card("Off color", { colorIdentityJson: '["U"]', oracleText: "A deck can have any number of cards named Off color." }), quantity: 60, board: "main" }];
    await act(async () => MockGeneratorWorker.instances[0].respond({ variants: [generated(), bad], bestIndex: 0 }));
    const accepted = useDeckStore.getState();
    await click("Variant 2 · 10");
    expect(useDeckStore.getState()).toBe(accepted);
    expect(container.textContent).toContain("COLOR_IDENTITY");
  });

  it("uses the captured per-card price limit even after the form limit is relaxed", async () => {
    const limit = [...container.querySelectorAll("label")].find((label) => label.textContent === "Max $/card")!.parentElement!.querySelector("input")!;
    await type(limit, "1");
    await click("Generate Deck");
    expect(MockGeneratorWorker.instances[0].request?.options.maxCardPriceUsd).toBe(1);
    await type(limit, "100");
    const before = useDeckStore.getState();
    const expensive = generated();
    expensive.entries[0].card.priceUsd = 2;
    await act(async () => MockGeneratorWorker.instances[0].respond({ variants: [expensive], bestIndex: 0 }));
    expect(useDeckStore.getState()).toBe(before);
    expect(container.textContent).toContain("MAX_CARD_PRICE");
  });

  it("does not treat the total budget soft target as an acceptance cap", async () => {
    const budget = [...container.querySelectorAll("label")].find((label) => label.textContent === "Total budget $ (soft target)")!.parentElement!.querySelector("input")!;
    await type(budget, "1");
    await click("Generate Deck");
    const expensive = generated();
    expensive.entries[0].card.priceUsd = 2;
    await act(async () => MockGeneratorWorker.instances[0].respond({ variants: [expensive], bestIndex: 0 }));
    expect(useDeckStore.getState().validation.legal).toBe(true);
  });

  it("labels budget as soft and renders all score totals, warnings, and conditional combo packages", async () => {
    expect(container.textContent).toContain("Total budget $ (soft target)");
    await click("Generate Deck");
    const result = generated();
    result.scoreBreakdown.totals.metaPerformanceContribution = 9.25;
    result.scoreBreakdown.totals.scenarioConsistencyContribution = 4.5;
    result.warnings = ["Retained construction warning"];
    result.verifiedCombos = [{
      id: "conditional", cardOracleIds: ["Island"], cardNames: ["Island"],
      description: "A test package", explanation: "Package membership is not game-state execution",
      source: "Commander Spellbook", requiredQuantities: { Island: 2 },
      prerequisites: "You must control an untapped enabler.",
    }];
    await act(async () => MockGeneratorWorker.instances[0].respond({ variants: [result], bestIndex: 0 }));
    expect(container.textContent).toContain("Meta performance: +9.3");
    expect(container.textContent).toContain("Scenario consistency: +4.5");
    expect(container.textContent).toContain("Retained construction warning");
    expect(container.textContent).toContain("Combo packages (conditions unverified)");
    expect(container.textContent).toContain("You must control an untapped enabler.");
    expect(container.textContent).not.toContain("Verified combo");
  });

  it("terminates a running Worker on unmount and never applies its late result", async () => {
    await click("Generate Deck");
    const worker = MockGeneratorWorker.instances[0];
    const before = useDeckStore.getState();
    await act(async () => root.unmount());
    mounted = false;
    expect(worker.terminated).toBe(true);
    await act(async () => worker.respond());
    expect(useDeckStore.getState()).toBe(before);
  });

  it("stops cancelled preflight before enrichment or worker dispatch", async () => {
    let finish!: (cards: ReturnType<typeof card>[]) => void;
    vi.mocked(db.cards.toArray).mockReturnValueOnce(new Promise<ReturnType<typeof card>[]>((resolve) => { finish = resolve; }) as ReturnType<typeof db.cards.toArray>);
    await click("Generate Deck");
    await click("Cancel generation");
    await act(async () => finish([card()]));
    expect(getLiveWinRateData).not.toHaveBeenCalled();
    expect(MockGeneratorWorker.instances).toHaveLength(0);
  });

  it("lets a new request win after cancellation without an old response overwriting it", async () => {
    await click("Generate Deck");
    const old = MockGeneratorWorker.instances[0];
    await click("Cancel generation");
    expect(old.terminated).toBe(true);
    await click("Generate Deck");
    const fresh = MockGeneratorWorker.instances[1];
    await act(async () => fresh.respond());
    const accepted = useDeckStore.getState();
    await act(async () => old.respond());
    expect(useDeckStore.getState()).toBe(accepted);
  });

  it("cancels explicit offline fallback without applying or reoffering stale work", async () => {
    vi.mocked(generateDeckAI).mockRejectedValue(new Error("Mock AI unavailable"));
    await click("AI Feed");
    await click("Generate Deck");
    await click("Generate offline instead");
    const worker = MockGeneratorWorker.instances[0];
    const before = useDeckStore.getState();
    await click("Cancel generation");
    expect(worker.terminated).toBe(true);
    await act(async () => worker.respond());
    expect(useDeckStore.getState()).toBe(before);
    expect(button("Generate offline instead")).toBeUndefined();
  });

  it("ignores cancelled AI refinement results and streaming callbacks after a new request", async () => {
    const initial = { ...generated(), transcript: { messages: [] } };
    vi.mocked(generateDeckAI).mockResolvedValue(initial);
    await click("AI Feed");
    await click("Generate Deck");
    let finish!: (result: typeof initial) => void;
    vi.mocked(refineDeckAI).mockReturnValueOnce(new Promise((resolve) => { finish = resolve; }));
    await type(container.querySelector<HTMLTextAreaElement>('textarea[placeholder^="Feedback"]')!, "more removal");
    await click("Send & Regenerate");
    const config = vi.mocked(refineDeckAI).mock.calls[0][5]!;
    await click("Cancel generation");
    await click("Offline (research-weighted)");
    await click("Generate Deck");
    await act(async () => {
      config.onToken?.("STALE REFINEMENT TOKEN");
      config.onRaw?.('{"main":[],"side":[],"summary":"STALE REFINEMENT RAW"}');
      config.onPassStart?.(3, 3);
      finish({ ...initial, entries: [{ card: card("Plains"), quantity: 60, board: "main" }] });
    });
    expect(container.textContent).not.toContain("STALE REFINEMENT");
    await act(async () => MockGeneratorWorker.instances[0].respond());
    expect(useDeckStore.getState().entries[0].card.name).toBe("Island");
  });

  it("runs explicit AI failure fallback in a cancellable Worker using the AI request snapshot", async () => {
    vi.mocked(generateDeckAI).mockRejectedValue(new Error("Mock AI unavailable"));
    await click("AI Feed");
    await click("Generate Deck");
    expect(MockGeneratorWorker.instances).toHaveLength(0);
    const format = container.querySelector("select")!;
    await act(async () => {
      format.value = "commander";
      format.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Generate offline instead");
    expect(MockGeneratorWorker.instances).toHaveLength(1);
    expect(generateDecks).not.toHaveBeenCalled();
    expect(MockGeneratorWorker.instances[0].request?.options).toMatchObject({ engine: "offline", format: "standard" });
    await act(async () => MockGeneratorWorker.instances[0].respond());
    expect(useDeckStore.getState().format).toBe("standard");
    expect(container.textContent).toContain("Offline fallback — not AI-authored");
  });

  it("rejects a forged legal flag using captured generation constraints and surfaces violations", async () => {
    await click("R");
    const before = useDeckStore.getState();
    await click("Generate Deck");
    const bad = generated();
    bad.entries = [
      { card: card("Off color", { typeLine: "Creature", colorIdentityJson: '["U"]' }), quantity: 1, board: "main" },
      { card: card(), quantity: 59, board: "main" },
    ];
    bad.validation = { legal: true, mainCount: 60, sideCount: 0, violations: [] };
    bad.warnings = ["Provider warned about this construction"];
    await act(async () => MockGeneratorWorker.instances[0].respond({ variants: [bad], bestIndex: 0 }));
    expect(useDeckStore.getState()).toBe(before);
    expect(container.textContent).toContain("outside selected colors");
    expect(container.textContent).toContain("Off color");
    expect(container.textContent).toContain("Provider warned about this construction");
  });

  it("binds variant application to the request snapshot, not later form edits", async () => {
    await click("Generate Deck");
    const worker = MockGeneratorWorker.instances[0];
    const format = container.querySelector("select")!;
    await act(async () => {
      format.value = "commander";
      format.dispatchEvent(new Event("change", { bubbles: true }));
      worker.respond({ variants: [generated(), generated()], bestIndex: 0 });
    });
    expect(useDeckStore.getState().format).toBe("standard");
    const formatAfterApply = container.querySelector("select")!;
    await act(async () => {
      formatAfterApply.value = "modern";
      formatAfterApply.dispatchEvent(new Event("change", { bubbles: true }));
    });
    await click("Variant 2 · 10");
    expect(useDeckStore.getState().format).toBe("standard");
    expect(useDeckStore.getState().validation.legal).toBe(true);
  });

  it("passes pins as exact quantity-locked seeds", async () => {
    await act(async () => {
      useDeckStore.getState().importEntries([{ card: card("Pinned", { typeLine: "Creature" }), quantity: 2, board: "main" }], true);
      useDeckStore.getState().pinCard("Pinned");
    });
    await click("Generate Deck");
    expect(MockGeneratorWorker.instances[0].request?.options.seedEntries).toContainEqual(
      expect.objectContaining({ quantity: 2, quantityLocked: true }),
    );
  });

  it("uses a module Worker for offline generation and applies one accepted result atomically", async () => {
    const states: unknown[] = [];
    const unsubscribe = useDeckStore.subscribe((state) => states.push(state));
    try {
      await click("Generate Deck");
      expect(MockGeneratorWorker.instances).toHaveLength(1);
      expect(generateDecks).not.toHaveBeenCalled();
      expect(useDeckStore.getState().entries).toHaveLength(0);
      await act(async () => MockGeneratorWorker.instances[0].respond());
      expect(useDeckStore.getState().validation.legal).toBe(true);
      expect(states).toHaveLength(1);
    } finally { unsubscribe(); }
  });
});
