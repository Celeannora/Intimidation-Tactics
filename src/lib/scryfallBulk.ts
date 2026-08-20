/**
 * scryfallBulk.ts — shared Scryfall bulk-data manifest + download logic.
 *
 * As of 2026, Scryfall's `/bulk-data` manifest no longer includes a
 * `download_uri` field for the `oracle_cards` entry (a single large plain
 * JSON array). It now serves only `jsonl_download_uri`: a gzip-compressed
 * JSON-Lines file (one card object per line, no enclosing array). This
 * module downloads and decompresses that format, while still tolerating a
 * legacy `download_uri`-only response defensively (in case Scryfall ever
 * serves that shape again for this or another bulk-data type).
 *
 * Previously this fetch/download logic was duplicated independently in
 * BulkImporter.tsx and scryfallUpdate.ts (both assumed the old
 * `download_uri` field unconditionally, which is what broke when Scryfall
 * dropped it). Both now delegate here instead.
 */
import type { ImportProgress } from "./types";

export const SCRYFALL_BULK_MANIFEST = "https://api.scryfall.com/bulk-data";

export interface ScryfallBulkEntry {
  type: string;
  /** Legacy plain-JSON download URL. No longer present for oracle_cards as of 2026. */
  download_uri?: string;
  /** Current gzip-compressed JSON-Lines download URL. */
  jsonl_download_uri?: string;
  /** Uncompressed size in bytes, when available (legacy field). */
  size?: number;
  /** Compressed (gzip) size in bytes, when available. */
  compressed_size?: number;
  updated_at?: string;
  name?: string;
}

export interface ScryfallBulkManifest {
  data: ScryfallBulkEntry[];
}

/** Fetch the bulk-data manifest and return the oracle_cards entry. */
export async function fetchOracleCardsManifestEntry(
  signal?: AbortSignal
): Promise<ScryfallBulkEntry> {
  const res = await fetch(SCRYFALL_BULK_MANIFEST, { signal });
  if (!res.ok) throw new Error(`Scryfall manifest fetch failed: ${res.status}`);
  const manifest = (await res.json()) as ScryfallBulkManifest;
  const entry = manifest.data.find((d) => d.type === "oracle_cards");
  if (!entry) throw new Error("No oracle_cards entry found in Scryfall bulk manifest.");
  return entry;
}

export type BulkDownloadFormat = "jsonl-gzip" | "json";

/** Pick which URL/format to fetch, preferring the modern gzip+JSONL offering. */
export function resolveBulkDownloadTarget(
  entry: ScryfallBulkEntry
): { url: string; format: BulkDownloadFormat } {
  if (entry.jsonl_download_uri) return { url: entry.jsonl_download_uri, format: "jsonl-gzip" };
  if (entry.download_uri) return { url: entry.download_uri, format: "json" };
  throw new Error("Scryfall oracle_cards entry has neither jsonl_download_uri nor download_uri.");
}

/**
 * Download the oracle_cards bulk file and return it as a File ready to hand
 * to importWorker. For the gzip+JSONL format, the compressed bytes are
 * streamed with progress, then decompressed via DecompressionStream. The
 * resulting File is named with a `.jsonl` extension so importWorker (via
 * `isJsonlFile`) knows to parse it as newline-delimited JSON rather than a
 * single JSON array.
 */
export async function downloadScryfallBulkFile(
  entry: ScryfallBulkEntry,
  onProgress: (p: ImportProgress) => void,
  signal?: AbortSignal
): Promise<File> {
  const { url, format } = resolveBulkDownloadTarget(entry);

  onProgress({
    phase: "reading",
    percent: 2,
    processed: 0,
    total: entry.compressed_size ?? entry.size ?? 0,
    message:
      format === "jsonl-gzip"
        ? "Downloading compressed bulk file from Scryfall…"
        : "Downloading oracle_cards.json from Scryfall…",
  });

  const res = await fetch(url, { signal });
  if (!res.ok || !res.body) throw new Error(`Scryfall download failed: ${res.status}`);

  const contentLength = Number(
    res.headers.get("Content-Length") ?? (format === "jsonl-gzip" ? entry.compressed_size : entry.size) ?? 0
  );
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;

  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.byteLength;
      const percent = contentLength ? Math.min(18, 2 + Math.round((received / contentLength) * 16)) : 10;
      onProgress({
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

  const rawBlob = new Blob(chunks as BlobPart[]);

  if (format === "json") {
    return new File([rawBlob], "oracle-cards.json", { type: "application/json" });
  }

  onProgress({
    phase: "reading",
    percent: 19,
    processed: received,
    total: contentLength,
    message: "Decompressing bulk file…",
  });

  if (typeof DecompressionStream === "undefined") {
    throw new Error(
      "This browser doesn't support gzip decompression (DecompressionStream is unavailable). Please use a recent Chrome, Edge, Firefox, or Safari."
    );
  }
  const decompressedStream = rawBlob.stream().pipeThrough(new DecompressionStream("gzip"));
  const decompressedBlob = await new Response(decompressedStream).blob();
  return new File([decompressedBlob], "oracle-cards.jsonl", { type: "application/x-ndjson" });
}
