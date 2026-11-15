import type { GenerateMultiResult, GenerateOptions } from "./types";
import type { CardRecord } from "../types";
import type { GeneratorWorkerRequest } from "../../workers/generatorWorker";

let nextRequestId = 0;
const record = (value: unknown): value is Record<string, unknown> => value !== null && typeof value === "object" && !Array.isArray(value);
const strings = (value: unknown): value is string[] => Array.isArray(value) && Array.from(value).every(item => typeof item === "string");
const finiteFields = (value: Record<string, unknown>, keys: string[]) => keys.every(key => Number.isFinite(value[key]));
const optionalNumbers = (value: Record<string, unknown>, keys: string[]) => keys.every(key => value[key] === undefined || Number.isFinite(value[key]));

function isCardScore(value: unknown): boolean {
  if (!record(value) || typeof value.oracleId !== "string" || typeof value.name !== "string" ||
      (value.board !== "main" && value.board !== "side") || !Number.isSafeInteger(value.quantity) ||
      (value.quantity as number) <= 0 || !finiteFields(value, ["perCopyScore", "contribution", "rolePowerContribution", "directionalContribution"])) return false;
  // The view's legacy fallback permits omitted additive terms, never malformed present values.
  return optionalNumbers(value, ["roleMultiplier", "powerScore", "colorAffinity", "synergyScore", "synergyContribution",
    "directionalScore", "synergyMultiplier", "compositionBonus", "signalScore", "signalContribution", "preferCardBonus",
    "broadTagBonus", "seedAdjustment", "efficiencyContribution", "flexibilityContribution", "scenarioRobustnessContribution",
    "ladderContribution", "comboContribution", "focusBonus", "focusCardBonus", "tribalBonus", "cmcPenalty", "pricePenalty"]);
}

function isValidation(value: unknown): boolean {
  return record(value) && typeof value.legal === "boolean" && finiteFields(value, ["mainCount", "sideCount"]) &&
    Array.isArray(value.violations) && Array.from(value.violations).every(row => record(row) && typeof row.rule === "string" &&
      typeof row.message === "string" && (row.cardNames === undefined || strings(row.cardNames)));
}

function isVerifiedCombo(value: unknown): boolean {
  return record(value) && typeof value.id === "string" && strings(value.cardOracleIds) && strings(value.cardNames) &&
    typeof value.explanation === "string" && typeof value.source === "string" &&
    (value.prerequisites === undefined || typeof value.prerequisites === "string") &&
    (value.requiredQuantities === undefined || (record(value.requiredQuantities) &&
      Object.values(value.requiredQuantities).every(quantity => Number.isSafeInteger(quantity) && (quantity as number) > 0)));
}

// Validate the graph/analytics fields consumed by GeneratorPanel, reasoningView,
// MythicViabilityPanel and ScenarioCoveragePanel, not unused producer metadata.
function isGraph(value: unknown): boolean {
  return record(value) && Number.isFinite(value.weightedDensity) && Array.isArray(value.edges) && Array.from(value.edges).every(edge =>
    record(edge) && ["fromOracleId", "toOracleId", "fromName", "toName", "axis"].every(key => typeof edge[key] === "string") &&
    ["source-to-payoff", "mutual-engine", "shared-axis"].includes(edge.kind as string) && Number.isFinite(edge.weight));
}

function isChain(value: unknown): boolean {
  return record(value) && strings(value.oracleIds) && (value.kind === "linear" || value.kind === "loop") && typeof value.explanation === "string";
}

function isScenarioCoverage(value: unknown): boolean {
  return record(value) && finiteFields(value, ["coveredCount", "totalScenarios", "consistencyScore"]) &&
    Array.isArray(value.scenarios) && Array.from(value.scenarios).every(row => record(row) && typeof row.scenarioId === "string" &&
      typeof row.scenarioName === "string" && typeof row.covered === "boolean" && strings(row.sourceArchetypeNames) && strings(row.answeringCards));
}

function isMythicViability(value: unknown): boolean {
  if (!record(value) || !record(value.structural) || !record(value.competitive)) return false;
  const { structural, competitive } = value;
  const interval = competitive.confidenceInterval;
  return finiteFields(structural, ["score", "manaBase", "curve", "landRatio", "fourOfDensity", "synergyDensity"]) &&
    strings(structural.notes) && typeof competitive.matched === "boolean" &&
    optionalNumbers(competitive, ["winRate", "sampleSize", "matchConfidence", "lastUpdated"]) &&
    ["sourceArchetype", "source", "reason"].every(key => competitive[key] === undefined || typeof competitive[key] === "string") &&
    (interval === undefined || (Array.isArray(interval) && interval.length === 2 && Array.from(interval).every(Number.isFinite)));
}

function isSynergyViolation(value: unknown): boolean {
  return record(value) && typeof value.description === "string" && strings(value.payoffCards) &&
    finiteFields(value, ["sourceCount", "requiredSources"]) && (value.severity === "error" || value.severity === "warning");
}

function isResult(value: unknown): value is GenerateMultiResult {
  if (!record(value) || !Array.isArray(value.variants) || !value.variants.length ||
      !Number.isInteger(value.bestIndex) || (value.bestIndex as number) < 0 ||
      (value.bestIndex as number) >= value.variants.length) return false;
  return Array.from(value.variants).every((variant: unknown) => {
    if (!record(variant) || !Array.isArray(variant.entries) || typeof variant.archetype !== "string" ||
        !Number.isFinite(variant.totalCards) || !record(variant.diagnostics) ||
        !["deckScore", "cardScoreSum", "curveDeviation", "manaBaseCoverage", "optimizerSteps"]
          .every((key) => Number.isFinite(variant.diagnostics && (variant.diagnostics as Record<string, unknown>)[key])) ||
        !strings(variant.diagnostics.primaryAxes) ||
        !strings(variant.diagnostics.reasoning) || !Array.isArray(variant.seededCards) ||
        !Array.isArray(variant.focusedCards) || !record(variant.cardReasons) || !Object.values(variant.cardReasons).every(strings) ||
        !record(variant.scoreBreakdown) || !record(variant.scoreBreakdown.totals) ||
        !Array.isArray(variant.scoreBreakdown.cardScores) || !Array.from(variant.scoreBreakdown.cardScores).every(isCardScore)) return false;
    if (variant.warnings !== undefined && !strings(variant.warnings)) return false;
    if (!["aiSummary", "aiGamePlan"].every(key => variant[key] === undefined || typeof variant[key] === "string")) return false;
    if (variant.validation !== undefined && !isValidation(variant.validation)) return false;
    if (variant.verifiedCombos !== undefined && (!Array.isArray(variant.verifiedCombos) || !Array.from(variant.verifiedCombos).every(isVerifiedCombo))) return false;
    if (variant.deckSynergyGraph !== undefined && !isGraph(variant.deckSynergyGraph)) return false;
    if (variant.comboChains !== undefined && (!Array.isArray(variant.comboChains) || !Array.from(variant.comboChains).every(isChain))) return false;
    if (variant.scenarioCoverage !== undefined && !isScenarioCoverage(variant.scenarioCoverage)) return false;
    if (variant.mythicViability !== undefined && !isMythicViability(variant.mythicViability)) return false;
    if (!optionalNumbers(variant, ["tempoScore", "cardAdvantageScore"])) return false;
    if (variant.synergyViolations !== undefined && (!Array.isArray(variant.synergyViolations) || !Array.from(variant.synergyViolations).every(isSynergyViolation))) return false;
    const totals = variant.scoreBreakdown.totals;
    if (!["cardScoreSum", "curvePenalty", "manaPenalty", "profilePenalty", "redundancyContribution", "comboContribution", "finalScore"]
      .every((key) => Number.isFinite(totals[key]))) return false;
    if (!["metaPerformanceContribution", "scenarioConsistencyContribution"]
      .every((key) => totals[key] === undefined || Number.isFinite(totals[key]))) return false;
    return Array.from(variant.entries).every((entry: unknown) => record(entry) && record(entry.card) &&
      typeof entry.card.oracleId === "string" && typeof entry.card.name === "string" &&
      typeof entry.card.typeLine === "string" && Number.isSafeInteger(entry.quantity) &&
      (entry.quantity as number) > 0 && (entry.board === "main" || entry.board === "side"));
  });
}

/**
 * One isolated module Worker per request; CPU-heavy generation stays off the UI thread.
 * Worker-less browsers are explicitly unsupported: no hidden synchronous UI fallback.
 */
export function generateDecksInWorker(
  options: GenerateOptions,
  allCards: CardRecord[],
  signal: AbortSignal,
): Promise<GenerateMultiResult> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) { reject(new DOMException("Generation cancelled.", "AbortError")); return; }
    if (typeof Worker === "undefined") { reject(new Error("Offline generation requires Web Worker support.")); return; }
    const worker = new Worker(new URL("../../workers/generatorWorker.ts", import.meta.url), { type: "module" });
    const requestId = `generation-${++nextRequestId}`;
    let settled = false;
    const finish = (error?: Error, result?: GenerateMultiResult) => {
      if (settled) return;
      settled = true;
      signal.removeEventListener("abort", abort);
      worker.onmessage = null;
      worker.onerror = null;
      worker.onmessageerror = null;
      worker.terminate();
      if (error) reject(error);
      else resolve(result!);
    };
    const abort = () => finish(new DOMException("Generation cancelled.", "AbortError"));
    signal.addEventListener("abort", abort, { once: true });
    worker.onmessage = (event: MessageEvent<unknown>) => {
      const message = event.data;
      if (!record(message)) { finish(new Error("Malformed generator worker response.")); return; }
      if (message.requestId !== requestId) { finish(new Error("Stale generator worker response.")); return; }
      if (message.type === "error" && typeof message.message === "string") {
        finish(new Error(message.message));
      } else if (message.type === "result" && isResult(message.payload)) {
        finish(undefined, message.payload);
      } else finish(new Error("Malformed generator worker response."));
    };
    worker.onerror = (event) => {
      event.preventDefault();
      finish(new Error(event.message || "Generator worker failed."));
    };
    worker.onmessageerror = () => finish(new Error("Generator worker message could not be decoded."));
    try {
      worker.postMessage({ type: "generate", requestId, options, allCards } satisfies GeneratorWorkerRequest);
    } catch (error) {
      finish(error instanceof Error ? error : new Error(String(error)));
    }
  });
}
