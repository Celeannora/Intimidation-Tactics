import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateDecksInWorker } from "../client";
import { generated, MockGeneratorWorker, options } from "../../../components/__tests__/generator.worker.fixtures";
import { card } from "../../../store/__tests__/generated.fixtures";
import { useDeckStore } from "../../../store/deckStore";
import type { GenerateResult } from "../types";
import { buildCardBreakdowns, topSynergyPairs } from "../../analysis/reasoningView";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MythicViabilityPanel } from "../../../components/MythicViabilityPanel";
import { ScenarioCoveragePanel } from "../../../components/ScenarioCoveragePanel";

// Nonempty values exercise every rendered optional branch, not just array guards.
function completeResult(): GenerateResult {
  const result = generated();
  result.diagnostics.primaryAxes = ["draw"];
  result.diagnostics.reasoning = ["Selected for card advantage"];
  result.cardReasons = { Island: ["Mana source"] };
  result.scoreBreakdown.cardScores = [{
    oracleId: "Island", name: "Island", quantity: 60, board: "main", perCopyScore: 1, contribution: 60,
    roleMultiplier: 1, powerScore: 1, rolePowerContribution: 1, colorAffinity: 0, synergyScore: 0,
    synergyContribution: 0, directionalScore: 0, directionalContribution: 0, signalScore: 0,
    signalContribution: 0, focusBonus: 0, focusCardBonus: 0, tribalBonus: 0, cmcPenalty: 0, pricePenalty: 0,
  }];
  result.warnings = ["Heuristic output"];
  result.validation = { legal: true, mainCount: 60, sideCount: 0, violations: [{ rule: "INFO", message: "Control", cardNames: ["Island"] }] };
  result.verifiedCombos = [{ id: "combo", cardOracleIds: ["a", "b"], cardNames: ["A", "B"],
    description: "Draw", explanation: "A feeds B", source: "Commander Spellbook", requiredQuantities: { a: 1 }, prerequisites: "Untapped" }];
  result.deckSynergyGraph = { nodes: [], edges: [{ fromOracleId: "a", toOracleId: "b", fromName: "A", toName: "B",
    axis: "draw", kind: "source-to-payoff", explanation: "A feeds B", weight: 0.8 }],
    connectedAxes: [], axisSeedCardCounts: {}, density: 1, weightedDensity: 0.8, narrative: "Draw engine" };
  result.comboChains = [{ oracleIds: ["a", "b", "c"], cardNames: ["A", "B", "C"], axes: ["draw"],
    kind: "linear", chainScore: 1.6, explanation: "Draw chain" }];
  result.scenarioCoverage = { coveredCount: 1, totalScenarios: 1, consistencyScore: 100,
    scenarios: [{ scenarioId: "test", scenarioName: "Test", sourceArchetypeNames: ["Aggro"], covered: true, answeringCards: ["A"] }] };
  result.mythicViability = { structural: { score: 70, manaBase: 70, curve: 70, landRatio: 70,
    fourOfDensity: 70, synergyDensity: 70, notes: ["Sound mana"] }, competitive: { matched: true,
    winRate: 55, confidenceInterval: [53, 57], sampleSize: 100, sourceArchetype: "Control", matchConfidence: 0.9, lastUpdated: 1, source: "test" } };
  result.tempoScore = 50;
  result.cardAdvantageScore = 60;
  result.synergyViolations = [{ constraintId: "draw", description: "Needs draw", payoffCards: ["A"],
    sourceCount: 1, requiredSources: 2, severity: "warning" }];
  return result;
}

async function acceptAndApply(result: GenerateResult) {
  const promise = generateDecksInWorker(options, [], new AbortController().signal).then((payload) => {
    const selected = payload.variants[payload.bestIndex];
    expect(useDeckStore.getState().applyGeneratedDeck(selected.entries, "standard", "Accepted").legal).toBe(true);
    return selected;
  });
  MockGeneratorWorker.instances.at(-1)!.respond({ variants: [result], bestIndex: 0 });
  return promise;
}

async function rejectsWithoutApply(mutate: (result: GenerateResult) => void) {
  await expect(acceptAndApply(completeResult())).resolves.toMatchObject({ totalCards: 60 });
  const before = useDeckStore.getState();
  const notifications = vi.fn();
  const unsubscribe = useDeckStore.subscribe(notifications);
  const result = completeResult();
  mutate(result);
  try {
    const pending = acceptAndApply(result);
    await expect(pending).rejects.toThrow(/malformed/i);
    const worker = MockGeneratorWorker.instances.at(-1)!;
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    expect(worker.onerror).toBeNull();
    expect(useDeckStore.getState()).toBe(before);
    expect(notifications).not.toHaveBeenCalled();
  } finally { unsubscribe(); }
}


beforeEach(() => {
  MockGeneratorWorker.instances = [];
  vi.stubGlobal("Worker", MockGeneratorWorker);
});
afterEach(() => vi.unstubAllGlobals());

describe("generator worker client", () => {
  it("accepts a complete nonempty rendered result", async () => {
    const result = await acceptAndApply(completeResult());
    expect(buildCardBreakdowns(result.scoreBreakdown.cardScores)).toHaveLength(1);
    expect(topSynergyPairs(result.deckSynergyGraph)).toHaveLength(1);
    expect(renderToStaticMarkup(createElement(MythicViabilityPanel, {
      report: result.mythicViability!, tempoScore: result.tempoScore,
      cardAdvantageScore: result.cardAdvantageScore, comboChains: result.comboChains,
      verifiedCombos: result.verifiedCombos,
    }))).toContain("Draw chain");
    expect(renderToStaticMarkup(createElement(ScenarioCoveragePanel, { coverage: result.scenarioCoverage! }))).toContain("Aggro");
    expect(MockGeneratorWorker.instances.at(-1)!.terminated).toBe(true);
  });

  it("rejects a null score card before any store application", async () => {
    await rejectsWithoutApply(result => { result.scoreBreakdown.cardScores = [null as never]; });
  });

  it.each([
    ["score name", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].name = {} as never; }],
    ["score board", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].board = "invalid" as never; }],
    ["score quantity", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].quantity = NaN; }],
    ["score contribution", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].contribution = "1" as never; }],
    ["score per-copy", (r: GenerateResult) => { delete (r.scoreBreakdown.cardScores[0] as unknown as Record<string, unknown>).perCopyScore; }],
    ["score role term", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].rolePowerContribution = null as never; }],
    ["score directional term", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].directionalContribution = Infinity; }],
    ["score optional term", (r: GenerateResult) => { r.scoreBreakdown.cardScores[0].efficiencyContribution = {} as never; }],
    ["diagnostic axes", (r: GenerateResult) => { r.diagnostics.primaryAxes = [{} as never]; }],
    ["diagnostic reasoning", (r: GenerateResult) => { r.diagnostics.reasoning = [{} as never]; }],
    ["card reasons", (r: GenerateResult) => { r.cardReasons.Island = [null as never]; }],
    ["card reasons array", (r: GenerateResult) => { r.cardReasons = [] as never; }],
  ] as const)("rejects malformed %s without publishing state", async (_name, mutate) => {
    await rejectsWithoutApply(mutate);
  });

  it.each([
    ["warnings", (r: GenerateResult) => { r.warnings = [{} as never]; }],
    ["null warnings", (r: GenerateResult) => { r.warnings = null as never; }],
    ["AI summary", (r: GenerateResult) => { r.aiSummary = {} as never; }],
    ["AI game plan", (r: GenerateResult) => { r.aiGamePlan = {} as never; }],
    ["validation object", (r: GenerateResult) => { r.validation = null as never; }],
    ["validation legal", (r: GenerateResult) => { r.validation!.legal = "yes" as never; }],
    ["validation violations", (r: GenerateResult) => { r.validation!.violations = [null as never]; }],
    ["validation message", (r: GenerateResult) => { r.validation!.violations[0].message = {} as never; }],
    ["validation card names", (r: GenerateResult) => { r.validation!.violations[0].cardNames = [{} as never]; }],
    ["combo collection", (r: GenerateResult) => { r.verifiedCombos = {} as never; }],
    ["combo row", (r: GenerateResult) => { r.verifiedCombos = [null as never]; }],
    ["combo identities", (r: GenerateResult) => { r.verifiedCombos![0].cardOracleIds = {} as never; }],
    ["combo names", (r: GenerateResult) => { r.verifiedCombos![0].cardNames = [{} as never]; }],
    ["combo explanation", (r: GenerateResult) => { r.verifiedCombos![0].explanation = {} as never; }],
    ["combo quantities", (r: GenerateResult) => { r.verifiedCombos![0].requiredQuantities = { a: {} as never }; }],
    ["combo prerequisites", (r: GenerateResult) => { r.verifiedCombos![0].prerequisites = {} as never; }],
  ] as const)("rejects malformed optional %s without publishing state", async (_name, mutate) => {
    await rejectsWithoutApply(mutate);
  });

  it.each([
    ["graph object", (r: GenerateResult) => { r.deckSynergyGraph = null as never; }],
    ["graph edges", (r: GenerateResult) => { r.deckSynergyGraph!.edges = {} as never; }],
    ["graph row", (r: GenerateResult) => { r.deckSynergyGraph!.edges = [null as never]; }],
    ["graph name", (r: GenerateResult) => { r.deckSynergyGraph!.edges[0].fromName = {} as never; }],
    ["graph weight", (r: GenerateResult) => { r.deckSynergyGraph!.edges[0].weight = "0.8" as never; }],
    ["graph kind", (r: GenerateResult) => { r.deckSynergyGraph!.edges[0].kind = "unknown" as never; }],
    ["graph density", (r: GenerateResult) => { r.deckSynergyGraph!.weightedDensity = NaN; }],
    ["chains collection", (r: GenerateResult) => { r.comboChains = {} as never; }],
    ["chains row", (r: GenerateResult) => { r.comboChains = [null as never]; }],
    ["chain identities", (r: GenerateResult) => { r.comboChains![0].oracleIds = {} as never; }],
    ["chain explanation", (r: GenerateResult) => { r.comboChains![0].explanation = {} as never; }],
    ["scenario object", (r: GenerateResult) => { r.scenarioCoverage = null as never; }],
    ["scenario rows", (r: GenerateResult) => { r.scenarioCoverage!.scenarios = [null as never]; }],
    ["scenario name", (r: GenerateResult) => { r.scenarioCoverage!.scenarios[0].scenarioName = {} as never; }],
    ["scenario sources", (r: GenerateResult) => { r.scenarioCoverage!.scenarios[0].sourceArchetypeNames = {} as never; }],
    ["scenario answers", (r: GenerateResult) => { r.scenarioCoverage!.scenarios[0].answeringCards = [{} as never]; }],
    ["scenario counts", (r: GenerateResult) => { r.scenarioCoverage!.coveredCount = {} as never; }],
    ["mythic object", (r: GenerateResult) => { r.mythicViability = null as never; }],
    ["mythic structure", (r: GenerateResult) => { r.mythicViability!.structural = {} as never; }],
    ["mythic notes", (r: GenerateResult) => { r.mythicViability!.structural.notes = [{} as never]; }],
    ["mythic competition", (r: GenerateResult) => { r.mythicViability!.competitive = null as never; }],
    ["mythic win rate", (r: GenerateResult) => { r.mythicViability!.competitive.winRate = "55" as never; }],
    ["mythic interval", (r: GenerateResult) => { r.mythicViability!.competitive.confidenceInterval = [53] as never; }],
    ["mythic archetype", (r: GenerateResult) => { r.mythicViability!.competitive.sourceArchetype = {} as never; }],
    ["tempo", (r: GenerateResult) => { r.tempoScore = null as never; }],
    ["card advantage", (r: GenerateResult) => { r.cardAdvantageScore = "60" as never; }],
    ["synergy violations", (r: GenerateResult) => { r.synergyViolations = [null as never]; }],
    ["synergy payoff names", (r: GenerateResult) => { r.synergyViolations![0].payoffCards = {} as never; }],
    ["synergy description", (r: GenerateResult) => { r.synergyViolations![0].description = {} as never; }],
    ["synergy source count", (r: GenerateResult) => { r.synergyViolations![0].sourceCount = {} as never; }],
  ] as const)("rejects malformed rendered %s without publishing state", async (_name, mutate) => {
    await rejectsWithoutApply(mutate);
  });

  it.each([
    ["score rows", (r: GenerateResult) => { r.scoreBreakdown.cardScores = new Array(1); }],
    ["warnings", (r: GenerateResult) => { r.warnings = new Array(1); }],
    ["reasoning", (r: GenerateResult) => { r.diagnostics.reasoning = new Array(1); }],
    ["validation rows", (r: GenerateResult) => { r.validation!.violations = new Array(1); }],
    ["combo rows", (r: GenerateResult) => { r.verifiedCombos = new Array(1); }],
    ["graph edges", (r: GenerateResult) => { r.deckSynergyGraph!.edges = new Array(1); }],
    ["chains", (r: GenerateResult) => { r.comboChains = new Array(1); }],
    ["scenarios", (r: GenerateResult) => { r.scenarioCoverage!.scenarios = new Array(1); }],
    ["confidence interval", (r: GenerateResult) => { r.mythicViability!.competitive.confidenceInterval = new Array(2) as [number, number]; }],
    ["synergy violations", (r: GenerateResult) => { r.synergyViolations = new Array(1); }],
  ] as const)("rejects sparse nested %s without publishing state", async (_name, mutate) => {
    await rejectsWithoutApply(mutate);
  });

  it("accepts unmatched competitive reports without optional market data", async () => {
    const result = completeResult();
    result.mythicViability!.competitive = { matched: false, reason: "no-market-data" };
    await expect(acceptAndApply(result)).resolves.toBe(result);
  });

  it("accepts legacy combos without quantity or prerequisite enrichment", async () => {
    const result = completeResult();
    delete result.verifiedCombos![0].requiredQuantities;
    delete result.verifiedCombos![0].prerequisites;
    await expect(acceptAndApply(result)).resolves.toBe(result);
  });

  it("accepts omitted legacy score terms without masking present terms", async () => {
    const result = completeResult();
    delete result.scoreBreakdown.cardScores[0].preferCardBonus;
    delete result.scoreBreakdown.cardScores[0].broadTagBonus;
    delete result.scoreBreakdown.cardScores[0].seedAdjustment;
    await expect(acceptAndApply(result)).resolves.toBe(result);
  });

  it.each(["curveDeviation", "manaBaseCoverage", "optimizerSteps"] as const)("rejects missing diagnostic %s before the UI can render it", async (key) => {
    const result = generated();
    delete (result.diagnostics as unknown as Record<string, unknown>)[key];
    const promise = generateDecksInWorker(options, [], new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow(/malformed/i);
    MockGeneratorWorker.instances[0].respond({ variants: [result], bestIndex: 0 });
    await rejection;
  });

  it("rejects nonnumeric score totals before the UI can render them", async () => {
    const result = generated();
    (result.scoreBreakdown.totals as unknown as Record<string, unknown>).manaPenalty = "bad";
    const promise = generateDecksInWorker(options, [], new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow(/malformed/i);
    MockGeneratorWorker.instances[0].respond({ variants: [result], bestIndex: 0 });
    await rejection;
  });

  it("reports unsupported Worker environments without invoking the generator", async () => {
    vi.stubGlobal("Worker", undefined);
    await expect(generateDecksInWorker(options, [], new AbortController().signal)).rejects.toThrow("requires Web Worker support");
  });

  it("terminates when request serialization fails", async () => {
    vi.spyOn(MockGeneratorWorker.prototype, "postMessage").mockImplementationOnce(() => { throw new Error("cannot clone"); });
    await expect(generateDecksInWorker(options, [], new AbortController().signal)).rejects.toThrow("cannot clone");
    expect(MockGeneratorWorker.instances[0].terminated).toBe(true);
    vi.restoreAllMocks();
  });

  it("terminates and rejects an aborted request, ignoring late replies", async () => {
    const controller = new AbortController();
    const promise = generateDecksInWorker(options, [card()], controller.signal);
    const rejection = expect(promise).rejects.toMatchObject({ name: "AbortError" });
    const worker = MockGeneratorWorker.instances[0];
    controller.abort();
    await rejection;
    expect(worker.terminated).toBe(true);
    expect(worker.onmessage).toBeNull();
    worker.respond();
  });

  it("does not create a Worker for an already-aborted signal", async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(generateDecksInWorker(options, [], controller.signal)).rejects.toMatchObject({ name: "AbortError" });
    expect(MockGeneratorWorker.instances).toHaveLength(0);
  });

  it.each(["onerror", "onmessageerror"] as const)("terminates on %s", async (handler) => {
    const promise = generateDecksInWorker(options, [], new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow(/worker/i);
    const worker = MockGeneratorWorker.instances[0];
    const callback = worker[handler] as ((event: unknown) => void) | null;
    expect(callback).toBeTypeOf("function");
    callback?.({ message: "worker failed", preventDefault() {} });
    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it.each([
    null, {}, { variants: [], bestIndex: 0 }, { variants: [{}], bestIndex: 0 },
  ])("rejects malformed result payload %j", async (payload) => {
    const promise = generateDecksInWorker(options, [], new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow(/malformed/i);
    const worker = MockGeneratorWorker.instances[0];
    worker.respond(payload);
    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("rejects a stale request id rather than accepting another request's result", async () => {
    const promise = generateDecksInWorker(options, [], new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow(/stale/i);
    const worker = MockGeneratorWorker.instances[0];
    worker.onmessage?.({ data: { type: "result", requestId: "older", payload: { variants: [], bestIndex: 0 } } } as MessageEvent);
    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("terminates on a reported worker failure", async () => {
    const promise = generateDecksInWorker(options, [], new AbortController().signal);
    const rejection = expect(promise).rejects.toThrow("generation rejected");
    const worker = MockGeneratorWorker.instances[0];
    worker.onmessage?.({ data: { type: "error", requestId: worker.request?.requestId, message: "generation rejected" } } as MessageEvent);
    await rejection;
    expect(worker.terminated).toBe(true);
  });

  it("dispatches options/cards to a module Worker and terminates on success", async () => {
    const promise = generateDecksInWorker(options, [card()], new AbortController().signal);
    const worker = MockGeneratorWorker.instances[0];
    expect(worker).toBeDefined();
    expect(worker.url.pathname).toContain("/workers/generatorWorker.ts");
    expect(worker.config).toMatchObject({ type: "module" });
    expect(worker.request).toMatchObject({ type: "generate", options, allCards: [card()] });
    worker.respond();
    await expect(promise).resolves.toMatchObject({ bestIndex: 0, variants: [{ totalCards: 60 }] });
    expect(worker.terminated).toBe(true);
  });
});
