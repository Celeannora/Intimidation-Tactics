import type { GenerateOptions, GenerateResult } from "../../lib/generator/types";
import { deck } from "../../store/__tests__/generated.fixtures";

export const options: GenerateOptions = { engine: "offline", archetype: "Midrange", colors: [], format: "standard", mainboardSize: 60 };
export function generated(): GenerateResult {
  return {
    entries: deck(), archetype: "Midrange", totalCards: 60,
    diagnostics: { reasoning: [], deckScore: 10, cardScoreSum: 10, curveDeviation: 0,
      manaBaseCoverage: 1, optimizerSteps: 1, primaryAxes: [] },
    seededCards: [], focusedCards: [], cardReasons: {},
    scoreBreakdown: { cardScores: [], totals: { cardScoreSum: 10, curvePenalty: 0,
      manaPenalty: 0, profilePenalty: 0, redundancyContribution: 0, comboContribution: 0, finalScore: 10 } },
  };
}

export class MockGeneratorWorker {
  static instances: MockGeneratorWorker[] = [];
  onmessage: ((event: MessageEvent) => void) | null = null;
  onerror: ((event: ErrorEvent) => void) | null = null;
  onmessageerror: ((event: MessageEvent) => void) | null = null;
  request: { type: string; requestId: string; options: GenerateOptions; allCards: unknown[] } | null = null;
  terminated = false;
  constructor(readonly url: URL, readonly config: WorkerOptions) { MockGeneratorWorker.instances.push(this); }
  postMessage(request: MockGeneratorWorker["request"]) { this.request = request; }
  terminate() { this.terminated = true; }
  respond(payload: unknown = { variants: [generated()], bestIndex: 0 }) {
    this.onmessage?.({ data: { type: "result", requestId: this.request?.requestId, payload } } as MessageEvent);
  }
}
