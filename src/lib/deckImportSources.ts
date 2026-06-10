import { parseDecklistText, resolveDeckEntries } from "./deckParser";
import type { DeckImportResult } from "./deckParser";

// MTGGoldfish deck URL: https://www.mtggoldfish.com/deck/XXXXXXXX
export async function importFromMTGGoldfish(url: string): Promise<DeckImportResult> {
  // Direct fetch is blocked by CORS. In production, route through a proxy.
  // Stub: attempt fetch and fall back gracefully.
  try {
    const res = await fetch(`https://www.mtggoldfish.com/deck/download/${extractGoldfishId(url)}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const text = await res.text();
    const parsed = parseDecklistText(text);
    return resolveDeckEntries([...parsed.mainboard, ...parsed.sideboard]);
  } catch (e) {
    throw new Error(`MTGGoldfish import failed (CORS likely): ${(e as Error).message}. Paste the decklist manually instead.`);
  }
}

function extractGoldfishId(url: string): string {
  const m = url.match(/deck\/(\d+)/);
  return m?.[1] ?? "";
}

// Moxfield deck URL: https://www.moxfield.com/decks/XXXXX
export async function importFromMoxfield(url: string): Promise<DeckImportResult> {
  try {
    const deckId = extractMoxfieldId(url);
    // Moxfield has a public API but requires auth for some endpoints.
    const res = await fetch(`https://api2.moxfield.com/v3/decks/all/${deckId}`);
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    const data = await res.json() as { mainboard?: Record<string, { quantity: number; card: { name: string } }>, sideboard?: Record<string, { quantity: number; card: { name: string } }> };

    const lines: string[] = [];
    for (const [, entry] of Object.entries(data.mainboard ?? {})) lines.push(`${entry.quantity} ${entry.card.name}`);
    const sideLines: string[] = [];
    for (const [, entry] of Object.entries(data.sideboard ?? {})) sideLines.push(`${entry.quantity} ${entry.card.name}`);

    const raw = [...lines, "", "Sideboard", ...sideLines].join("\n");
    const parsed = parseDecklistText(raw);
    return resolveDeckEntries([...parsed.mainboard, ...parsed.sideboard]);
  } catch (e) {
    throw new Error(`Moxfield import failed: ${(e as Error).message}. Paste the decklist manually instead.`);
  }
}

function extractMoxfieldId(url: string): string {
  const m = url.match(/decks\/([A-Za-z0-9_-]+)/);
  return m?.[1] ?? "";
}
