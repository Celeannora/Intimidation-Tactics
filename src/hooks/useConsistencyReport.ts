/**
 * useConsistencyReport
 *
 * Derives a ConsistencyReport from the live deck store.
 * Defers the synchronous Monte Carlo work via setTimeout so the
 * "Computing…" spinner renders before the main thread is blocked.
 * The report is memoised via deckKey and only recomputes when the
 * deck composition actually changes.
 */
import { useState, useEffect, useRef, useMemo } from "react";
import { buildConsistencyReport } from "../lib/consistencyReport";
import type { ConsistencyReport, ConsistencyEntry } from "../lib/consistencyReport";
import { useMainboardEntries } from "../store/deckStore";

export type ReportState =
  | { status: "idle" }
  | { status: "computing" }
  | { status: "ready"; report: ConsistencyReport }
  | { status: "error"; message: string };

const TRIALS = 10_000;

/**
 * Convert store entries into DeckEntry[] for the consistency lib.
 * All fields map directly from CardRecord — no parsing needed here
 * because producedManaJson is already a JSON string.
 */
function toDeckEntries(
  entries: ReturnType<typeof useMainboardEntries>
): ConsistencyEntry[] {
  return entries.map(e => ({
    name:             e.card.name,
    quantity:         e.quantity,
    cmc:              e.card.cmc,
    manaCost:         e.card.manaCost,
    typeLine:         e.card.typeLine,
    producedManaJson: e.card.producedManaJson || undefined,
  }));
}

export function useConsistencyReport(): ReportState {
  const mainEntries = useMainboardEntries();
  const [state, setState] = useState<ReportState>({ status: "idle" });
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Stable key — only re-run when deck composition changes
  const deckKey = useMemo(
    () =>
      mainEntries
        .map(e => `${e.card.oracleId}:${e.quantity}`)
        .sort()
        .join("|"),
    [mainEntries]
  );

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);

    if (mainEntries.length === 0) {
      setState({ status: "idle" });
      return;
    }

    setState({ status: "computing" });

    // Defer so the spinner can paint before synchronous work blocks the thread
    timerRef.current = setTimeout(() => {
      try {
        const entries = toDeckEntries(mainEntries);
        const report = buildConsistencyReport(entries, TRIALS, /* onDraw */ true);
        setState({ status: "ready", report });
      } catch (err) {
        setState({
          status: "error",
          message: err instanceof Error ? err.message : String(err),
        });
      }
    }, 0);

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
     
  }, [deckKey]);

  return state;
}
