import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createCallBudget, generateDeckAI, generateDeckAISequential, refineDeckAI, runRefinementLoop } from "../aiGenerator";
import type { AIProvider, AIGenerationRequest } from "../provider";
import type { GenerateOptions } from "../../generator/types";
import * as generator from "../../generator/generator";
import { card } from "../../../store/__tests__/generated.fixtures";
import { generated, MockGeneratorWorker } from "../../../components/__tests__/generator.worker.fixtures";

const options: GenerateOptions = {
  engine: "ai", format: "standard", archetype: "Midrange", colors: ["G"],
  mainboardSize: 60, maxMainboardSize: 60, aiPicksAsFinal: true, optimizationIterations: 0,
};
const pool = Array.from({ length: 50 }, (_, i) => card(`Worker Beast ${i}`, {
  manaCost: "{G}", cmc: 1, colorsJson: '["G"]', colorIdentityJson: '["G"]',
  typeLine: "Creature — Beast", oracleText: "Trample.", producedManaJson: "[]",
}));

beforeEach(() => {
  MockGeneratorWorker.instances = [];
  vi.stubGlobal("Worker", MockGeneratorWorker);
});
afterEach(() => { vi.restoreAllMocks(); vi.unstubAllGlobals(); });

describe("AI worker-backed assembly", () => {
  it("fails clearly without Worker support instead of assembling synchronously", async () => {
    vi.stubGlobal("Worker", undefined);
    const synchronous = vi.spyOn(generator, "generateDeck");
    const provider: AIProvider = { id: "fixture", label: "Fixture", isReady: async () => true,
      generate: vi.fn(async () => JSON.stringify({ main: [{ name: pool[0].name, qty: 4 }] })) };
    await expect(generateDeckAI(options, pool, provider)).rejects.toThrow(/requires Web Worker support/);
    expect(synchronous).not.toHaveBeenCalled();
    expect(vi.mocked(provider.generate).mock.calls[0][0].signal).toBeInstanceOf(AbortSignal);
  });

  it("does not dispatch assembly or expose late stream tokens after provider cancellation", async () => {
    const controller = new AbortController();
    const onToken = vi.fn();
    let finish!: (raw: string) => void;
    let emit!: (chunk: string) => void;
    const provider: AIProvider = { id: "fixture", label: "Fixture", isReady: async () => true,
      generate: vi.fn(), generateStream: vi.fn((_request, callback) => {
        emit = callback;
        return new Promise<string>((resolve) => { finish = resolve; });
      }) };
    const pending = generateDeckAI(options, pool, provider, { signal: controller.signal, onToken });
    const outcome = pending.catch((error: unknown) => error);
    controller.abort();
    emit("stale token");
    finish(JSON.stringify({ main: [{ name: pool[0].name, qty: 4 }] }));
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(onToken).not.toHaveBeenCalled();
    expect(MockGeneratorWorker.instances).toHaveLength(0);
  });

  it.each(["re-prompt", "automated refinement"] as const)("never returns a prior success when %s assembly is cancelled", async (mode) => {
    const controller = new AbortController();
    const raw = JSON.stringify({ main: [{ name: pool[0].name, qty: 4 }, { name: "Not in the pool", qty: 1 }], side: [] });
    const provider: AIProvider = { id: "fixture", label: "Fixture", isReady: async () => true, generate: vi.fn(async () => raw) };
    const config = { signal: controller.signal };
    const pending = mode === "re-prompt" ? generateDeckAI(options, pool, provider, config)
      : runRefinementLoop(options, pool, provider, generated(), 2, config);
    const outcome = pending.catch((error: unknown) => error);
    try {
      await vi.waitFor(() => expect(MockGeneratorWorker.instances).toHaveLength(1));
      if (mode === "re-prompt") {
        MockGeneratorWorker.instances[0].respond();
        await vi.waitFor(() => expect(MockGeneratorWorker.instances).toHaveLength(2));
      }
      const worker = MockGeneratorWorker.instances.at(-1)!;
      controller.abort();
      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(worker.terminated).toBe(true);
    } finally { controller.abort(); await outcome; }
  });

  it.each(["one-shot", "sequential", "refinement"] as const)("keeps %s assembly pending off-thread and aborts its worker", async (mode) => {
    const synchronous = vi.spyOn(generator, "generateDeck");
    const controller = new AbortController();
    const onToken = vi.fn();
    let providerSignal: AbortSignal | undefined;
    const raw = JSON.stringify({ main: [{ name: pool[0].name, qty: 4 }], side: [] });
    const provider: AIProvider = {
      id: "fixture", label: "Fixture", isReady: async () => true,
      generate: vi.fn(async () => raw),
      generateStream: vi.fn(async (request: AIGenerationRequest, emit: (chunk: string) => void) => {
        providerSignal = request.signal;
        emit("streamed provider token");
        return raw;
      }),
    };
    const config = { signal: controller.signal, callBudget: createCallBudget(1), onToken };
    const pending = mode === "one-shot" ? generateDeckAI(options, pool, provider, config)
      : mode === "sequential" ? generateDeckAISequential(options, pool, provider, config)
      : refineDeckAI(options, pool, provider, { messages: [] }, "Keep the core.", config);
    let settled = false;
    const outcome = pending.then((result) => { settled = true; return result; }, (error: unknown) => { settled = true; return error; });
    try {
      await vi.waitFor(() => expect(MockGeneratorWorker.instances).toHaveLength(1));
      const worker = MockGeneratorWorker.instances[0];
      expect(synchronous).not.toHaveBeenCalled();
      expect(settled).toBe(false);
      expect(providerSignal).toBe(controller.signal);
      expect(onToken).toHaveBeenCalledWith("streamed provider token");
      expect(provider.generate).not.toHaveBeenCalled();
      expect(worker.request?.options).toMatchObject({ engine: "offline", generateSideboard: false });
      expect(worker.request?.options.seedEntries?.[0]).toMatchObject({ card: { oracleId: pool[0].oracleId }, quantity: 4 });
      controller.abort();
      expect(await outcome).toMatchObject({ name: "AbortError" });
      expect(worker.terminated).toBe(true);
      worker.respond();
      expect(await outcome).toMatchObject({ name: "AbortError" });
    } finally {
      controller.abort();
      await outcome;
    }
  });
});
