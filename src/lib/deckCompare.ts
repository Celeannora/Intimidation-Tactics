/**
 * deckCompare.ts
 *
 * Pure comparison logic between two parsed decklists.
 * Accepts simple { name, quantity } structures so it works
 * without requiring full CardRecord lookups.
 */

export interface SimpleEntry {
  name: string;
  quantity: number;
  cmc?: number;
  typeLine?: string;
  /** Lower-cased set code, used for rotation exposure */
  setCode?: string;
  /** False until enrichFromDB has resolved this entry against the local card DB */
  enriched?: boolean;
}

export interface OverlapCard {
  name: string;
  quantityA: number;
  quantityB: number;
}

export interface CurveBucket {
  cmc: number;   // 0-6, where 6 = "6+"
  countA: number;
  countB: number;
}

export interface TypeBreakdown {
  type: string;
  countA: number;
  countB: number;
}

export interface DeckCompareResult {
  /** Cards present in both decks */
  shared: OverlapCard[];
  /** Cards only in deck A */
  onlyInA: SimpleEntry[];
  /** Cards only in deck B */
  onlyInB: SimpleEntry[];
  /** Mana-curve comparison, buckets 0-6+ (non-land spells only) */
  curve: CurveBucket[];
  /** Broad type breakdown */
  types: TypeBreakdown[];
  /** Total cards in each deck (main only) */
  totalA: number;
  totalB: number;
  /** How many cards (by quantity) are shared */
  overlapCount: number;
  /** Overlap as % of the smaller deck */
  overlapPct: number;
  /**
   * Number of distinct Deck B card names that were NOT found in the local
   * IndexedDB (cmc / typeLine fell back to 0 / ""). The UI should warn the
   * user that curve and type charts may be inaccurate for these cards.
   */
  unenrichedB: string[];
}

const BROAD_TYPES = ["Creature", "Instant", "Sorcery", "Enchantment", "Artifact", "Planeswalker", "Battle", "Land"];

function bucketCmc(cmc: number): number {
  return Math.min(cmc, 6);
}

function broadType(typeLine: string): string {
  for (const t of BROAD_TYPES) {
    if (typeLine.includes(t)) return t;
  }
  return "Other";
}

export function compareDecks(a: SimpleEntry[], b: SimpleEntry[]): DeckCompareResult {
  const mapA = new Map<string, SimpleEntry>();
  const mapB = new Map<string, SimpleEntry>();

  for (const e of a) mapA.set(e.name.toLowerCase(), e);
  for (const e of b) mapB.set(e.name.toLowerCase(), e);

  const shared: OverlapCard[] = [];
  const onlyInA: SimpleEntry[] = [];
  const onlyInB: SimpleEntry[] = [];

  for (const [key, entryA] of mapA) {
    const entryB = mapB.get(key);
    if (entryB) {
      shared.push({ name: entryA.name, quantityA: entryA.quantity, quantityB: entryB.quantity });
    } else {
      onlyInA.push(entryA);
    }
  }
  for (const [key, entryB] of mapB) {
    if (!mapA.has(key)) onlyInB.push(entryB);
  }

  const totalA = a.reduce((s, e) => s + e.quantity, 0);
  const totalB = b.reduce((s, e) => s + e.quantity, 0);
  const overlapCount = shared.reduce((s, c) => s + Math.min(c.quantityA, c.quantityB), 0);
  const overlapPct = Math.round((overlapCount / Math.min(totalA || 1, totalB || 1)) * 100);

  // Collect unenriched Deck B card names
  const unenrichedB: string[] = b
    .filter(e => e.enriched === false)
    .map(e => e.name);

  // Curve (non-land spells)
  const curveBuckets = new Map<number, { a: number; b: number }>();
  for (let i = 0; i <= 6; i++) curveBuckets.set(i, { a: 0, b: 0 });
  for (const e of a) {
    if (e.typeLine?.includes("Land")) continue;
    const bk = bucketCmc(e.cmc ?? 0);
    curveBuckets.get(bk)!.a += e.quantity;
  }
  for (const e of b) {
    if (e.typeLine?.includes("Land")) continue;
    const bk = bucketCmc(e.cmc ?? 0);
    curveBuckets.get(bk)!.b += e.quantity;
  }
  const curve: CurveBucket[] = Array.from(curveBuckets.entries()).map(([cmc, counts]) => ({
    cmc,
    countA: counts.a,
    countB: counts.b,
  }));

  // Type breakdown
  const typeMap = new Map<string, { a: number; b: number }>();
  for (const t of [...BROAD_TYPES, "Other"]) typeMap.set(t, { a: 0, b: 0 });
  for (const e of a) {
    const t = broadType(e.typeLine ?? "");
    typeMap.get(t)!.a += e.quantity;
  }
  for (const e of b) {
    const t = broadType(e.typeLine ?? "");
    typeMap.get(t)!.b += e.quantity;
  }
  const types: TypeBreakdown[] = Array.from(typeMap.entries())
    .filter(([, counts]) => counts.a > 0 || counts.b > 0)
    .map(([type, counts]) => ({ type, countA: counts.a, countB: counts.b }));

  return { shared, onlyInA, onlyInB, curve, types, totalA, totalB, overlapCount, overlapPct, unenrichedB };
}

/**
 * Parse a plain-text decklist:
 *   4 Lightning Bolt
 *   2 Island
 *   // Sideboard (ignored)
 *
 * Entries are tagged enriched:false so enrichFromDB can track which
 * cards were actually found in the local IndexedDB.
 */
export function parsePlainDecklist(text: string): SimpleEntry[] {
  const entries: SimpleEntry[] = [];
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (!line || line.startsWith("//") || line.startsWith("#")) continue;
    const match = line.match(/^(\d+)x?\s+(.+)$/);
    if (!match) continue;
    entries.push({ name: match[2].trim(), quantity: parseInt(match[1], 10), enriched: false });
  }
  return entries;
}
