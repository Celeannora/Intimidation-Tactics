import type { CardRecord } from "../types";

/**
 * Best-effort case-insensitive name resolver. Tries exact, then prefix match,
 * then fuzzy substring. Returns null if nothing plausible found.
 */
export function resolveCardName(name: string, allCards: CardRecord[]): CardRecord | null {
  const norm = name.trim().toLowerCase();
  if (!norm) return null;

  // Exact (case-insensitive)
  const exact = allCards.find((c) => c.name.toLowerCase() === norm);
  if (exact) return exact;

  // DFC: try matching the front face of "Front // Back"
  const front = norm.split(/\s*\/\/\s*/)[0];
  if (front && front !== norm) {
    const f = allCards.find((c) => c.name.toLowerCase().startsWith(front));
    if (f) return f;
  }

  // Prefix
  const pref = allCards.find((c) => c.name.toLowerCase().startsWith(norm));
  if (pref) return pref;

  // Substring (last resort)
  const sub = allCards.find((c) => c.name.toLowerCase().includes(norm));
  return sub ?? null;
}

export interface ResolvedDeckLine {
  card: CardRecord;
  quantity: number;
  board: "main" | "side";
}

export interface UnresolvedDeckLine {
  name: string;
  quantity: number;
  board: "main" | "side";
}

export interface ResolutionReport {
  resolved: ResolvedDeckLine[];
  unresolved: UnresolvedDeckLine[];
}

/** Resolve all `{name, qty}` lines from an AI response against the local card DB. */
export function resolveLines(
  lines: { name: string; quantity: number; board: "main" | "side" }[],
  allCards: CardRecord[]
): ResolutionReport {
  const resolved: ResolvedDeckLine[] = [];
  const unresolved: UnresolvedDeckLine[] = [];
  for (const ln of lines) {
    const card = resolveCardName(ln.name, allCards);
    if (card) resolved.push({ card, quantity: ln.quantity, board: ln.board });
    else unresolved.push({ name: ln.name, quantity: ln.quantity, board: ln.board });
  }
  return { resolved, unresolved };
}