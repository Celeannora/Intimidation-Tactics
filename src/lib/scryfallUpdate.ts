/**
 * scryfallUpdate.ts — Manual Scryfall bulk-data refresh service.
 *
 * Fetches the Scryfall /bulk-data manifest, finds the oracle_cards dataset,
 * streams it down, and hands the resulting File to the existing importWorker
 * exactly as BulkImporter does. All network activity happens on the main thread
 * but the heavy JSON-parsing+DB-write is offloaded to the worker, just like the
 * initial import flow.
 *
 * Usage:
 *   const ctl = new ScryfallUpdateController();
 *   ctl.onProgress = (p) => setState(p);
 *   ctl.onDone     = (r) => console.log(r);
 *   ctl.onError    = (e) => console.error(e);
 *   await ctl.start();
 *   // ctl.cancel() to abort mid-flight
 */

import type { ImportProgress, ImportResult } from "./types";

const SCRYFALL_BULK_MANIFEST = "https://api.scryfall.com/bulk-data";
const MIN_UPDATE_INTERVAL_MS = 30 * 60 * 1000; // 30 min cooldown between refreshes

export interface ScryfallBulkEntry {
  type: string;
  download_uri: string;
  size?: number;
  updated_at?: string;
  name?: string;
}

export interface ScryfallBulkManifest {
  data: ScryfallBulkEntry[];
}

export type UpdatePhase =
  | "idle"
  | "checking-manifest"
  | "downloading"
  | "importing"
  | "done"
  | "error"
  | "cancelled";

export interface UpdateStatus {
  phase: UpdatePhase;
  progress: ImportProgress | null;
  result: ImportResult | null;
  error: string | null;
  /** Scryfall's reported updated_at for the oracle_cards dataset */
  scryfallUpdatedAt: string | null;
  /** ISO timestamp of when we last successfully completed an update */
  localLastUpdated: string | null;
}

export const EMPTY_UPDATE_STATUS: UpdateStatus = {
  phase: "idle",
  progress: null,
  result: null,
  error: null,
  scryfallUpdatedAt: null,
  localLastUpdated: null,
};

/** Minimum time (ms) between two user-initiated refreshes. */
export function canRefreshNow(localLastUpdated: string | null): boolean {
  if (!localLastUpdated) return true;
  return Date.now() - new Date(localLastUpdated).getTime() >= MIN_UPDATE_INTERVAL_MS;
}

export class ScryfallUpdateController {
  onProgress: ((p: ImportProgress) => void) | null = null;
  onDone: ((r: ImportResult) => void) | null = null;
  onError: ((msg: string) => void) | null = null;
  onScryfallMeta: ((entry: ScryfallBulkEntry) => void) | null = null;

  private _abortController: AbortController | null = null;
  private _worker: Worker | null = null;
  private _cancelled = false;

  /** Fetch the manifest and return the oracle_cards entry metadata without downloading. */
  async fetchManifestMeta(): Promise<ScryfallBulkEntry | null> {
    try {
      const res = await fetch(SCRYFALL_BULK_MANIFEST);
      if (!res.ok) return null;
      const manifest = (await res.json()) as ScryfallBulkManifest;
      return manifest.data.find((d) => d.type === "oracle_cards") ?? null;
    } catch {
      return null;
    }
  }

  async start(): Promise<void> {
    this._cancelled = false;
    this._abortController = new AbortController();
    const signal = this._abortController.signal;

    try {
      // ── Step 1: manifest ──────────────────────────────────────────────────
      this._emit({ phase: "reading", percent: 1, processed: 0, total: 0, message: "Fetching Scryfall bulk-data manifest…" });

      const manifestRes = await fetch(SCRYFALL_BULK_MANIFEST, { signal });
      if (!manifestRes.ok) throw new Error(`Manifest fetch failed: ${manifestRes.status}`);
      const manifest = (await manifestRes.json()) as ScryfallBulkManifest;
      const entry = manifest.data.find((d) => d.type === "oracle_cards");
      if (!entry) throw new Error("No oracle_cards entry found in Scryfall bulk manifest.");

      this.onScryfallMeta?.(entry);

      if (this._cancelled) return;

      // ── Step 2: download ─────────────────────────────────────────────────
      this._emit({ phase: "reading", percent: 2, processed: 0, total: entry.size ?? 0, message: "Connecting to Scryfall…" });

      const res = await fetch(entry.download_uri, { signal });
      if (!res.ok || !res.body) throw new Error(`Download failed: ${res.status}`);

      const contentLength = Number(res.headers.get("Content-Length") ?? entry.size ?? 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        if (this._cancelled) {
          await reader.cancel();
          return;
        }
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          const percent = contentLength
            ? Math.min(18, 2 + Math.round((received / contentLength) * 16))
            : 10;
          this._emit({
            phase: "reading",
            percent,
            processed: received,
            total: contentLength,
            message: contentLength
              ? `Downloading ${(received / 1_000_000).toFixed(1)} / ${(contentLength / 1_000_000).toFixed(1)} MB`
              : `Downloading ${(received / 1_000_000).toFixed(1)} MB`,
          });
        }
      }

      if (this._cancelled) return;

      // ── Step 3: hand to importWorker ──────────────────────────────────────
      const blob = new Blob(chunks as BlobPart[], { type: "application/json" });
      const file = new File([blob], "oracle_cards.json", { type: "application/json" });

      await this._runWorker(file);
    } catch (e) {
      if (this._cancelled) return;
      const msg = e instanceof Error ? e.message : String(e);
      this.onError?.(msg);
    }
  }

  cancel(): void {
    this._cancelled = true;
    this._abortController?.abort();
    this._worker?.terminate();
    this._worker = null;
  }

  private _runWorker(file: File): Promise<void> {
    return new Promise((resolve) => {
      const worker = new Worker(
        new URL("../workers/importWorker.ts", import.meta.url),
        { type: "module" }
      );
      this._worker = worker;

      worker.onmessage = (msg: MessageEvent) => {
        const { type, payload } = msg.data as { type: string; payload: unknown };
        if (type === "progress") {
          this._emit(payload as ImportProgress);
        }
        if (type === "done") {
          this.onDone?.(payload as ImportResult);
          worker.terminate();
          this._worker = null;
          resolve();
        }
        if (type === "error") {
          if (!this._cancelled) this.onError?.(String(payload));
          worker.terminate();
          this._worker = null;
          resolve();
        }
      };

      worker.onerror = (err) => {
        if (!this._cancelled) this.onError?.(err.message ?? "Worker error");
        worker.terminate();
        this._worker = null;
        resolve();
      };

      worker.postMessage(file);
    });
  }

  private _emit(p: ImportProgress): void {
    this.onProgress?.(p);
  }
}
