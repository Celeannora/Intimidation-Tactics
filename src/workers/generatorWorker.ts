/// <reference lib="webworker" />

/**
 * generatorWorker.ts
 *
 * Web Worker wrapper around the offline deck generator.
 * Moves CPU-heavy annealing + scoring off the main thread so the UI
 * stays responsive during generation (addresses roadmap Risk R-07).
 *
 * Protocol
 * --------
 * Incoming:  { type: "generate"; options: GenerateOptions; allCards: CardRecord[] }
 * Outgoing:  { type: "result";  payload: GenerateMultiResult }
 *          | { type: "error";   message: string }
 *
 * The caller (GeneratorPanel / useGenerator hook) is responsible for:
 *   1. Loading cards from Dexie on the main thread.
 *   2. Posting them here along with GenerateOptions.
 *   3. Receiving the typed result and committing it to the Zustand store.
 *
 * NOTE: generateDecks() is pure — no DB access — so it is safe to run in a
 * Worker. All Dexie/IndexedDB calls happen before the postMessage.
 */

import { generateDecks } from "../lib/generator/generator";
import type { GenerateOptions, GenerateMultiResult } from "../lib/generator/types";
import type { CardRecord } from "../lib/types";

// ---------------------------------------------------------------------------
// Typed message shapes
// ---------------------------------------------------------------------------

export interface GeneratorWorkerRequest {
  type: "generate";
  options: GenerateOptions;
  allCards: CardRecord[];
}

export interface GeneratorWorkerResultMessage {
  type: "result";
  payload: GenerateMultiResult;
}

export interface GeneratorWorkerErrorMessage {
  type: "error";
  message: string;
}

export type GeneratorWorkerResponse =
  | GeneratorWorkerResultMessage
  | GeneratorWorkerErrorMessage;

// ---------------------------------------------------------------------------
// Worker entry point
// ---------------------------------------------------------------------------

const ctx: DedicatedWorkerGlobalScope = self as never;

ctx.onmessage = async (event: MessageEvent<GeneratorWorkerRequest>) => {
  const { type, options, allCards } = event.data;

  if (type !== "generate") {
    ctx.postMessage({
      type: "error",
      message: `generatorWorker: unknown message type "${type}"`,
    } satisfies GeneratorWorkerErrorMessage);
    return;
  }

  try {
    const result: GenerateMultiResult = await generateDecks(options, allCards);
    ctx.postMessage({
      type: "result",
      payload: result,
    } satisfies GeneratorWorkerResultMessage);
  } catch (err) {
    const message =
      err instanceof Error ? err.message : "Unknown error in generatorWorker";
    ctx.postMessage({
      type: "error",
      message,
    } satisfies GeneratorWorkerErrorMessage);
  }
};
