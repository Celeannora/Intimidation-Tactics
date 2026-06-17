/**
 * UpdateDatabaseButton.tsx — Manual "Update card database from Scryfall" control.
 *
 * Designed to live in the DatabaseStatusBar. Shows:
 *   • An "Update" button (disabled while busy or within cooldown).
 *   • An inline progress bar during download / import.
 *   • Success / error banners after completion.
 *   • The Scryfall dataset's own updated_at timestamp so users know
 *     whether a refresh is actually needed.
 */

import { useEffect, useRef, useState } from "react";
import { ScryfallUpdateController, canRefreshNow } from "../lib/scryfallUpdate";
import { useDBUpdateStore } from "../store/dbUpdateStore";
import { db } from "../lib/db";

const COOLDOWN_LABEL_MS = 30 * 60 * 1000;

export function UpdateDatabaseButton() {
  const {
    phase,
    progress,
    result,
    error,
    scryfallUpdatedAt,
    setPhase,
    setProgress,
    setResult,
    setError,
    setScryfallMeta,
    reset,
  } = useDBUpdateStore();

  const [localLastUpdated, setLocalLastUpdated] = useState<string | null>(null);
  const [expanded, setExpanded] = useState(false);
  const controllerRef = useRef<ScryfallUpdateController | null>(null);

  // Read last-updated from DB on mount
  useEffect(() => {
    db.meta.get("lastImportedAt").then((row) => {
      if (row?.value) setLocalLastUpdated(row.value);
    });
  }, []);

  // Sync localLastUpdated after a successful update
  useEffect(() => {
    if (phase === "done" && result) {
      setLocalLastUpdated(new Date().toISOString());
    }
  }, [phase, result]);

  const isBusy = phase === "downloading" || phase === "importing" || phase === "checking-manifest";
  const cooldownActive = !canRefreshNow(localLastUpdated);
  const canStart = !isBusy && !cooldownActive;

  const handleUpdate = async () => {
    if (!canStart) return;
    reset();
    setExpanded(true);
    setPhase("checking-manifest");

    const controller = new ScryfallUpdateController();
    controllerRef.current = controller;

    controller.onScryfallMeta = (entry) => setScryfallMeta(entry);
    controller.onProgress = (p) => setProgress(p);
    controller.onDone = (r) => {
      setResult(r);
      // Dispatch the same event BulkImporter uses so the rest of the app refreshes
      window.dispatchEvent(new CustomEvent("db-refreshed"));
    };
    controller.onError = (msg) => setError(msg);

    await controller.start();
    controllerRef.current = null;
  };

  const handleCancel = () => {
    controllerRef.current?.cancel();
    setPhase("cancelled");
    controllerRef.current = null;
  };

  const handleDismiss = () => {
    reset();
    setExpanded(false);
  };

  const progressPercent = progress?.percent ?? 0;
  const progressMsg = progress?.message ?? "";

  // ── Cooldown remaining ────────────────────────────────────────────────────
  const cooldownDisplay = (() => {
    if (!localLastUpdated || !cooldownActive) return null;
    const minsLeft = Math.ceil((COOLDOWN_LABEL_MS - (Date.now() - new Date(localLastUpdated).getTime())) / 60_000);
    return `(cooldown ${minsLeft}m)`;
  })();

  return (
    <div className="flex items-center gap-2">
      {/* ── Main update button ── */}
      {phase !== "downloading" && phase !== "importing" && phase !== "checking-manifest" && (
        <button
          onClick={handleUpdate}
          disabled={!canStart}
          title={
            cooldownActive
              ? `Updated recently. ${cooldownDisplay ?? ""}`
              : "Download the latest oracle_cards dataset from Scryfall and replace the local database."
          }
          className={`flex items-center gap-1 rounded px-2 py-0.5 text-xs transition-colors ${
            canStart
              ? "text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800"
              : "text-zinc-600 cursor-not-allowed"
          }`}
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
            <path d="M3 3v5h5" />
          </svg>
          Update DB
          {cooldownDisplay && <span className="text-zinc-600">{cooldownDisplay}</span>}
        </button>
      )}

      {/* ── Cancel button while busy ── */}
      {isBusy && (
        <button
          onClick={handleCancel}
          className="flex items-center gap-1 rounded px-2 py-0.5 text-xs text-amber-400 hover:text-amber-200 hover:bg-zinc-800 transition-colors"
        >
          ✕ Cancel
        </button>
      )}

      {/* ── Scryfall dataset meta (when we know it) ── */}
      {scryfallUpdatedAt && !isBusy && phase === "idle" && (
        <span className="text-zinc-700 text-xs" title={`Scryfall oracle_cards last updated: ${new Date(scryfallUpdatedAt).toLocaleDateString()}`}>
          · Scryfall: {new Date(scryfallUpdatedAt).toLocaleDateString()}
        </span>
      )}

      {/* ── Inline progress bar ── */}
      {(isBusy || expanded) && (
        <div className="flex items-center gap-2 min-w-0">
          {isBusy && (
            <>
              <div className="w-24 h-1.5 overflow-hidden rounded-full bg-zinc-800 shrink-0">
                <div
                  className="h-full bg-teal-500 transition-all duration-300"
                  style={{ width: `${progressPercent}%` }}
                />
              </div>
              <span className="text-[11px] text-zinc-500 truncate max-w-[140px]">{progressMsg}</span>
            </>
          )}

          {/* Done */}
          {phase === "done" && result && (
            <>
              <span className="text-[11px] text-emerald-400">
                ✓ Updated ({result.imported.toLocaleString()} cards)
              </span>
              <button
                onClick={handleDismiss}
                className="text-zinc-600 hover:text-zinc-400 text-xs leading-none"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </>
          )}

          {/* Error */}
          {phase === "error" && error && (
            <>
              <span className="text-[11px] text-red-400 truncate max-w-[180px]" title={error}>
                ✕ {error}
              </span>
              <button
                onClick={handleDismiss}
                className="text-zinc-600 hover:text-zinc-400 text-xs leading-none"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </>
          )}

          {/* Cancelled */}
          {phase === "cancelled" && (
            <>
              <span className="text-[11px] text-zinc-500">Cancelled.</span>
              <button
                onClick={handleDismiss}
                className="text-zinc-600 hover:text-zinc-400 text-xs leading-none"
                aria-label="Dismiss"
              >
                ✕
              </button>
            </>
          )}
        </div>
      )}
    </div>
  );
}
