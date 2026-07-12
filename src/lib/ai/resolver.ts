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

export type MatchKind = "exact" | "prefix" | "substring" | "fuzzy";

export interface CardMatch {
  card: CardRecord;
  matchKind: MatchKind;
  /** Edit distance for fuzzy matches; 0 for exact/prefix/substring. */
  matchDistance: number;
}

// ── Fuzzy matching ──────────────────────────────────────────────────────────
// A single-character LLM typo (e.g. "Lighting Bolt" for "Lightning Bolt")
// previously dropped the card entirely. A bounded Damerau-Levenshtein fallback
// recovers these while a strict threshold + ambiguity guard prevents wrong
// matches (e.g. "Shock" vs "Stock").

/** Absolute maximum edit distance accepted for a fuzzy match. */
const FUZZY_MAX_DISTANCE = 2;
/** Maximum edit distance as a fraction of the query length. */
const FUZZY_MAX_RATIO = 0.2;
/** The best match must beat the second-best by at least this many edits. */
const FUZZY_AMBIGUITY_MARGIN = 1;

/**
 * Optimal String Alignment (restricted Damerau-Levenshtein) distance.
 * Counts insertions, deletions, substitutions, and adjacent transpositions.
 * Returns early with `max + 1` once the running minimum exceeds `max` to keep
 * the full-pool scan cheap.
 */
function damerauLevenshtein(a: string, b: string, max: number): number {
  const la = a.length;
  const lb = b.length;
  if (Math.abs(la - lb) > max) return max + 1;
  if (la === 0) return lb;
  if (lb === 0) return la;

  let prevPrev = new Array<number>(lb + 1).fill(0);
  let prev = new Array<number>(lb + 1);
  let curr = new Array<number>(lb + 1);
  for (let j = 0; j <= lb; j++) prev[j] = j;

  for (let i = 1; i <= la; i++) {
    curr[0] = i;
    let rowMin = curr[0];
    for (let j = 1; j <= lb; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      let val = Math.min(
        prev[j] + 1,       // deletion
        curr[j - 1] + 1,   // insertion
        prev[j - 1] + cost // substitution
      );
      if (i > 1 && j > 1 && a[i - 1] === b[j - 2] && a[i - 2] === b[j - 1]) {
        val = Math.min(val, prevPrev[j - 2] + 1); // transposition
      }
      curr[j] = val;
      if (val < rowMin) rowMin = val;
    }
    if (rowMin > max) return max + 1;
    // Rotate rows.
    const tmp = prevPrev;
    prevPrev = prev;
    prev = curr;
    curr = tmp;
  }
  return prev[lb];
}

/**
 * Fuzzy-resolve a normalized query against all card names. Returns the best
 * match only when it is within threshold AND unambiguously better than the
 * runner-up. Returns null otherwise (safer to drop than to guess wrong).
 */
function resolveCardNameFuzzy(
  norm: string,
  allCards: CardRecord[]
): { card: CardRecord; distance: number } | null {
  const maxAllowed = Math.min(FUZZY_MAX_DISTANCE, Math.floor(norm.length * FUZZY_MAX_RATIO));
  if (maxAllowed < 1) return null; // too short to fuzzy-match safely

  let best: { card: CardRecord; distance: number } | null = null;
  let secondBestDistance = Number.POSITIVE_INFINITY;

  for (const card of allCards) {
    const candidate = normalizeCardName(card.name);
    const d = damerauLevenshtein(norm, candidate, maxAllowed);
    if (d > maxAllowed) continue;
    if (!best || d < best.distance) {
      secondBestDistance = best ? best.distance : secondBestDistance;
      best = { card, distance: d };
      if (d === 0) break; // can't do better (shouldn't happen post-exact pass)
    } else if (d < secondBestDistance) {
      secondBestDistance = d;
    }
  }

  if (!best) return null;
  // Ambiguity guard: require a clear winner.
  if (secondBestDistance - best.distance < FUZZY_AMBIGUITY_MARGIN) return null;
  return best;
}

/** A prefix/substring winner must be at least this many characters more
 * specific than the runner-up, mirroring the fuzzy tier's ambiguity margin. */
const NAME_AMBIGUITY_MARGIN = 1;

/**
 * Pick a single unambiguous winner from a set of prefix/substring candidates,
 * or null when the choice is genuinely ambiguous.
 *
 * Previously the prefix and substring tiers used `Array.find`, silently binding
 * a shorthand like "Elspeth" to whichever printing happened to sit first in the
 * pool — a wrong-but-legal card indistinguishable from a correct resolution.
 * We now (1) collapse multiple printings of the SAME card (same oracleId — not
 * a real ambiguity) and (2) among distinct cards, require a clear winner by
 * specificity (fewest extra characters beyond the query). A tie at best
 * specificity is rejected so the caller can drop/flag it rather than guess.
 */
function pickUnambiguousByName(matches: CardRecord[], norm: string): CardRecord | null {
  if (matches.length === 0) return null;

  const byOracle = new Map<string, CardRecord>();
  for (const c of matches) if (!byOracle.has(c.oracleId)) byOracle.set(c.oracleId, c);
  const distinct = [...byOracle.values()];
  if (distinct.length === 1) return distinct[0];

  const ranked = distinct
    .map((c) => ({ c, extra: normalizeCardName(c.name).length - norm.length }))
    .sort((a, b) => a.extra - b.extra);
  if (ranked[1].extra - ranked[0].extra < NAME_AMBIGUITY_MARGIN) return null; // tie → ambiguous
  return ranked[0].c;
}

/**
 * Best-effort case-insensitive name resolver with match metadata. Tries exact,
 * then DFC front face, then prefix, then substring, then a bounded fuzzy
 * fallback. The prefix, substring, and fuzzy tiers are all ambiguity-guarded:
 * a shorthand that plausibly maps to two or more distinct cards is rejected
 * (returns null) rather than silently bound to an arbitrary one. Returns null
 * if nothing unambiguous is found.
 */
export function resolveCardMatch(name: string, allCards: CardRecord[]): CardMatch | null {
  const norm = normalizeCardName(name);
  if (!norm) return null;

  // Exact (case-insensitive, Unicode-normalized)
  const exact = allCards.find((c) => normalizeCardName(c.name) === norm);
  if (exact) return { card: exact, matchKind: "exact", matchDistance: 0 };

  // DFC: try matching the front face of "Front // Back"
  const front = norm.split(/\s*\/\/\s*/)[0];
  if (front && front !== norm) {
    const f = pickUnambiguousByName(
      allCards.filter((c) => normalizeCardName(c.name).startsWith(front)),
      front,
    );
    if (f) return { card: f, matchKind: "prefix", matchDistance: 0 };
  }

  // Prefix (ambiguity-guarded)
  const pref = pickUnambiguousByName(
    allCards.filter((c) => normalizeCardName(c.name).startsWith(norm)),
    norm,
  );
  if (pref) return { card: pref, matchKind: "prefix", matchDistance: 0 };

  // Substring (ambiguity-guarded)
  const sub = pickUnambiguousByName(
    allCards.filter((c) => normalizeCardName(c.name).includes(norm)),
    norm,
  );
  if (sub) return { card: sub, matchKind: "substring", matchDistance: 0 };

  // Fuzzy (bounded edit distance, ambiguity-guarded)
  const fuzzy = resolveCardNameFuzzy(norm, allCards);
  if (fuzzy) return { card: fuzzy.card, matchKind: "fuzzy", matchDistance: fuzzy.distance };

  return null;
}

/**
 * Backwards-compatible resolver returning just the card (or null).
 * Prefer `resolveCardMatch` when match metadata is useful.
 */
export function resolveCardName(name: string, allCards: CardRecord[]): CardRecord | null {
  return resolveCardMatch(name, allCards)?.card ?? null;
}

export interface ResolvedDeckLine {
  card: CardRecord;
  quantity: number;
  board: "main" | "side";
  /** How the card name was matched against the DB. */
  matchKind?: MatchKind;
  /** Edit distance for fuzzy matches (0 otherwise). */
  matchDistance?: number;
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
    const match = resolveCardMatch(ln.name, allCards);
    if (match) {
      resolved.push({
        card: match.card,
        quantity: ln.quantity,
        board: ln.board,
        matchKind: match.matchKind,
        matchDistance: match.matchDistance,
      });
    } else {
      unresolved.push({ name: ln.name, quantity: ln.quantity, board: ln.board });
    }
  }
  return { resolved, unresolved };
}
