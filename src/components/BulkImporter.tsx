import type React from "react";
import { useMemo, useRef, useState } from "react";
import type { ImportProgress, ImportResult } from "../lib/types";

interface BulkImporterProps {
  onImportDone?: (result: ImportResult) => void;
}

interface ScryfallBulkEntry {
  type: string;
  download_uri: string;
  size?: number;
  updated_at?: string;
}

interface ScryfallBulkManifest {
  data: ScryfallBulkEntry[];
}

const SCRYFALL_BULK_MANIFEST = "https://api.scryfall.com/bulk-data";

export function BulkImporter({ onImportDone }: BulkImporterProps = {}) {
  const inputRef = useRef<HTMLInputElement | null>(null);
  const [progress, setProgress] = useState<ImportProgress | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const worker = useMemo(
    () => new Worker(new URL("../workers/importWorker.ts", import.meta.url), { type: "module" }),
    []
  );

  const attachWorkerHandlers = () => {
    worker.onmessage = (msg: MessageEvent) => {
      const { type, payload } = msg.data;
      if (type === "progress") setProgress(payload as ImportProgress);
      if (type === "done") {
        const r = payload as ImportResult;
        setResult(r);
        onImportDone?.(r);
      }
      if (type === "error") setError(String(payload));
    };
  };

  const onPickFile = () => inputRef.current?.click();

  const onFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;

    setError(null);
    setResult(null);
    attachWorkerHandlers();
    worker.postMessage(file);
  };

  const onDownloadFromScryfall = async () => {
    setError(null);
    setResult(null);
    setDownloading(true);
    try {
      setProgress({
        phase: "reading",
        percent: 1,
        processed: 0,
        total: 0,
        message: "Fetching Scryfall bulk-data manifest..."
      });

      const manifestRes = await fetch(SCRYFALL_BULK_MANIFEST);
      if (!manifestRes.ok) {
        throw new Error(`Scryfall manifest fetch failed: ${manifestRes.status}`);
      }
      const manifest = (await manifestRes.json()) as ScryfallBulkManifest;
      const entry = manifest.data.find((d) => d.type === "oracle_cards");
      if (!entry) throw new Error("No oracle_cards entry in Scryfall bulk manifest");

      setProgress({
        phase: "reading",
        percent: 2,
        processed: 0,
        total: entry.size ?? 0,
        message: "Downloading oracle_cards.json from Scryfall..."
      });

      const res = await fetch(entry.download_uri);
      if (!res.ok || !res.body) {
        throw new Error(`Scryfall download failed: ${res.status}`);
      }

      const contentLength = Number(res.headers.get("Content-Length") ?? entry.size ?? 0);
      const reader = res.body.getReader();
      const chunks: Uint8Array[] = [];
      let received = 0;

      while (true) {
        const { done, value } = await reader.read();
        if (done) break;
        if (value) {
          chunks.push(value);
          received += value.byteLength;
          const percent = contentLength
            ? Math.min(18, 2 + Math.round((received / contentLength) * 16))
            : 10;
          setProgress({
            phase: "reading",
            percent,
            processed: received,
            total: contentLength,
            message: contentLength
              ? `Downloading ${(received / 1_000_000).toFixed(1)} / ${(contentLength / 1_000_000).toFixed(1)} MB`
              : `Downloading ${(received / 1_000_000).toFixed(1)} MB`
          });
        }
      }

      const blob = new Blob(chunks as BlobPart[], { type: "application/json" });
      const file = new File([blob], "oracle_cards.json", { type: "application/json" });

      attachWorkerHandlers();
      worker.postMessage(file);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setProgress(null);
    } finally {
      setDownloading(false);
    }
  };

  return (
    <section className="rounded-xl border border-zinc-800 bg-zinc-950 p-6 text-zinc-100">
      <div className="mb-4">
        <h2 className="text-xl font-semibold">Phase 1: Load Scryfall Bulk File</h2>
        <p className="mt-2 text-sm text-zinc-400">
          Download <code>oracle_cards.json</code> directly from Scryfall, or pick a local copy.
        </p>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept=".json,application/json"
        className="hidden"
        onChange={onFileChange}
      />

      <div className="flex flex-wrap gap-3">
        <button
          onClick={onDownloadFromScryfall}
          disabled={downloading}
          className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {downloading ? "Downloading..." : "Download from Scryfall"}
        </button>
        <button
          onClick={onPickFile}
          disabled={downloading}
          className="rounded-lg border border-zinc-700 bg-zinc-900 px-4 py-2 text-sm font-medium hover:bg-zinc-800 disabled:cursor-not-allowed disabled:opacity-60"
        >
          Choose Local File
        </button>
      </div>

      <p className="mt-3 text-xs text-zinc-500">
        Scryfall's bulk file is ~150&nbsp;MB. The download runs in your browser and never leaves your machine.
      </p>

      {progress && (
        <div className="mt-6">
          <div className="mb-2 flex items-center justify-between text-sm text-zinc-300">
            <span>{progress.message}</span>
            <span>{progress.percent}%</span>
          </div>
          <div className="h-3 overflow-hidden rounded-full bg-zinc-800">
            <div
              className="h-full bg-teal-500 transition-all duration-300"
              style={{ width: `${progress.percent}%` }}
            />
          </div>
        </div>
      )}

      {result && (
        <div className="mt-6 rounded-lg border border-emerald-800 bg-emerald-950/40 p-4 text-sm">
          <div>Imported: {result.imported.toLocaleString()}</div>
          <div>Skipped: {result.skipped.toLocaleString()}</div>
          <div>Total seen: {result.totalSeen.toLocaleString()}</div>
          <div>Timestamp: {result.timestamp}</div>
        </div>
      )}

      {error && (
        <div className="mt-6 rounded-lg border border-red-800 bg-red-950/40 p-4 text-sm text-red-200">
          {error}
        </div>
      )}
    </section>
  );
}
