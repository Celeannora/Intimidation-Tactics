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
 *   2. SYNERGY-FIRST ENGINE — hopeEstheimSynergy.ts::scoreCandidate,
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
  SEED_PACKAGE,
  SEED_ROLE_TARGETS,
  type DeckAdjustments,
  type DeckRoleCounts,
  type SeedRole,
} from "../src/lib/generator/hopeEstheimSynergy";
import { recommendDualLands } from "../src/lib/manaBase";
import { countLandSources } from "../src/lib/landSources";

const POOL_DIR = join(__dirname, "..", "..", "pool_data");

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
  const entries: DeckEntry[] = seedCards.map((card) => ({ card, quantity: SEED_PACKAGE[card.name] ?? 1, board: "main" as const }));
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

function buildWithSynergyFirstEngine(pool: CardRecord[], seedCards: CardRecord[]): {
  entries: DeckEntry[];
  log: string[];
  counts: DeckRoleCounts;
} {
  const entries: DeckEntry[] = seedCards.map((card) => ({ card, quantity: SEED_PACKAGE[card.name] ?? 1, board: "main" as const }));
  const log: string[] = [];
  const seedNames = new Set(seedCards.map((c) => c.name));
  const targetNonlandCount = 36;
  let remainingPool = pool.filter((c) => !seedNames.has(c.name) && !c.typeLine.includes("Land") && classifySeedRoles(c).length > 0);

  let counts = tallyRoleCounts(entries);
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
    const fullRoles = rolesAtCeiling(counts);
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate> } | null = null;
    for (const card of remainingPool) {
      const cardRoles = classifySeedRoles(card);
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
      const score = scoreCandidate(card, counts, basePower);
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
        const cardRoles = classifySeedRoles(card);
        const hasAnyOpenRole = cardRoles.some((r) => !fullRoles.has(r));
        if (!hasAnyOpenRole) continue;
        const basePower = basePowerProxy(card);
        const score = scoreCandidate(card, counts, basePower);
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
    const cardRoles = classifySeedRoles(best.card);
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
    counts = tallyRoleCounts(entries);
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
      `${nonlandCount}/${targetNonlandCount} nonland cards (roles at ceiling: ${[...rolesAtCeiling(counts)].join(", ")}). ` +
      `Topping up remaining ${targetNonlandCount - nonlandCount} slots with best-scoring cards regardless of ceiling — see OVERFLOW picks below.`
    );
  }
  while (nonlandCount < targetNonlandCount && remainingPool.length > 0) {
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate> } | null = null;
    for (const card of remainingPool) {
      const basePower = basePowerProxy(card);
      const score = scoreCandidate(card, counts, basePower);
      if (!best || score.final > best.score.final) best = { card, score };
    }
    if (!best) break;
    const isLegendary = best.card.typeLine.includes("Legendary");
    const qty = Math.min(isLegendary ? 2 : 4, targetNonlandCount - nonlandCount);
    entries.push({ card: best.card, quantity: qty, board: "main" });
    nonlandCount += qty;
    counts = tallyRoleCounts(entries);
    log.push(
      `[SYNERGY-FIRST] OVERFLOW pick: ${best.card.name} x${qty} — final=${best.score.final.toFixed(1)} ` +
      `— added past ceiling to reach the 36-card nonland target; role counts after: ${JSON.stringify(counts)}`
    );
    remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
  }

  return { entries, log, counts };
}

function basePowerProxy(card: CardRecord): number {
  // Lightweight standalone-power proxy independent of the shared engine's
  // Control-archetype role multiplier, so this isn't just re-deriving the
  // same number under a different name.
  let score = 5;
  const text = (card.oracleText ?? "").toLowerCase();
  if (card.rarity === "rare") score += 4;
  if (card.rarity === "mythic") score += 7;
  if (/draws? a card/.test(text)) score += 3;
  if (/destroy target|exile target/.test(text)) score += 4;
  if (/counter target spell/.test(text)) score += 4;
  if (/gain.*life/.test(text)) score += 2;
  return score;
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
  const entries: DeckEntry[] = seedCards.map((card) => ({ card, quantity: SEED_PACKAGE[card.name] ?? 1, board: "main" as const }));
  const log: string[] = [];
  const seedNames = new Set(seedCards.map((c) => c.name));
  const targetNonlandCount = 36;
  const BATCH_SLOTS = 6; // ~1-2 playsets per batch before a re-analysis checkpoint
  let remainingPool = pool.filter((c) => !seedNames.has(c.name) && !c.typeLine.includes("Land") && classifySeedRoles(c).length > 0);

  let counts = tallyRoleCounts(entries);
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
      const flags = checkFeasibility(counts, { w: 0, u: 0 })
        .filter((f) => !f.message.includes("Mana base") && !f.message.includes("Color source"))
        .map((f) => `${f.severity.toUpperCase()}: ${f.message}`);
      log.push(
        `[SEED-CHAIN] Checkpoint ${checkpoint} (${nonlandCount}/${targetNonlandCount} nonland): ` +
        `${adjustments.notes.join(" | ") || "no adjustments"}` +
        (flags.length ? ` || Feasibility: ${flags.join(" ; ")}` : "")
      );
      slotsSinceReanalysis = 0;
    }

    const fullRoles = rolesAtCeiling(counts);
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate> } | null = null;
    for (const card of remainingPool) {
      const cardRoles = classifySeedRoles(card);
      const allRolesOpen = cardRoles.every((r) => !fullRoles.has(r));
      if (!allRolesOpen) continue;
      const basePower = basePowerProxy(card);
      const score = scoreCandidate(card, counts, basePower, adjustments);
      if (!best || score.final > best.score.final) best = { card, score };
    }
    if (!best) {
      for (const card of remainingPool) {
        const cardRoles = classifySeedRoles(card);
        const hasAnyOpenRole = cardRoles.some((r) => !fullRoles.has(r));
        if (!hasAnyOpenRole) continue;
        const basePower = basePowerProxy(card);
        const score = scoreCandidate(card, counts, basePower, adjustments);
        if (!best || score.final > best.score.final) best = { card, score };
      }
    }
    if (!best) break;

    const isLegendary = best.card.typeLine.includes("Legendary");
    const suggestedQty = isLegendary ? 2 : 4;
    const cardRoles = classifySeedRoles(best.card);
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
    counts = tallyRoleCounts(entries);
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
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate> } | null = null;
    for (const card of remainingPool) {
      const basePower = basePowerProxy(card);
      const score = scoreCandidate(card, counts, basePower, adjustments);
      if (!best || score.final > best.score.final) best = { card, score };
    }
    if (!best) break;
    const isLegendary = best.card.typeLine.includes("Legendary");
    const qty = Math.min(isLegendary ? 2 : 4, targetNonlandCount - nonlandCount);
    entries.push({ card: best.card, quantity: qty, board: "main" });
    nonlandCount += qty;
    counts = tallyRoleCounts(entries);
    log.push(`[SEED-CHAIN] OVERFLOW pick: ${best.card.name} x${qty} — final=${best.score.final.toFixed(1)}`);
    remainingPool = remainingPool.filter((c) => c.name !== best!.card.name);
  }

  consolidatePlaysets(entries, seedNames, log, "[SEED-CHAIN]");
  counts = tallyRoleCounts(entries);

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

  let moved = 0;
  let lo = fragmented.length - 1;
  for (let hi = 0; hi < lo; hi++) {
    const target = fragmented[hi].e;
    while (target.quantity < 4 && hi < lo) {
      const donor = fragmented[lo].e;
      const take = Math.min(donor.quantity, 4 - target.quantity);
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

  const seedNames = ["Hope Estheim", "Authority of the Consuls", "Space-Time Anomaly"];
  const seedCards = seedNames.map((name) => {
    const found = pool.find((c) => c.name === name);
    if (!found) throw new Error(`Seed card not found in pool data: ${name}`);
    return found;
  });

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

  const existingCounts = tallyRoleCounts(existing.entries);
  const feasibilityExisting = checkFeasibility(existingCounts, { w: 14, u: 12 });
  const feasibilitySynergy = checkFeasibility(synergyFirst.counts, { w: 14, u: 12 });

  const report: string[] = [];
  report.push("# Hope Estheim / Space-Time Anomaly — Composite vs. Synergy-First Scoring Comparison");
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
    const roles = classifySeedRoles(card);
    report.push(`- ${name} (CMC ${card.cmc}) — seed roles: ${roles.length ? roles.join(", ") : "NONE (would be rejected outright by synergy-first filter)"}`);
  }
  if (onlyExisting.length === 0) report.push("- none");
  report.push("");
  report.push("## DIVERGENCE — cards picked by ONLY the synergy-first engine");
  for (const name of onlySynergy) {
    const card = pool.find((c) => c.name === name)!;
    const roles = classifySeedRoles(card);
    report.push(`- ${name} (CMC ${card.cmc}) — seed roles: ${roles.join(", ")}`);
  }
  if (onlySynergy.length === 0) report.push("- none");

  report.push("");
  report.push("## Final 60-card decklist — batched seed-chain engine + real Azorius mana base");
  report.push("");
  report.push("Seed package (locked): 4x Hope Estheim, 4x Authority of the Consuls, 4x Space-Time Anomaly.");
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
  deckLines.push("# Hope Estheim / Space-Time Anomaly — Batched Seed-Chain 60-Card Decklist");
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
      roles: e.card.typeLine.includes("Land") ? [] : classifySeedRoles(e.card),
    })),
  };
  writeFileSync(join(__dirname, "..", "..", "hope_estheim_summary.json"), JSON.stringify(summary, null, 2), "utf-8");
}

main();
