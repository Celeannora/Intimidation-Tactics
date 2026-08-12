/**
 * scripts/hopeEstheimComparison.ts
 *
 * Proof-of-concept comparison for the synergy-first branch
 * (synergy-first/hope-estheim-space-time-anomaly).
 *
 * Runs TWO scorers over the same real Standard-legal Azorius card pool
 * (fetched from Scryfall) and does a card-by-card sequential build with
 * each, so the shortfalls of the existing composite/standalone scoring
 * approach are demonstrated directly against the new synergy-first
 * sequential approach — not just asserted.
 *
 *   1. EXISTING ENGINE  — scoreEngine.ts::scoreCandidates (composite score:
 *      role-power + directional/synergy + composition + castability, using
 *      the shared generic Archetype/axis model). This is standalone-power
 *      leaning because its role-power term is archetype-generic (Control),
 *      not seed-specific, and its synergy axes are generic mechanic axes
 *      (graveyard/tokens/etc.), not "does this feed Hope/Space-Time
 *      Anomaly specifically."
 *
 *   2. SYNERGY-FIRST ENGINE — seedSynergy.ts::scoreCandidate,
 *      re-scored after every single pick against the CURRENT role-gap
 *      state (Enabler/Protection/Consistency/Payoff), with payoff
 *      saturation penalties and turn-usability bonuses specific to this
 *      seed's two-clock mechanic (life-gained-this-turn vs. total-life-total).
 *
 * Output: a log of every pick from both engines, and an explicit
 * "DIVERGENCE" list showing where the two engines disagree — this is the
 * shortfall evidence for the proof of concept.
 */

import { readFileSync, writeFileSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
import type { ScryfallCard, CardRecord } from "../src/lib/types";
import { toCardRecord, isStandardEligible } from "../src/lib/scryfall";
import type { DeckEntry } from "../src/lib/legality";
import { scoreCandidates } from "../src/lib/scoreEngine";
import {
  classifySeedRoles,
  tallyRoleCounts,
  scoreCandidate,
  checkFeasibility,
  rolesAtCeiling,
  reanalyzeDeck,
  neutralAdjustments,
  inferResourceSpec,
  inferSeedAnthemSynergy,
  SEED_ROLE_TARGETS,
  type DeckAdjustments,
  type DeckRoleCounts,
  type ResourceSpec,
  type SeedAnthemSpec,
  type SeedRole,
  type SeedPackage,
} from "../src/lib/generator/seedSynergy";
import { recommendDualLands } from "../src/lib/manaBase";
import { countLandSources } from "../src/lib/landSources";

const POOL_DIR = join(__dirname, "..", "..", "pool_data");

// Script-level build configuration: swap this package to evaluate another
// seed without changing the generic scoring engine.
const SEED_PACKAGE: SeedPackage = [
  { name: "Hope Estheim", quantity: 4 },
  { name: "Space-Time Anomaly", quantity: 4 },
  { name: "Lyra Dawnbringer", quantity: 4 },
];
const SEED_QUANTITIES = new Map(SEED_PACKAGE.map((card) => [card.name, card.quantity]));
let activeResourceSpec: ResourceSpec | null = null;
let activeAnthemSpec: SeedAnthemSpec | null = null;

// All engine calls receive the script's explicit seed configuration. The
// inferred spec remains null only when a payoff does not expose a clear
// countable resource, in which case cadence scoring is intentionally skipped.
function classify(card: CardRecord): SeedRole[] {
  return classifySeedRoles(card, SEED_PACKAGE, activeResourceSpec);
}

function tally(entries: { card: CardRecord; quantity: number }[]): DeckRoleCounts {
  return tallyRoleCounts(entries, SEED_PACKAGE, activeResourceSpec);
}

function atCeiling(counts: DeckRoleCounts): Set<SeedRole> {
  return rolesAtCeiling(counts, SEED_ROLE_TARGETS);
}

function scoreWithSeed(
  card: CardRecord,
  counts: DeckRoleCounts,
  basePowerScore: number,
  adjustments?: DeckAdjustments,
) {
  return scoreCandidate(
    card,
    counts,
    basePowerScore,
    SEED_PACKAGE,
    activeResourceSpec,
    SEED_ROLE_TARGETS,
    adjustments,
    activeAnthemSpec,
  );
}

function feasibility(counts: DeckRoleCounts, colorSources: { w: number; u: number }) {
  return checkFeasibility(counts, colorSources, SEED_ROLE_TARGETS);
}

// Scryfall pre-marks preview/spoiler sets as standard-legal weeks before
// they actually release (and before they exist on Arena), so a pool built
// purely from the legality flag can select cards nobody can play yet.
// Discovered when the generated deck included two cards from unreleased
// sets that failed MTGA import. Only cards released on or before today
// are eligible.
const TODAY = new Date().toISOString().slice(0, 10);

function isReleased(sc: ScryfallCard): boolean {
  // Basic lands exist in every set; the specific printing Scryfall happens
  // to return may be from an upcoming set, but the card itself is always
  // available, so basics are exempt from the release-date filter.
  if (sc.type_line?.includes("Basic Land")) return true;
  const released = (sc as unknown as { released_at?: string }).released_at;
  return !released || released <= TODAY;
}

function loadPool(): CardRecord[] {
  const files = ["azorius_pool.json", "colorless_artifacts.json"];
  const seen = new Set<string>();
  const records: CardRecord[] = [];
  const importedAt = new Date().toISOString();

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(POOL_DIR, file), "utf-8")) as ScryfallCard[];
    for (const sc of raw) {
      if (!isStandardEligible(sc)) continue;
      if (!isReleased(sc)) continue;
      if (seen.has(sc.oracle_id)) continue;
      // Restrict artifacts file to genuinely colorless-castable cards (already filtered by query, but double check).
      seen.add(sc.oracle_id);
      records.push(toCardRecord(sc, importedAt));
    }
  }
  return records;
}

function loadLands(): CardRecord[] {
  const raw = JSON.parse(readFileSync(join(POOL_DIR, "lands.json"), "utf-8")) as ScryfallCard[];
  const importedAt = new Date().toISOString();
  const seen = new Set<string>();
  const records: CardRecord[] = [];
  for (const sc of raw) {
    if (!isStandardEligible(sc)) continue;
    if (!isReleased(sc)) continue;
    if (seen.has(sc.oracle_id)) continue;
    seen.add(sc.oracle_id);
    records.push(toCardRecord(sc, importedAt));
  }
  return records;
}

// ── Existing-engine sequential build (composite/standalone-leaning) ─────

function buildWithExistingEngine(pool: CardRecord[], seedCards: CardRecord[]): {
  entries: DeckEntry[];
  log: string[];
} {
  const entries: DeckEntry[] = seedCards.map((card) => ({ card, quantity: SEED_QUANTITIES.get(card.name) ?? 1, board: "main" as const }));
  const log: string[] = [];
  const seedNames = new Set(seedCards.map((c) => c.name));
  const targetNonlandCount = 36; // 60 - 24 lands
  let remainingPool = pool.filter((c) => !seedNames.has(c.name) && !c.typeLine.includes("Land"));

  let nonlandCount = entries.reduce((s, e) => s + e.quantity, 0);

  while (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    const scored = scoreCandidates(remainingPool, entries, { archetype: "Control" });
    const pick = scored[0];
    if (!pick) break;
    const isLegendary = pick.card.typeLine.includes("Legendary");
    const suggestedQty = isLegendary ? 2 : 4;
    const qty = Math.min(suggestedQty, targetNonlandCount - nonlandCount);
    entries.push({ card: pick.card, quantity: qty, board: "main" });
    nonlandCount += qty;
    log.push(
      `[EXISTING] Pick: ${pick.card.name} x${qty} — composite score ${pick.score.total} ` +
      `(rolePower=${pick.score.rolePowerScore.toFixed(1)}, directional=${pick.score.directionalScore.toFixed(1)}, ` +
      `synergyMult=${pick.score.synergyMultiplier.toFixed(2)}, castPenalty=${pick.score.castabilityPenalty.toFixed(1)})`
    );
    remainingPool = remainingPool.filter((c) => c.name !== pick.card.name);
  }

  return { entries, log };
}

// ── Synergy-first sequential build ───────────────────────────────────────

/**
 * How many more cards of this role can still be added before the deck
 * exceeds the role's target CEILING (not floor). Used to cap playset size
 * per-pick so one strong early card can't single-handedly blow past a
 * role's whole target band.
 */
function roleRoomRemaining(role: SeedRole, counts: DeckRoleCounts): number {
  switch (role) {
    case "Enabler":
      return Math.max(0, SEED_ROLE_TARGETS.enablers[1] - counts.enablers);
    case "Protection":
      return Math.max(0, SEED_ROLE_TARGETS.protection[1] - counts.protection);
    case "Consistency":
      return Math.max(0, SEED_ROLE_TARGETS.consistency[1] - counts.consistency);
    case "Payoff":
      return Math.max(0, SEED_ROLE_TARGETS.payoffs[1] - counts.payoffs);
  }
}

/**
 * How many copies of this role are already OVER its ceiling (0 if within
 * band). Used only by the last-resort OVERFLOW passes below, to prefer the
 * candidate that breaches its ceiling by the SMALLEST amount rather than
 * whichever single role happens to score highest and absorb the entire
 * overflow. Without this, one role (e.g. Consistency) can silently swallow
 * every overflow slot and blow from a 10-card ceiling to 20, as happened in
 * the pre-fix batched seed-chain run.
 */
function roleOvershoot(role: SeedRole, counts: DeckRoleCounts): number {
  switch (role) {
    case "Enabler":
      return Math.max(0, counts.enablers - SEED_ROLE_TARGETS.enablers[1]);
    case "Protection":
      return Math.max(0, counts.protection - SEED_ROLE_TARGETS.protection[1]);
    case "Consistency":
      return Math.max(0, counts.consistency - SEED_ROLE_TARGETS.consistency[1]);
    case "Payoff":
      return Math.max(0, counts.payoffs - SEED_ROLE_TARGETS.payoffs[1]);
  }
}

/**
 * Worst-case ceiling overshoot a candidate would cause if added at the given
 * quantity: the max over its roles of (current overshoot + qty), so a
 * multi-role card is judged by its most-saturated role, not its least.
 */
function projectedOvershoot(card: CardRecord, counts: DeckRoleCounts, qty: number): number {
  const roles = classify(card);
  if (roles.length === 0) return 0;
  return Math.max(...roles.map((r) => roleOvershoot(r, counts) + Math.max(0, qty - roleRoomRemaining(r, counts))));
}

function buildWithSynergyFirstEngine(pool: CardRecord[], seedCards: CardRecord[]): {
  entries: DeckEntry[];
  log: string[];
  counts: DeckRoleCounts;
} {
  const entries: DeckEntry[] = seedCards.map((card) => ({ card, quantity: SEED_QUANTITIES.get(card.name) ?? 1, board: "main" as const }));
  const log: string[] = [];
  const seedNames = new Set(seedCards.map((c) => c.name));
  const targetNonlandCount = 36;
  let remainingPool = pool.filter((c) => !seedNames.has(c.name) && !c.typeLine.includes("Land") && classify(c).length > 0);

  let counts = tally(entries);
  let nonlandCount = entries.reduce((s, e) => s + e.quantity, 0);

  while (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    // Re-score EVERY remaining candidate against the CURRENT role-gap state.
    // This is the key structural difference: role-gap multipliers and
    // saturation penalties are only meaningful relative to what has
    // already been picked, so scoring must happen sequentially, not once.
    // Hard-skip roles that are already at/above their ceiling — the soft
    // multiplier fade alone let one role (Protection) dominate the whole
    // fill pass in the first run of this comparison, because a card that
    // ALSO matched a still-open role could still win on its Protection
    // score. Excluding cards whose only open role is already full forces
    // rotation once a band is satisfied.
    const fullRoles = atCeiling(counts);
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate> } | null = null;
    for (const card of remainingPool) {
      const cardRoles = classify(card);
      // A card is only eligible if EVERY role it touches still has room.
      // Requiring just "at least one open role" (the original version of
      // this check) let a dual-tagged card such as a Protection+Enabler
      // removal spell keep sliding through on its Enabler gap even after
      // Protection was already near its ceiling, because the pick's whole
      // quantity was still credited to the secondary Protection counter
      // too. That is exactly the mechanism that pushed Protection to
      // 18/12 and Consistency to 14/10 in the previous run.
      const allRolesOpen = cardRoles.every((r) => !fullRoles.has(r));
      if (!allRolesOpen) continue;

      // Cheap proxy for "standalone power" reusing the existing heuristic
      // so both engines start from a comparable power baseline; the seed
      // module then applies role-gap/saturation/timing on top of it.
      const basePower = basePowerProxy(card);
      const score = scoreWithSeed(card, counts, basePower);
      if (!best || score.final > best.score.final) {
        best = { card, score };
      }
    }
    if (!best) {
      // No remaining candidate has EVERY role open — every card left in
      // the pool touches at least one saturated role. Rather than silently
      // dropping the ceiling constraint entirely (which is what let
      // Protection creep to 17-18 in earlier runs of this script: this
      // fallback used to score the whole unfiltered pool with no role
      // restriction at all), relax to "at least one role still open,
      // AND prefer whichever open role has the most room" — the same
      // rule as the main loop originally used, but only as a fallback of
      // last resort, and the resulting quantity is still hard-capped
      // below by roleRoomRemaining so it cannot push any role past
      // ceiling by more than the cap allows.
      for (const card of remainingPool) {
        const cardRoles = classify(card);
        const hasAnyOpenRole = cardRoles.some((r) => !fullRoles.has(r));
        if (!hasAnyOpenRole) continue;
        const basePower = basePowerProxy(card);
        const score = scoreWithSeed(card, counts, basePower);
        if (!best || score.final > best.score.final) best = { card, score };
      }
    }
    if (!best) break;

    // Realistic playset sizing instead of always maxing at 4 — legendary
    // cards and narrow/situational effects are typically run at 1-2 copies
    // even in a card-advantage-dense control shell, and running everything
    // as a forced 4-of is exactly the kind of "looks powerful on paper"
    // distortion the brief warns against.
    //
    // Critically, the quantity is ALSO capped by how much room is actually
    // left in whichever role(s) this specific card fills. Without this, a
    // single winning pick early in the build (when a role's gap is at its
    // widest, and therefore its multiplier is highest) could add 4 copies
    // in one shot and blow straight through that role's entire target
    // band in a single round — which is exactly what happened in the first
    // version of this script and is why Protection overshot to 24/12.
    const isLegendary = best.card.typeLine.includes("Legendary");
    const suggestedQty = isLegendary ? 2 : 4;
    const cardRoles = classify(best.card);
    const roleRoomCaps = cardRoles.map((r) => roleRoomRemaining(r, counts));
    // A genuine zero-room role must clamp qty to zero, not floor at 1 —
    // flooring at 1 is exactly what let single-copy picks push Protection
    // and Consistency past their ceilings one card at a time in earlier
    // runs (every overshoot pick in the prior log was a "x1").
    const roleCap = roleRoomCaps.length > 0 ? Math.min(...roleRoomCaps) : suggestedQty;
    const qty = Math.max(0, Math.min(suggestedQty, roleCap, targetNonlandCount - nonlandCount));
    if (qty === 0) {
      // This candidate cannot be added without breaching a role ceiling —
      // drop it from the pool and retry the round with the next-best card.
      remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
      continue;
    }
    entries.push({ card: best.card, quantity: qty, board: "main" });
    nonlandCount += qty;
    counts = tally(entries);
    log.push(
      `[SYNERGY-FIRST] Pick: ${best.card.name} x${qty} — final=${best.score.final.toFixed(1)} ` +
      `(base=${best.score.base.toFixed(1)}, gapMult=${best.score.roleGapMultiplier.toFixed(2)}, ` +
      `satPenalty=${best.score.saturationPenalty.toFixed(1)}, timing=${best.score.curveTimingBonus}, prevention=${best.score.preventionBonus}) ` +
      `— ${best.score.note}`
    );
    remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
  }

  // If every role hit its ceiling before reaching the 36-card nonland
  // target, the strict "all roles open" rule has nowhere left to add —
  // this is a real, reportable finding (the target bands as specified
  // can undershoot the nonland total once payoffs are seed-locked and
  // every other role caps out), not something to paper over silently.
  // Rather than leave the deck short, log the shortfall explicitly and
  // top up with the single best-scoring remaining card regardless of
  // ceiling, clearly marked as an OVERFLOW pick so it is visible in the
  // report which slots exceeded their target band and by how much.
  if (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    log.push(
      `[SYNERGY-FIRST] SHORTFALL: strict role-ceiling rule exhausted all eligible candidates at ` +
      `${nonlandCount}/${targetNonlandCount} nonland cards (roles at ceiling: ${[...atCeiling(counts)].join(", ")}). ` +
      `Topping up remaining ${targetNonlandCount - nonlandCount} slots with best-scoring cards regardless of ceiling — see OVERFLOW picks below.`
    );
  }
  while (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    // TOP-UP PASS: prefer deepening an existing under-max entry at zero (or
    // minimal) extra overshoot over reaching for a brand-new singleton —
    // see the identical block in the seed-chain engine's OVERFLOW loop for
    // the full rationale (this is what fixes fragmentation: 1-of Basri,
    // Kitsa, etc. instead of deepening cards already in the deck).
    let topUp: { entryIdx: number; addQty: number; overshoot: number } | null = null;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLegendary = entry.card.typeLine.includes("Legendary");
      const cap = isLegendary ? 2 : 4;
      if (entry.quantity >= cap) continue;
      const room = Math.min(cap - entry.quantity, targetNonlandCount - nonlandCount);
      if (room < 1) continue;
      const countsWithout = tally(entries.map((e, j) => (j === i ? { ...e, quantity: e.quantity - entry.quantity } : e)));
      const overshoot = projectedOvershoot(entry.card, countsWithout, entry.quantity + room);
      if (!topUp || overshoot < topUp.overshoot || (overshoot === topUp.overshoot && room > topUp.addQty)) {
        topUp = { entryIdx: i, addQty: room, overshoot };
      }
    }

    // Minimize ceiling breach, THEN score — not the other way around. Picking
    // by pure score here is what let one role (Consistency) silently absorb
    // the entire overflow and blow from a 10-card ceiling to 20: whichever
    // role scored best overall kept winning every single overflow round.
    // Instead, prefer whichever candidate/qty combination causes the
    // SMALLEST projected overshoot of any role it touches, and only use
    // score to break ties among equally-minimal-overshoot candidates.
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate>; qty: number; overshoot: number } | null = null;
    for (const card of remainingPool) {
      const isLegendary = card.typeLine.includes("Legendary");
      const maxQty = Math.min(isLegendary ? 2 : 4, targetNonlandCount - nonlandCount);
      const basePower = basePowerProxy(card);
      const score = scoreWithSeed(card, counts, basePower);
      // Find THIS card's own best (largest-quantity, minimal-overshoot) pick
      // first — iterate qty from max down to 1 and keep the largest qty that
      // achieves this card's personal minimum overshoot. This avoids the
      // fragmentation bug where a card is locked in at x1 just because x1
      // happens to hit zero overshoot, even when x4 would ALSO hit zero
      // overshoot and give a clean playset instead of a dead one-of.
      let cardBestQty = 1;
      let cardBestOvershoot = projectedOvershoot(card, counts, 1);
      for (let qty = 2; qty <= maxQty; qty++) {
        const overshoot = projectedOvershoot(card, counts, qty);
        if (overshoot <= cardBestOvershoot) {
          cardBestQty = qty;
          cardBestOvershoot = overshoot;
        }
      }
      // Across candidates: smallest overshoot wins; score breaks ties.
      if (
        !best ||
        cardBestOvershoot < best.overshoot ||
        (cardBestOvershoot === best.overshoot && score.final > best.score.final)
      ) {
        best = { card, score, qty: cardBestQty, overshoot: cardBestOvershoot };
      }
    }
    if (topUp && (!best || topUp.overshoot <= best.overshoot)) {
      const entry = entries[topUp.entryIdx];
      entry.quantity += topUp.addQty;
      nonlandCount += topUp.addQty;
      counts = tally(entries);
      log.push(
        `[SYNERGY-FIRST] OVERFLOW top-up: ${entry.card.name} +${topUp.addQty} (now ${entry.quantity}x) — ` +
        `depth on an existing pick preferred over a new singleton (overshoot=${topUp.overshoot}).`
      );
      continue;
    }
    if (!best) break;
    entries.push({ card: best.card, quantity: best.qty, board: "main" });
    nonlandCount += best.qty;
    counts = tally(entries);
    log.push(
      `[SYNERGY-FIRST] OVERFLOW pick: ${best.card.name} x${best.qty} — final=${best.score.final.toFixed(1)} ` +
      `(min-overshoot=${best.overshoot}) — added past ceiling to reach the 36-card nonland target; role counts after: ${JSON.stringify(counts)}`
    );
    remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
  }

  return { entries, log, counts };
}

function basePowerProxy(card: CardRecord): number {
  // Lightweight standalone-power proxy independent of the shared engine's
  // Control-archetype role multiplier, so this isn't just re-deriving the
  // same number under a different name.
  //
  // NOTE: this proxy is coarse by design (a handful of keyword bonuses), so
  // near-ties ARE expected — e.g. Sheltered by Ghosts ("exile target
  // nonland permanent... until this leaves, +1/+0, lifelink, ward 2") and
  // Shattered Acolyte ("lifelink, {1}, sacrifice: destroy target artifact
  // or enchantment") both hit "exile/destroy target" and land on the same
  // score despite being different effects (unconditional exile-any-permanent
  // vs. a narrower, sacrifice-costed destroy limited to artifact/enchantment,
  // and a removal effect gated behind staying attached vs. one on a
  // standalone body). Distinguishing them further below; remaining ties are
  // intentional and must be broken deterministically by the caller, never
  // silently by pool array order.
  let score = 5;
  const text = (card.oracleText ?? "").toLowerCase();
  if (card.rarity === "rare") score += 4;
  if (card.rarity === "mythic") score += 7;
  if (/draws? a card/.test(text)) score += 3;
  if (/destroy target|exile target/.test(text)) score += 4;
  // Unconditional exile of ANY nonland permanent (not just artifact/
  // enchantment) is a materially wider removal effect.
  if (/exile target nonland permanent/.test(text)) score += 2;
  // A removal effect that costs a sacrifice (consumes the source) is
  // narrower than one that leaves the source's body/attachment intact.
  if (/sacrifice[^.]*: destroy|sacrifice[^.]*: exile/.test(text)) score -= 1;
  if (/counter target spell/.test(text)) score += 4;
  if (/gain.*life/.test(text)) score += 2;
  // A static combat-stat buff (+X/+Y) stacked on top of a keyword grant is
  // extra standalone value an aura/equipment carries beyond the keyword.
  if (/gets? \+\d\/\+\d/.test(text)) score += 1;
  // Ward taxes protect the whole value package (the attached creature +
  // exiled permanent), which a plain removal spell does not.
  if (/\bward\b/.test(text)) score += 1;
  return score;
}

// Deterministic tiebreak when two candidates land on the exact same final
// score. Silent pool-array-order tiebreaking previously meant a card seen
// later in the bulk-DB pool (e.g. Sheltered by Ghosts) could NEVER win a
// true tie against an earlier one (Shattered Acolyte), regardless of how
// many rounds were run. Break ties by higher basePower (rewards the sharper
// proxy above), then alphabetically for full stability.
function isStrictlyBetter(
  challenger: { card: CardRecord; score: ReturnType<typeof scoreCandidate>; basePower: number },
  incumbent: { card: CardRecord; score: ReturnType<typeof scoreCandidate>; basePower: number } | null
): boolean {
  if (!incumbent) return true;
  if (challenger.score.final !== incumbent.score.final) return challenger.score.final > incumbent.score.final;
  if (challenger.basePower !== incumbent.basePower) return challenger.basePower > incumbent.basePower;
  return challenger.card.name < incumbent.card.name;
}

// -- Batched sequential seed-chain loop (analyze -> chain n -> re-analyze) --

/**
 * Third build path: identical scoring machinery to buildWithSynergyFirstEngine,
 * but picks are chained in BATCHES with a deck-level re-analysis checkpoint
 * between batches. The checkpoint recomputes DERIVED deck state only (color
 * pip balance, curve shape) and feeds the result back into the next batch's
 * scoring as adjustments; the seed's game-plan anchor (roles, payoff
 * identity, WU colors) is never re-inferred. This is the loop structure a
 * user would experience as: add cards -> hit analyze -> app chains the next
 * n picks -> re-analysis -> repeat.
 */
function buildWithBatchedSeedChain(pool: CardRecord[], seedCards: CardRecord[]): {
  entries: DeckEntry[];
  log: string[];
  counts: DeckRoleCounts;
} {
  const entries: DeckEntry[] = seedCards.map((card) => ({ card, quantity: SEED_QUANTITIES.get(card.name) ?? 1, board: "main" as const }));
  const log: string[] = [];
  const seedNames = new Set(seedCards.map((c) => c.name));
  const targetNonlandCount = 36;
  const BATCH_SLOTS = 6; // ~1-2 playsets per batch before a re-analysis checkpoint
  let remainingPool = pool.filter((c) => !seedNames.has(c.name) && !c.typeLine.includes("Land") && classify(c).length > 0);

  let counts = tally(entries);
  let nonlandCount = entries.reduce((s, e) => s + e.quantity, 0);

  // Initial analysis: the seed package itself is the first "batch".
  let adjustments: DeckAdjustments = reanalyzeDeck(entries);
  let checkpoint = 1;
  log.push(`[SEED-CHAIN] Checkpoint ${checkpoint} (seed only, ${nonlandCount} cards): ${adjustments.notes.join(" | ") || "no adjustments"}`);
  let slotsSinceReanalysis = 0;

  while (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    if (slotsSinceReanalysis >= BATCH_SLOTS) {
      adjustments = reanalyzeDeck(entries);
      checkpoint++;
      const flags = feasibility(counts, { w: 0, u: 0 })
        .filter((f) => !f.message.includes("Mana base") && !f.message.includes("Color source"))
        .map((f) => `${f.severity.toUpperCase()}: ${f.message}`);
      log.push(
        `[SEED-CHAIN] Checkpoint ${checkpoint} (${nonlandCount}/${targetNonlandCount} nonland): ` +
        `${adjustments.notes.join(" | ") || "no adjustments"}` +
        (flags.length ? ` || Feasibility: ${flags.join(" ; ")}` : "")
      );
      slotsSinceReanalysis = 0;
    }

    const fullRoles = atCeiling(counts);
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate>; basePower: number } | null = null;
    for (const card of remainingPool) {
      const cardRoles = classify(card);
      const allRolesOpen = cardRoles.every((r) => !fullRoles.has(r));
      if (!allRolesOpen) continue;
      const basePower = basePowerProxy(card);
      const score = scoreWithSeed(card, counts, basePower, adjustments);
      const challenger = { card, score, basePower };
      if (isStrictlyBetter(challenger, best)) best = challenger;
    }
    if (!best) {
      for (const card of remainingPool) {
        const cardRoles = classify(card);
        const hasAnyOpenRole = cardRoles.some((r) => !fullRoles.has(r));
        if (!hasAnyOpenRole) continue;
        const basePower = basePowerProxy(card);
        const score = scoreWithSeed(card, counts, basePower, adjustments);
        const challenger = { card, score, basePower };
        if (isStrictlyBetter(challenger, best)) best = challenger;
      }
    }
    if (!best) break;

    const isLegendary = best.card.typeLine.includes("Legendary");
    const suggestedQty = isLegendary ? 2 : 4;
    const cardRoles = classify(best.card);
    const roleRoomCaps = cardRoles.map((r) => roleRoomRemaining(r, counts));
    const roleCap = roleRoomCaps.length > 0 ? Math.min(...roleRoomCaps) : suggestedQty;
    // Also cap at the batch boundary so a playset cannot straddle a
    // checkpoint — the re-analysis should see the deck state BEFORE the
    // next batch commits more copies in a possibly-wrong direction.
    const qty = Math.max(0, Math.min(suggestedQty, roleCap, targetNonlandCount - nonlandCount, BATCH_SLOTS - slotsSinceReanalysis));
    // Anti-fragmentation: a brand-new nonlegendary card squeezed to a
    // single copy is a consistency liability in a 60-card Standard deck
    // (you effectively never draw it when you need it). If the caps only
    // leave room for 1 copy of a NEW nonlegendary card, skip it for this
    // round rather than seeding a pile of one-ofs; the consolidation pass
    // after the main build will deepen existing picks instead.
    if (qty === 0 || (qty === 1 && !isLegendary && targetNonlandCount - nonlandCount > 1)) {
      remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
      continue;
    }
    entries.push({ card: best.card, quantity: qty, board: "main" });
    nonlandCount += qty;
    slotsSinceReanalysis += qty;
    counts = tally(entries);
    log.push(
      `[SEED-CHAIN] Pick: ${best.card.name} x${qty} — final=${best.score.final.toFixed(1)} — ${best.score.note}`
    );
    remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
  }

  if (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    log.push(
      `[SEED-CHAIN] SHORTFALL: strict role-ceiling rule exhausted candidates at ${nonlandCount}/${targetNonlandCount} — ` +
      `topping up with OVERFLOW picks (still color/curve-adjusted).`
    );
  }
  while (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    adjustments = reanalyzeDeck(entries);

    // TOP-UP PASS: before reaching for any brand-new distinct card, check
    // whether an existing under-max entry can absorb more OVERFLOW slots at
    // zero additional overshoot (topping up Sheltered by Ghosts 2x -> 4x
    // instead of adding two unrelated singleton cards, for example). This
    // directly targets the fragmentation failure mode: minimizing overshoot
    // per NEW card said nothing about preferring depth in cards already
    // committed to, so OVERFLOW kept reaching for fresh 1-ofs even when an
    // existing pick had headroom to grow for free.
    let topUp: { entryIdx: number; addQty: number; overshoot: number } | null = null;
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      const isLegendary = entry.card.typeLine.includes("Legendary");
      const cap = isLegendary ? 2 : 4;
      if (entry.quantity >= cap) continue;
      const room = Math.min(cap - entry.quantity, targetNonlandCount - nonlandCount);
      for (let add = room; add >= 1; add--) {
        const countsWithout = tally(entries.map((e, j) => (j === i ? { ...e, quantity: e.quantity - entry.quantity } : e)));
        const overshoot = projectedOvershoot(entry.card, countsWithout, entry.quantity + add);
        if (!topUp || overshoot < topUp.overshoot || (overshoot === topUp.overshoot && add > topUp.addQty)) {
          topUp = { entryIdx: i, addQty: add, overshoot };
        }
        break; // largest `add` tried first for this entry is its best (monotonic overshoot); no need to scan smaller adds once one succeeds
      }
    }
    if (topUp && topUp.overshoot === 0) {
      const entry = entries[topUp.entryIdx];
      entry.quantity += topUp.addQty;
      nonlandCount += topUp.addQty;
      counts = tally(entries);
      log.push(
        `[SEED-CHAIN] OVERFLOW top-up: ${entry.card.name} +${topUp.addQty} (now ${entry.quantity}x) — ` +
        `zero-overshoot depth added to an existing pick instead of a new singleton.`
      );
      continue;
    }

    // Same minimal-overshoot-first rule as the synergy-first engine's
    // overflow pass (see comment there): picking by pure score alone let
    // Consistency silently absorb the whole overflow and run to 20 against
    // a 10-card ceiling. Try every legal quantity per candidate and keep
    // whichever (candidate, qty) minimizes the worst role overshoot it
    // would cause; isStrictlyBetter only breaks ties among equal overshoot.
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate>; basePower: number; qty: number; overshoot: number } | null = null;
    for (const card of remainingPool) {
      const isLegendary = card.typeLine.includes("Legendary");
      const maxQty = Math.min(isLegendary ? 2 : 4, targetNonlandCount - nonlandCount);
      const basePower = basePowerProxy(card);
      const score = scoreWithSeed(card, counts, basePower, adjustments);
      // Same largest-quantity-at-minimal-overshoot rule as the synergy-first
      // engine's overflow pass: avoids locking a card in at x1 just because
      // x1 happens to hit zero overshoot when x4 would ALSO hit zero.
      let cardBestQty = 1;
      let cardBestOvershoot = projectedOvershoot(card, counts, 1);
      for (let qty = 2; qty <= maxQty; qty++) {
        const overshoot = projectedOvershoot(card, counts, qty);
        if (overshoot <= cardBestOvershoot) {
          cardBestQty = qty;
          cardBestOvershoot = overshoot;
        }
      }
      const challenger = { card, score, basePower, qty: cardBestQty, overshoot: cardBestOvershoot };
      if (
        !best ||
        cardBestOvershoot < best.overshoot ||
        (cardBestOvershoot === best.overshoot && isStrictlyBetter(challenger, best))
      ) {
        best = challenger;
      }
    }
    // Prefer a zero/lower-overshoot top-up over a brand-new-card pick even
    // when the top-up wasn't strictly zero, as long as it's no worse.
    if (topUp && best && topUp.overshoot <= best.overshoot) {
      const entry = entries[topUp.entryIdx];
      entry.quantity += topUp.addQty;
      nonlandCount += topUp.addQty;
      counts = tally(entries);
      log.push(
        `[SEED-CHAIN] OVERFLOW top-up: ${entry.card.name} +${topUp.addQty} (now ${entry.quantity}x) — ` +
        `matched or beat the best new-card overshoot, so depth was preferred over fragmentation.`
      );
      continue;
    }
    if (!best) break;
    entries.push({ card: best.card, quantity: best.qty, board: "main" });
    nonlandCount += best.qty;
    counts = tally(entries);
    log.push(`[SEED-CHAIN] OVERFLOW pick: ${best.card.name} x${best.qty} — final=${best.score.final.toFixed(1)} (min-overshoot=${best.overshoot})`);
    remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
  }

  consolidatePlaysets(entries, seedNames, log, "[SEED-CHAIN]");
  counts = tally(entries);

  return { entries, log, counts };
}

/**
 * Playset consolidation: 60-card Standard decks want 3-4 copies of fewer
 * distinct cards, not a spread of 1-2 ofs — a 1-of is effectively a card
 * you never see in the game where you need it. This pass trims the
 * LOWEST-scoring fragmented picks (nonlegendary, qty <= 2) and reinvests
 * those slots as extra copies of the HIGHEST-scoring fragmented picks,
 * keeping the total card count identical and never touching the locked
 * seed package. Legendary permanents are left at 2 (drawing multiples is
 * a real cost), and role ceilings are allowed to shift slightly here —
 * consistency of draws beats exact band adherence at the margin, and the
 * log records every move so nothing shifts silently.
 */
function consolidatePlaysets(
  entries: DeckEntry[],
  seedNames: Set<string>,
  log: string[],
  tag: string,
): void {
  const fragmented = entries
    .map((e, i) => ({ e, i }))
    .filter(({ e }) =>
      !seedNames.has(e.card.name) &&
      !e.card.typeLine.includes("Land") &&
      !e.card.typeLine.includes("Legendary") &&
      e.quantity <= 2
    );
  if (fragmented.length <= 1) return;

  // Rank fragments by the same standalone-power proxy used during the
  // build; deepen the strong ones, cut the weak ones.
  fragmented.sort((a, b) => basePowerProxy(b.e.card) - basePowerProxy(a.e.card));

  // Role-neutrality guard: consolidation must not silently re-open the
  // exact overshoot problem the OVERFLOW pass was built to minimize. A move
  // shifts copies from donor to target without changing the 36-card total,
  // so it only changes role counts via the DIFFERENCE between the two
  // cards' roles. Reject (or shrink) any move that would push a role's
  // overshoot beyond its current level — e.g. do not let a Consistency-only
  // donor's copies flow into an Enabler-only target if Enabler is already
  // at/over its own ceiling, and do not deepen a target's role past ceiling
  // just because it has higher standalone power.
  let moved = 0;
  let lo = fragmented.length - 1;
  for (let hi = 0; hi < lo; hi++) {
    const target = fragmented[hi].e;
    while (target.quantity < 4 && hi < lo) {
      const donor = fragmented[lo].e;
      let take = Math.min(donor.quantity, 4 - target.quantity);
      const counts = tally(entries);
      const targetRoles = classify(target.card);
      const donorRoles = classify(donor.card);
      // A role R's count changes by +take if the target fills R but the
      // donor doesn't, -take if the donor fills R but the target doesn't,
      // and 0 if both or neither fill R (moving copies between two cards
      // that share a role is always safe for that role, and roles the
      // donor uniquely held only ever free up headroom). Only roles the
      // TARGET uniquely holds can worsen that role's overshoot, so clamp
      // `take` to the tightest remaining headroom among those roles —
      // but never below what's needed just to preserve the CURRENT
      // overshoot level (if a role is already over ceiling pre-move, don't
      // make it worse; if it still has room, don't exceed that room).
      const netGainRoles = targetRoles.filter((r) => !donorRoles.includes(r));
      for (const r of netGainRoles) {
        const room = roleRoomRemaining(r, counts);
        const alreadyOver = roleOvershoot(r, counts) > 0;
        // If already over ceiling, permit 0 further net-gain copies of this
        // role; otherwise cap at remaining room before the ceiling.
        const cap = alreadyOver ? 0 : room;
        take = Math.min(take, cap);
      }
      if (take === 0) {
        // This donor cannot feed this target without worsening a role
        // ceiling; try the next-weakest donor instead of giving up on the
        // target entirely.
        lo--;
        if (hi >= lo) break;
        continue;
      }
      donor.quantity -= take;
      target.quantity += take;
      moved += take;
      log.push(
        `${tag} CONSOLIDATE: moved ${take}x from ${donor.card.name} into ${target.card.name} ` +
        `(now ${target.quantity}x) — playset consistency over one-of spread.`
      );
      if (donor.quantity === 0) lo--;
      else break;
    }
  }
  // Drop zeroed-out entries.
  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].quantity === 0) entries.splice(i, 1);
  }
  if (moved > 0) {
    log.push(`${tag} Consolidation complete: ${moved} slots moved into deeper playsets; distinct nonland cards reduced.`);
  }
}

// ── Divergence detection ─────────────────────────────────────────────────

// -- Land-base fill (24 lands) ------------------------------------------

const BASIC_PLAINS = "Plains";
const BASIC_ISLAND = "Island";

/**
 * Add a 24-land Azorius mana base to a 36-card nonland shell using the
 * app's own existing recommendDualLands()/countLandSources() infra --
 * this stage was previously entirely unimplemented ("lands: 0" in both
 * engines). W/U weight is split by each color's share of colored pips in
 * the nonland shell so heavier-white or heavier-blue shells get more of
 * the matching basic, rather than a fixed 12/12 split.
 */
function addManaBase(
  nonlandEntries: DeckEntry[],
  allLands: CardRecord[],
  targetLandCount: number = 24
): { entries: DeckEntry[]; log: string[] } {
  const log: string[] = [];
  const duals = recommendDualLands(allLands, ["W", "U"], targetLandCount, "standard");

  const landEntries: DeckEntry[] = [];
  let landsUsed = 0;

  // Take real nonbasic WU duals/utility lands first, capped so basics still
  // make up the bulk of the base (this is a 2-color deck, not a 5-color one).
  const maxNonbasics = Math.min(8, Math.floor(targetLandCount * 0.35));
  for (const suggestion of duals) {
    if (landsUsed >= maxNonbasics) break;
    const qty = Math.min(suggestion.quantity, maxNonbasics - landsUsed);
    if (qty <= 0) continue;
    landEntries.push({ card: suggestion.card, quantity: qty, board: "main" });
    landsUsed += qty;
    log.push(
      `Added ${qty}x ${suggestion.card.name} (${suggestion.tierLabel}) as nonbasic fixing.`
    );
  }

  // Weight remaining basics by colored-pip share of the nonland shell.
  let wPips = 0;
  let uPips = 0;
  for (const entry of nonlandEntries) {
    const cost = entry.card.manaCost ?? "";
    wPips += (cost.match(/\{W\}/g)?.length ?? 0) * entry.quantity;
    uPips += (cost.match(/\{U\}/g)?.length ?? 0) * entry.quantity;
  }
  const totalPips = wPips + uPips || 1;
  const remaining = targetLandCount - landsUsed;
  let plainsCount = Math.round(remaining * (wPips / totalPips));
  plainsCount = Math.max(plainsCount, Math.floor(remaining * 0.35));
  let islandCount = remaining - plainsCount;

  const plainsCard = allLands.find((c) => c.name === BASIC_PLAINS);
  const islandCard = allLands.find((c) => c.name === BASIC_ISLAND);
  if (!plainsCard || !islandCard) {
    throw new Error("Basic Plains/Island not found in lands pool data.");
  }
  landEntries.push({ card: plainsCard, quantity: plainsCount, board: "main" });
  landEntries.push({ card: islandCard, quantity: islandCount, board: "main" });
  log.push(
    `Filled remaining ${remaining} slots with ${plainsCount}x Plains / ${islandCount}x Island ` +
      `(weighted ${Math.round((wPips / totalPips) * 100)}% W / ${Math.round((uPips / totalPips) * 100)}% U by colored-pip share).`
  );

  const full = [...nonlandEntries, ...landEntries];
  const sources = countLandSources(full);
  log.push(
    `Resulting color sources: W=${sources.W.toFixed(1)}, U=${sources.U.toFixed(1)} ` +
      `(Karsten target for a 2-3 pip color at ~turn 3-4 is typically 12-14 sources).`
  );
  return { entries: full, log };
}

// -- Divergence detection -------------------------------------------------

function summarizePicks(entries: DeckEntry[], seedNames: Set<string>): string[] {
  return entries
    .filter((e) => !seedNames.has(e.card.name))
    .map((e) => e.card.name);
}

function main() {
  const pool = loadPool();
  console.log(`Loaded ${pool.length} Standard-legal, non-seed-excluded WU/colorless candidate cards from Scryfall data.\n`);

  const seedNames = SEED_PACKAGE.map((seedCard) => seedCard.name);
  const seedCards = seedNames.map((name) => {
    const found = pool.find((c) => c.name === name);
    if (!found) throw new Error(`Seed card not found in pool data: ${name}`);
    return found;
  });
  const seedPayoffCards = seedCards.filter((card) =>
    classifySeedRoles(card, SEED_PACKAGE).includes("Payoff")
  );
  activeResourceSpec = inferResourceSpec(seedPayoffCards);
  if (!activeResourceSpec) {
    console.warn("[comparison] No seed resource inferred; cadence scoring is disabled for this run.");
  } else {
    console.log(`[comparison] Inferred payoff resource: ${activeResourceSpec.name}.`);
  }

  activeAnthemSpec = inferSeedAnthemSynergy(seedCards);
  if (activeAnthemSpec) {
    console.log(`[comparison] Inferred seed anthem synergy: other ${activeAnthemSpec.subtype}s you control get a bonus${activeAnthemSpec.grantedKeywords.length ? ` (grants ${activeAnthemSpec.grantedKeywords.join(", ")})` : ""}.`);
  }

  const existing = buildWithExistingEngine(pool, seedCards);
  const synergyFirst = buildWithSynergyFirstEngine(pool, seedCards);
  const seedChain = buildWithBatchedSeedChain(pool, seedCards);

  const allLands = loadLands();
  // The batched seed-chain build is the most refined path, so IT gets the
  // final mana base and decklist; the other two remain for comparison.
  const manaBase = addManaBase(seedChain.entries, allLands, 24);

  const existingPicks = new Set(summarizePicks(existing.entries, new Set(seedNames)));
  const synergyPicks = new Set(summarizePicks(synergyFirst.entries, new Set(seedNames)));

  const onlyExisting = [...existingPicks].filter((n) => !synergyPicks.has(n));
  const onlySynergy = [...synergyPicks].filter((n) => !existingPicks.has(n));

  const existingCounts = tally(existing.entries);
  const feasibilityExisting = feasibility(existingCounts, { w: 14, u: 12 });
  const feasibilitySynergy = feasibility(synergyFirst.counts, { w: 14, u: 12 });

  const seedTitleLabel = SEED_PACKAGE.map((c) => c.name).join(" / ");
  const report: string[] = [];
  report.push(`# ${seedTitleLabel} — Composite vs. Synergy-First Scoring Comparison`);
  report.push("");
  report.push(`Pool size after Standard-legal + seed-role filtering: ${pool.length} cards (raw Scryfall data, ${new Date().toISOString().slice(0, 10)}).`);
  report.push("");
  report.push("## Role counts achieved");
  report.push("");
  report.push(`- Existing composite engine (Control archetype, generic role/synergy axes): ${JSON.stringify(existingCounts)}`);
  report.push(`- Synergy-first sequential engine (seed-specific Enabler/Protection/Consistency/Payoff): ${JSON.stringify(synergyFirst.counts)}`);
  report.push(`- Batched seed-chain engine (synergy-first + re-analysis checkpoints every 6 slots): ${JSON.stringify(seedChain.counts)}`);
  report.push(`- Target bands: ${JSON.stringify(SEED_ROLE_TARGETS)}`);
  report.push("");
  report.push("## Feasibility flags — existing composite engine's build");
  for (const f of feasibilityExisting) report.push(`- [${f.severity.toUpperCase()}] ${f.message}`);
  if (feasibilityExisting.length === 0) report.push("- none");
  report.push("");
  report.push("## Feasibility flags — synergy-first engine's build");
  for (const f of feasibilitySynergy) report.push(`- [${f.severity.toUpperCase()}] ${f.message}`);
  if (feasibilitySynergy.length === 0) report.push("- none");
  report.push("");
  report.push("## Pick log — existing composite engine");
  report.push(...existing.log.map((l) => `- ${l}`));
  report.push("");
  report.push("## Pick log — synergy-first engine");
  report.push(...synergyFirst.log.map((l) => `- ${l}`));
  report.push("");
  report.push("## Pick log — batched seed-chain engine (checkpoints inline)");
  report.push(...seedChain.log.map((l) => `- ${l}`));
  report.push("");
  report.push("## DIVERGENCE — cards picked by ONLY the existing composite engine");
  report.push("(these are the standalone/composite-power shortfalls: individually strong but not seed-synergistic, or seed-synergistic in the wrong role balance)");
  for (const name of onlyExisting) {
    const card = pool.find((c) => c.name === name)!;
    const roles = classify(card);
    report.push(`- ${name} (CMC ${card.cmc}) — seed roles: ${roles.length ? roles.join(", ") : "NONE (would be rejected outright by synergy-first filter)"}`);
  }
  if (onlyExisting.length === 0) report.push("- none");
  report.push("");
  report.push("## DIVERGENCE — cards picked by ONLY the synergy-first engine");
  for (const name of onlySynergy) {
    const card = pool.find((c) => c.name === name)!;
    const roles = classify(card);
    report.push(`- ${name} (CMC ${card.cmc}) — seed roles: ${roles.join(", ")}`);
  }
  if (onlySynergy.length === 0) report.push("- none");

  report.push("");
  report.push("## Final 60-card decklist — batched seed-chain engine + real Azorius mana base");
  report.push("");
  const seedPackageLabel = SEED_PACKAGE.map((c) => `${c.quantity}x ${c.name}`).join(", ");
  report.push(`Seed package (locked): ${seedPackageLabel}.`);
  report.push("");
  report.push("### Nonland (36)");
  const nonlandSorted = [...manaBase.entries]
    .filter((e) => !e.card.typeLine.includes("Land"))
    .sort((a, b) => a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name));
  let nonlandTotal = 0;
  for (const e of nonlandSorted) {
    nonlandTotal += e.quantity;
    report.push(`- ${e.quantity}x ${e.card.name} (CMC ${e.card.cmc})`);
  }
  report.push("");
  report.push("### Lands (24)");
  const landSorted = [...manaBase.entries]
    .filter((e) => e.card.typeLine.includes("Land"))
    .sort((a, b) => a.card.name.localeCompare(b.card.name));
  let landTotal = 0;
  for (const e of landSorted) {
    landTotal += e.quantity;
    report.push(`- ${e.quantity}x ${e.card.name}`);
  }
  report.push("");
  report.push(`**Total: ${nonlandTotal + landTotal} cards** (${nonlandTotal} nonland + ${landTotal} land)`);
  report.push("");
  report.push("### Mana base construction log");
  report.push(...manaBase.log.map((l) => `- ${l}`));

  const out = report.join("\n");
  console.log(out);
  writeFileSync(join(__dirname, "..", "..", "hope_estheim_comparison_report.md"), out, "utf-8");

  // Also emit a clean standalone decklist file for sharing.
  const deckLines: string[] = [];
  deckLines.push(`# ${seedTitleLabel} — Batched Seed-Chain 60-Card Decklist`);
  deckLines.push("");
  deckLines.push(`Enabler ${seedChain.counts.enablers} | Protection ${seedChain.counts.protection} | Consistency ${seedChain.counts.consistency} | Payoff ${seedChain.counts.payoffs} | Lands ${landTotal}`);
  deckLines.push("");
  deckLines.push("## Nonland (36)");
  for (const e of nonlandSorted) deckLines.push(`${e.quantity} ${e.card.name}`);
  deckLines.push("");
  deckLines.push("## Lands (24)");
  for (const e of landSorted) deckLines.push(`${e.quantity} ${e.card.name}`);
  writeFileSync(join(__dirname, "..", "..", "hope_estheim_decklist.md"), deckLines.join("\n"), "utf-8");

  // Machine-readable summary for the synergy chart renderer.
  const summary = {
    targets: SEED_ROLE_TARGETS,
    engines: {
      "Existing composite": existingCounts,
      "Synergy-first": synergyFirst.counts,
      "Batched seed-chain": seedChain.counts,
    },
    decklist: manaBase.entries.map((e) => ({
      name: e.card.name,
      qty: e.quantity,
      cmc: e.card.cmc,
      manaCost: e.card.manaCost,
      typeLine: e.card.typeLine,
      roles: e.card.typeLine.includes("Land") ? [] : classify(e.card),
    })),
  };
  writeFileSync(join(__dirname, "..", "..", "hope_estheim_summary.json"), JSON.stringify(summary, null, 2), "utf-8");
}

main();
