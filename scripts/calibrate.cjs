#!/usr/bin/env node
/**
 * scripts/calibrate.cjs
 *
 * Calibration harness for the mythicViability scoring pipeline.
 *
 * Loads known-tier decks from scripts/known_decks.json, runs them through a
 * JS-faithful replica of the three-pillar scoring system defined in
 * src/lib/mythicViability.ts, and reports whether tier-1 decks hit the ≥65
 * composite target.  Weight adjustment suggestions are printed when the mean
 * falls short.
 *
 * Usage:
 *   node scripts/calibrate.cjs
 *   node scripts/calibrate.cjs --verbose          # per-pillar breakdown
 *   node scripts/calibrate.cjs --target 65        # override tier-1 target
 */

"use strict";

const fs   = require("fs");
const path = require("path");

// ─────────────────────────────────────────────────────────────────────────────
// CLI flags
// ─────────────────────────────────────────────────────────────────────────────
const args       = process.argv.slice(2);
const VERBOSE    = args.includes("--verbose") || args.includes("-v");
const targetIdx  = args.indexOf("--target");
const TIER1_TARGET = targetIdx !== -1 ? Number(args[targetIdx + 1]) : 65;

// ─────────────────────────────────────────────────────────────────────────────
// Current scoring weights (must mirror src/lib/mythicViability.ts)
// ─────────────────────────────────────────────────────────────────────────────
const WEIGHTS = {
  CONSISTENCY  : 0.45,
  REDUNDANCY   : 0.30,
  META         : 0.25,
};

// ─────────────────────────────────────────────────────────────────────────────
// Archetype meta-viability base scores (mirrors ARCHETYPE_META_VIABILITY)
// ─────────────────────────────────────────────────────────────────────────────
const ARCHETYPE_META_VIABILITY = {
  Midrange : 80,
  Aggro    : 75,
  Tempo    : 70,
  Control  : 65,
  Combo    : 60,
  Ramp     : 55,
  Prison   : 45,
  Unknown  : 40,
};

// ─────────────────────────────────────────────────────────────────────────────
// Archetype role benchmarks (mirrors ARCHETYPE_BENCHMARKS from archetype.ts)
// ─────────────────────────────────────────────────────────────────────────────
const ARCHETYPE_BENCHMARKS = {
  Midrange : { threats: 14, removal: 8,  boardWipes: 1, counterspells: 1, cardDraw: 4,  ramp: 1,  lands: 24 },
  Aggro    : { threats: 22, removal: 4,  boardWipes: 0, counterspells: 0, cardDraw: 2,  ramp: 0,  lands: 20 },
  Tempo    : { threats: 12, removal: 8,  boardWipes: 0, counterspells: 4, cardDraw: 8,  ramp: 0,  lands: 22 },
  Control  : { threats: 6,  removal: 10, boardWipes: 4, counterspells: 8, cardDraw: 8,  ramp: 2,  lands: 26 },
  Combo    : { threats: 8,  removal: 4,  boardWipes: 0, counterspells: 4, cardDraw: 12, ramp: 4,  lands: 22 },
  Ramp     : { threats: 10, removal: 4,  boardWipes: 2, counterspells: 0, cardDraw: 4,  ramp: 10, lands: 26 },
  Prison   : { threats: 6,  removal: 6,  boardWipes: 4, counterspells: 4, cardDraw: 4,  ramp: 4,  lands: 26 },
  Unknown  : null,
};

// ─────────────────────────────────────────────────────────────────────────────
// Pillar 1 — Consistency
// Mirrors computeConsistencyPillar() in mythicViability.ts
// ─────────────────────────────────────────────────────────────────────────────
function computeConsistencyPillar(entries) {
  const deckSize = entries.reduce((s, e) => s + e.quantity, 0);
  if (deckSize === 0) return 0;

  const isLand    = (e) => e.card.typeLine.includes("Land");
  const landCount = entries.filter(isLand).reduce((s, e) => s + e.quantity, 0);
  const nonlands  = entries.filter((e) => !isLand(e));
  const nonlandQty = nonlands.reduce((s, e) => s + e.quantity, 0);

  // 1a. Land ratio score
  const landRatio = landCount / deckSize;
  const landScore =
    landRatio >= 0.36 && landRatio <= 0.45 ? 100 :
    landRatio >= 0.30 && landRatio <= 0.50 ? 70  : 40;

  // 1b. Curve score
  const avgCmc = nonlandQty > 0
    ? nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / nonlandQty
    : 0;

  const curveScore =
    avgCmc >= 1.5 && avgCmc <= 3.5 ? 100 :
    avgCmc > 3.5  && avgCmc <= 4.5 ? Math.max(30, 100 - (avgCmc - 3.5) * 40) :
    avgCmc < 1.5  ? 80 : 20;

  // 1c. 4-of density
  const fourOfCount = entries.filter(
    (e) => !isLand(e) && e.quantity >= 4
  ).length;
  const densityScore = Math.min(100, fourOfCount * 20);

  const raw = landScore * 0.4 + curveScore * 0.35 + densityScore * 0.25;
  return Math.round(Math.min(100, Math.max(0, raw)));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pillar 2 — Redundancy  (uses pre-computed roles from the fixture)
// Mirrors computeRedundancyPillar() in mythicViability.ts
// ─────────────────────────────────────────────────────────────────────────────
function computeRedundancyPillar(roles) {
  const coreRoles = ["threats", "removal", "cardDraw"];
  let filledCoreRoles = 0;
  for (const role of coreRoles) {
    if ((roles[role] ?? 0) >= 3) filledCoreRoles++;
  }
  const coreCoverage = (filledCoreRoles / coreRoles.length) * 60;

  const allRoleValues = Object.values(roles).filter((v) => typeof v === "number");
  const deepCoverage  = allRoleValues.filter((c) => c >= 6).length;
  const depthBonus    = Math.min(40, deepCoverage * 10);

  return Math.round(Math.min(100, coreCoverage + depthBonus));
}

// ─────────────────────────────────────────────────────────────────────────────
// Pillar 3 — Meta Positioning  (uses pre-computed roles from the fixture)
// Mirrors computeMetaPositioningPillar() in mythicViability.ts
// ─────────────────────────────────────────────────────────────────────────────
function computeMetaPositioningPillar(roles, archetype) {
  const metaBase = ARCHETYPE_META_VIABILITY[archetype] ?? 40;
  const bench    = ARCHETYPE_BENCHMARKS[archetype];

  if (!bench || archetype === "Unknown") return Math.round(metaBase * 0.8);

  const keys = ["threats", "removal", "boardWipes", "counterspells", "cardDraw", "ramp", "lands"];
  let fitScore  = 0;
  let scoredKeys = 0;

  for (const k of keys) {
    const target = bench[k] ?? 0;
    if (target === 0) continue;
    scoredKeys++;
    const actual = roles[k] ?? 0;
    const ratio  = actual / target;
    fitScore += ratio >= 0.8 && ratio <= 1.3 ? 2 : ratio >= 0.6 && ratio <= 1.6 ? 1 : 0;
  }

  const profileFitPct = scoredKeys > 0 ? (fitScore / (scoredKeys * 2)) * 100 : 50;
  return Math.round(metaBase * 0.5 + profileFitPct * 0.5);
}

// ─────────────────────────────────────────────────────────────────────────────
// Win-rate proxy  (mirrors winRateProxy() in mythicViability.ts)
// ─────────────────────────────────────────────────────────────────────────────
function winRateProxy(score) {
  const base  = 0.42;
  const slope = 0.002;
  return Math.round((base + score * slope) * 1000) / 10;
}

// ─────────────────────────────────────────────────────────────────────────────
// Compute composite score for one deck fixture entry
// ─────────────────────────────────────────────────────────────────────────────
function scoreDeck(deck) {
  const consistency     = computeConsistencyPillar(deck.entries);
  const redundancy      = computeRedundancyPillar(deck.roles);
  const metaPositioning = computeMetaPositioningPillar(deck.roles, deck.archetype);

  const composite = Math.round(
    consistency     * WEIGHTS.CONSISTENCY +
    redundancy      * WEIGHTS.REDUNDANCY  +
    metaPositioning * WEIGHTS.META,
  );

  return { consistency, redundancy, metaPositioning, composite };
}

// ─────────────────────────────────────────────────────────────────────────────
// Weight suggestion engine
//
// Computes Pearson correlation between each pillar's values and the tier labels
// across all decks, then suggests bumping the weight for the highest-correlating
// pillar if the tier-1 mean falls below target.
// ─────────────────────────────────────────────────────────────────────────────
function pearson(xs, ys) {
  const n   = xs.length;
  const mx  = xs.reduce((a, b) => a + b, 0) / n;
  const my  = ys.reduce((a, b) => a + b, 0) / n;
  const num = xs.reduce((acc, x, i) => acc + (x - mx) * (ys[i] - my), 0);
  const den = Math.sqrt(
    xs.reduce((acc, x) => acc + (x - mx) ** 2, 0) *
    ys.reduce((acc, y) => acc + (y - my) ** 2, 0),
  );
  return den === 0 ? 0 : num / den;
}

function suggestWeights(results, tier1Mean) {
  if (tier1Mean >= TIER1_TARGET) {
    console.log("\n✅  Tier-1 mean already meets target — no weight changes needed.");
    return;
  }

  const shortfall = TIER1_TARGET - tier1Mean;
  console.log(`\n⚠️  Mean ${tier1Mean.toFixed(1)} is ${shortfall.toFixed(1)} points below target (${TIER1_TARGET}).`);

  // Tier labels: tier-1 → 2, tier-2 → 1, tier-3 → 0
  const tierValues = results.map((r) =>
    r.tier === 1 ? 2 : r.tier === 2 ? 1 : 0,
  );

  const correls = {
    CONSISTENCY : pearson(results.map((r) => r.consistency),     tierValues),
    REDUNDANCY  : pearson(results.map((r) => r.redundancy),      tierValues),
    META        : pearson(results.map((r) => r.metaPositioning), tierValues),
  };

  console.log("\n📊  Pillar ↔ tier-label correlations:");
  for (const [k, v] of Object.entries(correls)) {
    const bar = "█".repeat(Math.round(Math.abs(v) * 20));
    console.log(`   ${k.padEnd(15)} r = ${v.toFixed(3)}  ${bar}`);
  }

  // Find highest correlating pillar
  const best = Object.entries(correls)
    .sort((a, b) => b[1] - a[1])[0][0];

  // Suggest shifting +0.05 from the lowest-correlating pillar to the highest
  const worst = Object.entries(correls)
    .sort((a, b) => a[1] - b[1])[0][0];

  const STEP = 0.05;
  const suggested = { ...WEIGHTS };
  // Guard against going below 0.10 on any pillar
  if (WEIGHTS[worst] - STEP >= 0.10) {
    suggested[worst] -= STEP;
    suggested[best]  += STEP;
  } else {
    console.log(`\n⚠️  Cannot reduce ${worst} below 0.10 — manual review required.`);
    return;
  }

  console.log(`\n💡  Suggested weight adjustment (shift +${STEP} from ${worst} → ${best}):`);
  console.log(`   Current:    CONSISTENCY=${WEIGHTS.CONSISTENCY.toFixed(2)}  REDUNDANCY=${WEIGHTS.REDUNDANCY.toFixed(2)}  META=${WEIGHTS.META.toFixed(2)}`);
  console.log(`   Suggested:  CONSISTENCY=${suggested.CONSISTENCY.toFixed(2)}  REDUNDANCY=${suggested.REDUNDANCY.toFixed(2)}  META=${suggested.META.toFixed(2)}`);
  console.log(`\n   Edit WEIGHTS in src/lib/mythicViability.ts:`);
  console.log(`     consistency * ${suggested.CONSISTENCY.toFixed(2)} + redundancy * ${suggested.REDUNDANCY.toFixed(2)} + metaPositioning * ${suggested.META.toFixed(2)}`);

  // Estimate new mean with suggested weights
  const newMeans = {
    tier1: 0,
    n: 0,
  };
  for (const r of results) {
    if (r.tier !== 1) continue;
    const newScore = Math.round(
      r.consistency     * suggested.CONSISTENCY +
      r.redundancy      * suggested.REDUNDANCY  +
      r.metaPositioning * suggested.META,
    );
    newMeans.tier1 += newScore;
    newMeans.n++;
  }
  if (newMeans.n > 0) {
    const projectedMean = newMeans.tier1 / newMeans.n;
    console.log(`\n   Projected tier-1 mean with suggested weights: ${projectedMean.toFixed(1)}`);
    if (projectedMean >= TIER1_TARGET) {
      console.log(`   ✅  Would meet the ≥${TIER1_TARGET} target.`);
    } else {
      console.log(`   ⚠️  Still below target — consider additional manual tuning.`);
    }
  }
}

// ─────────────────────────────────────────────────────────────────────────────
// Main
// ─────────────────────────────────────────────────────────────────────────────
function main() {
  const fixturePath = path.join(__dirname, "known_decks.json");
  if (!fs.existsSync(fixturePath)) {
    console.error(`❌  Fixture not found: ${fixturePath}`);
    process.exit(1);
  }

  const decks = JSON.parse(fs.readFileSync(fixturePath, "utf8"));
  console.log(`\n🃏  Intimidation Tactics — Mythic Viability Calibrator`);
  console.log(`   Fixture: ${fixturePath}  (${decks.length} decks)`);
  console.log(`   Weights: CONSISTENCY=${WEIGHTS.CONSISTENCY}  REDUNDANCY=${WEIGHTS.REDUNDANCY}  META=${WEIGHTS.META}`);
  console.log(`   Tier-1 target: ≥${TIER1_TARGET}\n`);

  console.log(
    "  " +
    "Deck".padEnd(32) +
    "Tier".padEnd(6) +
    "Arch".padEnd(12) +
    "Con".padEnd(6) +
    "Red".padEnd(6) +
    "Meta".padEnd(6) +
    "Score".padEnd(7) +
    "WR%".padEnd(7) +
    "Label"
  );
  console.log("  " + "─".repeat(94));

  const results = [];

  for (const deck of decks) {
    const { consistency, redundancy, metaPositioning, composite } = scoreDeck(deck);
    const wr    = winRateProxy(composite);
    const label =
      composite >= 70 ? "tier-1"        :
      composite >= 55 ? "mythic-viable" :
      composite >= 35 ? "fringe"        :
                        "not-viable";

    const tierMark = deck.tier === 1 ? "T1" : deck.tier === 2 ? "T2" : "T3";
    const row = [
      "  " + deck.label.padEnd(32),
      tierMark.padEnd(6),
      deck.archetype.padEnd(12),
      String(consistency).padEnd(6),
      String(redundancy).padEnd(6),
      String(metaPositioning).padEnd(6),
      String(composite).padEnd(7),
      String(wr).padEnd(7),
      label,
    ].join("");
    console.log(row);

    results.push({
      label        : deck.label,
      tier         : deck.tier,
      archetype    : deck.archetype,
      consistency,
      redundancy,
      metaPositioning,
      composite,
      wr,
      labelTag     : label,
    });

    if (VERBOSE) {
      console.log(
        `      Consistency   = ${consistency}  ` +
        `(lands=${deck.entries.filter((e) => e.card.typeLine.includes("Land")).reduce((s,e) => s+e.quantity,0)} / ` +
        `total=${deck.entries.reduce((s,e) => s+e.quantity,0)})`,
      );
      console.log(
        `      Redundancy    = ${redundancy}  ` +
        `(threats=${deck.roles.threats}, removal=${deck.roles.removal}, draw=${deck.roles.cardDraw})`,
      );
      console.log(`      MetaPos       = ${metaPositioning}  (archetype=${deck.archetype})`);
      console.log();
    }
  }

  // ── Tier summary statistics ──────────────────────────────────────────────
  console.log("\n  " + "─".repeat(94));

  const byTier = {};
  for (const r of results) {
    byTier[r.tier] = byTier[r.tier] ?? [];
    byTier[r.tier].push(r.composite);
  }

  for (const [tier, scores] of Object.entries(byTier).sort()) {
    const mean = scores.reduce((a, b) => a + b, 0) / scores.length;
    const min  = Math.min(...scores);
    const max  = Math.max(...scores);
    const mark = tier === "1" && mean >= TIER1_TARGET ? "✅" : tier === "1" ? "❌" : "  ";
    console.log(
      `  ${mark}  Tier ${tier} (${scores.length} decks):  mean=${mean.toFixed(1)}  min=${min}  max=${max}` +
      (tier === "1" ? `  [target ≥${TIER1_TARGET}]` : ""),
    );
  }

  // ── Pass / fail decks ─────────────────────────────────────────────────────
  const tier1Results = results.filter((r) => r.tier === 1);
  const passing      = tier1Results.filter((r) => r.composite >= TIER1_TARGET);
  const failing      = tier1Results.filter((r) => r.composite <  TIER1_TARGET);

  if (failing.length > 0) {
    console.log(`\n  ⚠️   Tier-1 decks below ${TIER1_TARGET}:`);
    for (const r of failing) {
      console.log(`        ${r.label.padEnd(32)} score=${r.composite}  (shortfall ${TIER1_TARGET - r.composite})`);
    }
  }

  if (passing.length > 0 && VERBOSE) {
    console.log(`\n  ✅  Tier-1 decks meeting target:`);
    for (const r of passing) {
      console.log(`        ${r.label.padEnd(32)} score=${r.composite}`);
    }
  }

  // ── Pillar averages across all decks ─────────────────────────────────────
  function avg(arr) { return arr.length ? arr.reduce((a,b)=>a+b,0)/arr.length : 0; }
  const tier1Con  = avg(tier1Results.map((r) => r.consistency));
  const tier1Red  = avg(tier1Results.map((r) => r.redundancy));
  const tier1Meta = avg(tier1Results.map((r) => r.metaPositioning));

  console.log(`\n  Tier-1 pillar averages:`);
  console.log(`     Consistency   ${tier1Con.toFixed(1)}`);
  console.log(`     Redundancy    ${tier1Red.toFixed(1)}`);
  console.log(`     MetaPosition  ${tier1Meta.toFixed(1)}`);

  // ── Weight suggestion ─────────────────────────────────────────────────────
  const tier1Mean = avg(tier1Results.map((r) => r.composite));
  suggestWeights(results, tier1Mean);

  // Exit code: 0 = target met, 1 = below target
  const allTier1Pass = tier1Results.every((r) => r.composite >= TIER1_TARGET);
  process.exit(allTier1Pass ? 0 : 1);
}

main();
