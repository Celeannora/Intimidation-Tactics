import type { CardRecord } from "../types";

/**
 * Normalize a card name for comparison: lowercase + map common Unicode
 * variants to their ASCII equivalents. LLMs frequently emit curly/smart
 * apostrophes, en-dashes, non-breaking spaces, etc. that differ from the
 * straight ASCII characters used in Scryfall card names. Applying this to
 * BOTH sides of every comparison makes matching robust against encoding drift.
 */
function normalizeCardName(name: string): string {
  return name
    .trim()
    // Curly/smart apostrophes and other apostrophe-like codepoints → straight '
    .replace(/[\u2018\u2019\u02BC\u02B9\u0060\u00B4]/g, "'")
    // Curly double quotes → straight "
    .replace(/[\u201C\u201D]/g, '"')
    // En-dash and em-dash → hyphen
    .replace(/[\u2013\u2014]/g, "-")
    // Non-breaking and other exotic spaces → regular space
    .replace(/[\u00A0\u202F\u2009\u2007]/g, " ")
    // Collapse multiple spaces
    .replace(/\s+/g, " ")
    .toLowerCase();
}

/**
 * Best-effort case-insensitive name resolver. Tries exact, then prefix match,
 * then fuzzy substring. Returns null if nothing plausible found.
 *
 * Both the query and the card DB name are run through normalizeCardName so
 * that Unicode apostrophe/quote/dash variants from LLM output match the
 * straight-ASCII characters used in Scryfall data.
 */
export function resolveCardName(name: string, allCards: CardRecord[]): CardRecord | null {
  const norm = normalizeCardName(name);
  if (!norm) return null;

  // Exact (case-insensitive, Unicode-normalized)
  const exact = allCards.find((c) => normalizeCardName(c.name) === norm);
  if (exact) return exact;

  // DFC: try matching the front face of "Front // Back"
  const front = norm.split(/\s*\/\/\s*/)[0];
  if (front && front !== norm) {
    const f = allCards.find((c) => normalizeCardName(c.name).startsWith(front));
    if (f) return f;
  }

  // Prefix
  const pref = allCards.find((c) => normalizeCardName(c.name).startsWith(norm));
  if (pref) return pref;

  // Substring (last resort)
  const sub = allCards.find((c) => normalizeCardName(c.name).includes(norm));
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