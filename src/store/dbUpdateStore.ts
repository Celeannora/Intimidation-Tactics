/**
 * dbUpdateStore.ts — Zustand slice for manual Scryfall database update state.
 *
 * Keeps track of download / import progress so any component in the tree can
 * subscribe to current update status without prop-drilling.
 */

import { create } from "zustand";
import type { ImportProgress, ImportResult } from "../lib/types";
import type { UpdatePhase, ScryfallBulkEntry } from "../lib/scryfallUpdate";

export type { UpdatePhase };

export interface DBUpdateState {
  phase: UpdatePhase;
  progress: ImportProgress | null;
  result: ImportResult | null;
  error: string | null;
  /** Scryfall's reported updated_at for the oracle_cards dataset */
  scryfallUpdatedAt: string | null;
  /** Scryfall's reported size for the oracle_cards dataset (bytes) */
  scryfallSize: number | null;

  // ── Actions ──────────────────────────────────────────────────────────────
  setPhase: (phase: UpdatePhase) => void;
  setProgress: (p: ImportProgress) => void;
  setResult: (r: ImportResult) => void;
  setError: (msg: string) => void;
  setScryfallMeta: (entry: ScryfallBulkEntry) => void;
  reset: () => void;
}

export const useDBUpdateStore = create<DBUpdateState>((set) => ({
  phase: "idle",
  progress: null,
  result: null,
  error: null,
  scryfallUpdatedAt: null,
  scryfallSize: null,

  setPhase: (phase) => set({ phase }),
  setProgress: (progress) => set({ progress, phase: progress.phase === "reading" ? "downloading" : "importing" }),
  setResult: (result) => set({ result, phase: "done", progress: null }),
  setError: (error) => set({ error, phase: "error", progress: null }),
  setScryfallMeta: (entry) =>
    set({ scryfallUpdatedAt: entry.updated_at ?? null, scryfallSize: entry.size ?? null }),
  reset: () =>
    set({ phase: "idle", progress: null, result: null, error: null }),
}));
