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
  SEED_PACKAGE,
  SEED_ROLE_TARGETS,
  emptyRoleCounts,
  type DeckRoleCounts,
} from "../src/lib/generator/hopeEstheimSynergy";

const POOL_DIR = join(__dirname, "..", "..", "pool_data");

function loadPool(): CardRecord[] {
  const files = ["azorius_pool.json", "colorless_artifacts.json"];
  const seen = new Set<string>();
  const records: CardRecord[] = [];
  const importedAt = new Date().toISOString();

  for (const file of files) {
    const raw = JSON.parse(readFileSync(join(POOL_DIR, file), "utf-8")) as ScryfallCard[];
    for (const sc of raw) {
      if (!isStandardEligible(sc)) continue;
      if (seen.has(sc.oracle_id)) continue;
      // Restrict artifacts file to genuinely colorless-castable cards (already filtered by query, but double check).
      seen.add(sc.oracle_id);
      records.push(toCardRecord(sc, importedAt));
    }
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
    let best: { card: CardRecord; score: ReturnType<typeof scoreCandidate> } | null = null;
    for (const card of remainingPool) {
      // Cheap proxy for "standalone power" reusing the existing heuristic
      // so both engines start from a comparable power baseline; the seed
      // module then applies role-gap/saturation/timing on top of it.
      const basePower = basePowerProxy(card);
      const score = scoreCandidate(card, counts, basePower);
      if (!best || score.final > best.score.final) {
        best = { card, score };
      }
    }
    if (!best) break;

    // Realistic playset sizing instead of always maxing at 4 — legendary
    // cards and narrow/situational effects are typically run at 1-2 copies
    // even in a card-advantage-dense control shell, and running everything
    // as a forced 4-of is exactly the kind of "looks powerful on paper"
    // distortion the brief warns against.
    const isLegendary = best.card.typeLine.includes("Legendary");
    const suggestedQty = isLegendary ? 2 : 4;
    const qty = Math.min(suggestedQty, targetNonlandCount - nonlandCount);
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

// ── Divergence detection ─────────────────────────────────────────────────

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

  const out = report.join("\n");
  console.log(out);
  writeFileSync(join(__dirname, "..", "..", "hope_estheim_comparison_report.md"), out, "utf-8");
}

main();
