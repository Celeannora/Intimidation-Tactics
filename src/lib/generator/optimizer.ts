import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { GenerateOptions } from "./types";
import { deckScore, quickRank } from "./weights";

export interface OptimizeResult {
  entries: DeckEntry[];
  finalScore: number;
  steps: number;
  improvements: number;
}

interface OptimizeContext {
  pool: CardRecord[];
  options: GenerateOptions;
  targetAvgCmc: number;
  /** oracleIds locked from the seed deck — never swapped out. */
  locked: Set<string>;
  /** Maximum number of swap attempts. */
  iterations: number;
  /** RNG (deterministic if seeded). */
  rng: () => number;
}

type RoleSlot = "threats" | "removal" | "boardWipes" | "counterspells" | "cardDraw" | "ramp";

/**
 * Pre-sort the pool into role-sorted priority buckets.
 * Each entry is scored with quickRank and placed into one or more role buckets
 * based on assignRoles. Within each bucket, entries are sorted descending by rank.
 */
function rankPool(
  pool: CardRecord[],
  _deckSoFar: DeckEntry[],
  options: GenerateOptions
): Map<RoleSlot, CardRecord[]> {
  const buckets: Map<RoleSlot, CardRecord[]> = new Map();
  const slots: RoleSlot[] = ["threats", "removal", "boardWipes", "counterspells", "cardDraw", "ramp"];
  for (const s of slots) buckets.set(s, []);

  for (const card of pool) {
    if (card.typeLine.includes("Land")) continue;
    const roles = _getRoles(card);
    for (const slot of slots) {
      if (_matchesSlot(slot, roles)) {
        buckets.get(slot)!.push(card);
      }
    }
  }

  // Sort each bucket by rank descending
  for (const s of slots) {
    buckets.get(s)!.sort((a, b) => {
      return quickRank(b, options.archetype) - quickRank(a, options.archetype);
    });
    // Keep only top 30 per role slot for performance
    const arr = buckets.get(s)!;
    if (arr.length > 30) buckets.set(s, arr.slice(0, 30));
  }

  return buckets;
}

/**
 * Detect which role a card belongs to (lightweight version without importing roles.ts).
 */
function _getRoles(card: CardRecord): string[] {
  const roles: string[] = [];
  const tl = card.typeLine;
  const text = (card.oracleText ?? "").toLowerCase();
  const isCreature = tl.includes("Creature");
  const isLand = tl.includes("Land");
  if (isLand) return roles;

  // Threats
  if (isCreature) {
    const power = parseInt(card.power ?? "0", 10);
    if (!isNaN(power) && power >= 3) roles.push("threats");
  }
  // Removal
  if (
    text.includes("destroy target") ||
    text.includes("exile target") ||
    (text.includes("deals") && text.includes("damage to target creature"))
  ) roles.push("removal");
  // Board wipe
  if (
    text.includes("destroy all") ||
    text.includes("exile all") ||
    (text.includes("each creature") && text.includes("-"))
  ) roles.push("boardWipes");
  // Counterspell
  if (text.includes("counter target spell")) roles.push("counterspells");
  // Card draw
  if (/draw (a|[2-9]|\d+) card/.test(text)) roles.push("cardDraw");
  // Ramp
  if (text.includes("add {") || (card.producedManaJson && card.producedManaJson !== "[]")) roles.push("ramp");

  return roles;
}

function _matchesSlot(slot: RoleSlot, roles: string[]): boolean {
  return roles.includes(slot);
}

/**
 * Hill-climb / simulated-annealing optimizer with ranked candidate selection.
 *
 * For up to N iterations:
 *   1. Pick a random non-locked, nonland entry to consider replacing.
 *   2. Draw the top candidates from the pre-ranked role bucket that matches
 *      the target entry's role.
 *   3. For each candidate, compute the new deck score if we swap.
 *   4. Accept the best candidate if it raises the score (greedy).
 *      Else accept with prob = exp(Δ/T) (annealing).
 *
 * Temperature decays linearly. Final pass (T=0) is pure greedy.
 */
export function optimize(
  startingEntries: DeckEntry[],
  ctx: OptimizeContext
): OptimizeResult {
  let entries = cloneEntries(startingEntries);
  let bestScore = deckScore(entries, ctx.options, ctx.targetAvgCmc).total;
  let bestEntries = cloneEntries(entries);
  let improvements = 0;

  // Pre-rank pool into role buckets
  const roleBuckets = rankPool(ctx.pool, entries, ctx.options);

  const startTemp = 6.0;

  for (let i = 0; i < ctx.iterations; i++) {
    const t = Math.max(0, startTemp * (1 - i / ctx.iterations));

    // Pick a candidate slot to replace: prefer entries with low individual contribution.
    const swappable = entries
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => !ctx.locked.has(e.card.oracleId) && !e.card.typeLine.includes("Land"));
    if (swappable.length === 0) break;

    const targetIdx = swappable[Math.floor(ctx.rng() * swappable.length)].idx;
    const target = entries[targetIdx];

    // Determine which role bucket(s) the target card fits, pick one at random
    const tgtRoles = _getRoles(target.card);
    const validSlots: RoleSlot[] = tgtRoles.length > 0
      ? tgtRoles as RoleSlot[]
      : ["threats"];
    const selectedSlot = validSlots[Math.floor(ctx.rng() * validSlots.length)];
    const bucket = roleBuckets.get(selectedSlot) ?? [];

    // Filter to candidates not already in deck
    const inDeck = new Set(entries.map((e) => e.card.oracleId));
    const candidates = bucket.filter((c) => !inDeck.has(c.oracleId));

    if (candidates.length === 0) continue;

    // Try top B candidates (B = min(8, bucket size))
    const B = Math.min(8, candidates.length);
    let bestCandidate: CardRecord | null = null;
    let bestDelta = -Infinity;

    for (let k = 0; k < B; k++) {
      const cand = candidates[k];
      const trial = entries.slice();
      trial[targetIdx] = { card: cand, quantity: target.quantity, board: target.board };
      const trialScore = deckScore(trial, ctx.options, ctx.targetAvgCmc).total;
      const delta = trialScore - bestScore;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestCandidate = cand;
      }
    }

    if (!bestCandidate) continue;

    const accept =
      bestDelta > 0 ||
      (t > 0 && Math.exp(bestDelta / Math.max(0.1, t)) > ctx.rng());

    if (accept) {
      entries = entries.slice();
      entries[targetIdx] = {
        card: bestCandidate,
        quantity: target.quantity,
        board: target.board,
      };
      const newScore = deckScore(entries, ctx.options, ctx.targetAvgCmc).total;
      if (newScore > bestScore) {
        bestScore = newScore;
        bestEntries = cloneEntries(entries);
        improvements++;
      }
    }
  }

  return {
    entries: bestEntries,
    finalScore: bestScore,
    steps: ctx.iterations,
    improvements,
  };
}

function cloneEntries(entries: DeckEntry[]): DeckEntry[] {
  return entries.map((e) => ({ card: e.card, quantity: e.quantity, board: e.board }));
}

/** Mulberry32 — small deterministic RNG so variants can be reproducible if seeded. */
export function makeRng(seed: number): () => number {
  let a = seed >>> 0;
  return function rng() {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
