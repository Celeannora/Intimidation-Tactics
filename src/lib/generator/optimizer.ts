import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import { maxCopiesForCard } from "../legality";
import { isCardLegalInFormat } from "../formats";
import type { GenerateOptions } from "./types";
import { deckScore, quickRank } from "./weights";

export interface OptimizeResult {
  entries: DeckEntry[];
  finalScore: number;
  /** Scored single-swap rounds plus scored deterministic pair trials. */
  steps: number;
  improvements: number;
}

interface OptimizeContext {
  pool: CardRecord[];
  options: GenerateOptions;
  targetAvgCmc: number;
  /** oracleIds locked from the seed deck — never swapped out. */
  locked: Set<string>;
  /** Single-swap round budget; <= 0 also disables the optional pair pass. */
  iterations: number;
  /** RNG (deterministic if seeded). */
  rng: () => number;
}

type RoleSlot = "threats" | "removal" | "boardWipes" | "counterspells" | "cardDraw" | "ramp" | "support";

const MAX_PACKAGES = 8;
const MAX_PACKAGE_DONORS = 6;
const MAX_SIGNALS_PER_KIND = 32;
const MAX_PACKAGE_CARDS = 8;

interface PackageSignal {
  oracleIds: string[];
  requiredQuantities?: Record<string, number>;
  prerequisites?: string;
  prerequisitesSatisfied?: boolean;
}

function isSwappable(entry: DeckEntry, locked: Set<string>): boolean {
  return entry.board === "main" && !locked.has(entry.card.oracleId)
    && !entry.card.typeLine.includes("Land");
}

function canInheritQuantity(card: CardRecord, quantity: number, options: GenerateOptions): boolean {
  return Number.isSafeInteger(quantity) && quantity > 0
    && quantity <= maxCopiesForCard(card, options.format);
}

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
  const slots: RoleSlot[] = ["threats", "removal", "boardWipes", "counterspells", "cardDraw", "ramp", "support"];
  for (const s of slots) buckets.set(s, []);

  for (const card of pool) {
    if (card.typeLine.includes("Land") || !isCardLegalInFormat(card, options.format)) continue;
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

  // Synergy glue must not fall through to the generic threat bucket. During
  // optimization that bucket is the broad fallback candidate pool, so treating
  // tribal lords, anthems, cost reducers, and static setup pieces as threats
  // made them especially easy to replace with standalone beaters.
  const isSupport =
    /other [a-z]+s? you control (?:get \+\d+\/\+\d+|have )/.test(text) ||
    /(?:spells?|creature spells?|artifact spells?|instant and sorcery spells?) you cast cost .* less/.test(text) ||
    /create .* token|whenever .* (?:token|artifact|creature) .* enters/.test(text);
  if (isSupport) roles.push("support");

  // Threats
  if (isCreature && !isSupport) {
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
 * Temperature decays linearly but stays positive throughout the single-swap
 * loop. The best visited deck is saved separately from the annealing walk.
 * With combo context and a positive iteration budget, a deterministic greedy
 * pair pass then starts from that best deck. Signals guide proposals, not a
 * claim that a combo is executable. See improvePackages for its fixed budget.
 */
export function optimize(
  startingEntries: DeckEntry[],
  ctx: OptimizeContext
): OptimizeResult {
  let entries = cloneEntries(startingEntries);
  let currentScore = deckScore(entries, ctx.options, ctx.targetAvgCmc).total;
  let bestScore = currentScore;
  let bestEntries = cloneEntries(entries);
  let improvements = 0;
  let steps = 0;

  // Pre-rank pool into role buckets
  const roleBuckets = rankPool(ctx.pool, entries, ctx.options);

  const startTemp = 6.0;

  for (let i = 0; i < ctx.iterations; i++) {
    const t = Math.max(0, startTemp * (1 - i / ctx.iterations));

    // Pick a random eligible mainboard entry.
    const swappable = entries
      .map((e, idx) => ({ e, idx }))
      .filter(({ e }) => isSwappable(e, ctx.locked));
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
    const candidates = bucket.filter((c) => !inDeck.has(c.oracleId)
      && canInheritQuantity(c, target.quantity, ctx.options));

    if (candidates.length === 0) continue;
    steps++;

    // Try top B candidates (B = min(8, bucket size))
    const B = Math.min(8, candidates.length);
    let bestCandidate: CardRecord | null = null;
    let bestDelta = -Infinity;
    let bestCandidateScore = currentScore;

    for (let k = 0; k < B; k++) {
      const cand = candidates[k];
      const trial = entries.slice();
      trial[targetIdx] = { ...target, card: cand };
      const trialScore = deckScore(trial, ctx.options, ctx.targetAvgCmc).total;
      const delta = trialScore - currentScore;
      if (delta > bestDelta) {
        bestDelta = delta;
        bestCandidate = cand;
        bestCandidateScore = trialScore;
      }
    }

    if (!bestCandidate) continue;

    const accept =
      bestDelta > 0 ||
      (t > 0 && Math.exp(bestDelta / Math.max(0.1, t)) > ctx.rng());

    if (accept) {
      entries = entries.slice();
      entries[targetIdx] = {
        ...target,
        card: bestCandidate,
      };
      currentScore = bestCandidateScore;
      const newScore = currentScore;
      if (newScore > bestScore) {
        bestScore = newScore;
        bestEntries = cloneEntries(entries);
        improvements++;
      }
    }
  }

  if (ctx.iterations > 0 && ctx.options.comboSynergyContext) {
    const pairResult = improvePackages(bestEntries, bestScore, ctx);
    bestEntries = pairResult.entries;
    bestScore = pairResult.finalScore;
    steps += pairResult.steps;
    improvements += pairResult.improvements;
  }

  return {
    entries: bestEntries,
    finalScore: bestScore,
    steps,
    improvements,
  };
}

/**
 * Inspect at most 32 signals of each kind, each with 2..8 distinct cards.
 * Try at most 8 distinct two-missing-card packages and the first 6 eligible
 * donors: 6 * 5 ordered assignments each, at most 240 extra deckScore calls.
 * Whole-entry substitutions preserve both quantities and mainboard size;
 * existing package members, lands, sideboard entries and locks are not donors.
 * Missing cards must be absent across both boards, so the incoming quantity
 * check also enforces the combined-board copy cap without merging entries.
 * Explicit requiredQuantities are honored (legacy signals default to one).
 * This pass does not top up existing entries or prove textual prerequisites;
 * nonempty prerequisite prose requires explicit prerequisitesSatisfied=true.
 */
function improvePackages(entries: DeckEntry[], score: number, ctx: OptimizeContext): OptimizeResult {
  const context = ctx.options.comboSynergyContext!;
  const signals: PackageSignal[] = [
    ...context.verifiedCombos.slice(0, MAX_SIGNALS_PER_KIND).map((combo) => ({ ...combo, oracleIds: combo.cardOracleIds })),
    ...context.chains.slice(0, MAX_SIGNALS_PER_KIND),
  ];
  const poolById = new Map(ctx.pool
    .filter((card) => !card.typeLine.includes("Land") && isCardLegalInFormat(card, ctx.options.format))
    .map((card) => [card.oracleId, card]));
  const seen = new Set<string>();
  let steps = 0;
  let improvements = 0;

  for (const signal of signals) {
    if (seen.size >= MAX_PACKAGES) break;
    if (signal.prerequisites?.trim() && signal.prerequisitesSatisfied !== true) continue;
    if (signal.oracleIds.length < 2 || signal.oracleIds.length > MAX_PACKAGE_CARDS) continue;
    const ids = [...new Set(signal.oracleIds)];
    if (ids.length !== signal.oracleIds.length) continue;
    const requirements = signal.requiredQuantities ?? {};
    const requirementIds = Object.keys(requirements);
    if (requirementIds.length > MAX_PACKAGE_CARDS || requirementIds.some((id) => !ids.includes(id)
      || !Number.isSafeInteger(requirements[id]) || requirements[id] <= 0)) continue;
    const counts = new Map<string, number>();
    for (const entry of entries) {
      if (entry.board === "main") {
        counts.set(entry.card.oracleId, (counts.get(entry.card.oracleId) ?? 0) + entry.quantity);
      }
    }
    const missing = ids.filter((id) => (counts.get(id) ?? 0) < (requirements[id] ?? 1));
    if (missing.length !== 2) continue;
    const key = JSON.stringify(missing.slice().sort());
    if (seen.has(key)) continue;
    seen.add(key);

    const inDeck = new Set(entries.map((entry) => entry.card.oracleId));
    const first = poolById.get(missing[0]);
    const second = poolById.get(missing[1]);
    if (!first || !second || missing.some((id) => inDeck.has(id))) continue;
    const donors = entries.map((entry, idx) => ({ entry, idx }))
      .filter(({ entry }) => isSwappable(entry, ctx.locked) && !ids.includes(entry.card.oracleId))
      .slice(0, MAX_PACKAGE_DONORS);
    let bestTrial = entries;
    let bestTrialScore = score;
    for (const a of donors) {
      if (!canInheritQuantity(first, a.entry.quantity, ctx.options)
        || a.entry.quantity < (requirements[first.oracleId] ?? 1)) continue;
      for (const b of donors) {
        if (a.idx === b.idx || !canInheritQuantity(second, b.entry.quantity, ctx.options)
          || b.entry.quantity < (requirements[second.oracleId] ?? 1)) continue;
        const trial = entries.slice();
        trial[a.idx] = { ...a.entry, card: first };
        trial[b.idx] = { ...b.entry, card: second };
        steps++;
        const trialScore = deckScore(trial, ctx.options, ctx.targetAvgCmc).total;
        if (trialScore > bestTrialScore) {
          bestTrial = trial;
          bestTrialScore = trialScore;
        }
      }
    }
    if (bestTrialScore > score) {
      entries = bestTrial;
      score = bestTrialScore;
      improvements++;
    }
  }
  return { entries, finalScore: score, steps, improvements };
}

function cloneEntries(entries: DeckEntry[]): DeckEntry[] {
  return entries.map((e) => ({ ...e }));
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
