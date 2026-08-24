/**
 * bulkParse.ts — parsing for Scryfall bulk-data files, shared by importWorker.
 *
 * Supports both the legacy single-JSON-array format (a whole file that
 * parses as one big `ScryfallCard[]`) and the current JSON-Lines format
 * Scryfall serves via `jsonl_download_uri` (one JSON object per line, no
 * enclosing array or separating commas). Kept as a pure, worker-independent
 * module so it's directly unit-testable.
 */
import type { ScryfallCard } from "./types";

/** Heuristic: does this file look like JSON-Lines rather than a single JSON array? */
export function isJsonlFile(file: { name: string; type?: string }): boolean {
  const name = file.name.toLowerCase();
  return name.endsWith(".jsonl") || name.endsWith(".ndjson") || (file.type ?? "").includes("ndjson");
}

/**
 * Parse bulk-data text content into an array of Scryfall card objects.
 * When `isJsonl` is true, each non-blank line is parsed independently as its
 * own JSON object; otherwise the whole text is parsed as one JSON array.
 */
export function parseScryfallBulkText(text: string, isJsonl: boolean): ScryfallCard[] {
  if (!isJsonl) {
    return JSON.parse(text) as ScryfallCard[];
  }
  const cards: ScryfallCard[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    cards.push(JSON.parse(trimmed) as ScryfallCard);
  }
  return cards;
}
