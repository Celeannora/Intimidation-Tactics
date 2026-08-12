// Playtest driver for the Hope Estheim / Space-Time Anomaly / Lyra Dawnbringer build.
// Uses the existing generic hand simulator (src/lib/handSimulator.ts) for baseline
// mana-curve stats, then layers a color-aware, gameplan-aware turn-by-turn goldfish
// sim on top (color requirements + the deck's actual win condition — life gained ->
// mill — are NOT modeled by the generic simulator, which only checks total land
// count vs CMC and ignores color pips entirely).
//
// This script is deck-specific scaffolding for analysis, not part of the generic
// engine — it does not touch scoreEngine.ts, scoringConfig.ts, roles.ts, or
// generator/pipeline.ts.

import { readFileSync } from "node:fs";
import { join } from "node:path";
import { simulateHands, deckToSimCards, goldfishCard, type SimCard } from "../src/lib/handSimulator";
import { parseManaPips, type ColourKey } from "../src/lib/mana";

const POOL_DIR = "/home/user/workspace/pool_data";

interface ScryfallCard {
  name: string;
  type_line: string;
  mana_cost: string | null;
  cmc: number;
  oracle_text?: string;
  produced_mana?: string[];
}

function loadAll(): ScryfallCard[] {
  const files = ["azorius_pool.json", "colorless_artifacts.json", "lands.json"];
  const out: ScryfallCard[] = [];
  for (const f of files) {
    try {
      out.push(...(JSON.parse(readFileSync(join(POOL_DIR, f), "utf-8")) as ScryfallCard[]));
    } catch {
      // optional file
    }
  }
  return out;
}

// Updated to match the decklist rebuilt after the resourceCadence fix
// (scripts/hopeEstheimComparison.ts output, post-fix): Sheltered by Ghosts is
// now a full 4-of (was fragmented at 1x when Exemplar of Light's false-positive
// Enabler tag was crowding it out), and the filler package has shifted from
// Kitsa/The Ooze/Venat/Niko toward Long River's Pull + Agatha's Soul Cauldron.
const DECKLIST: { qty: number; name: string }[] = [
  { qty: 4, name: "Hope Estheim" },
  { qty: 4, name: "Space-Time Anomaly" },
  { qty: 4, name: "Lyra Dawnbringer" },
  { qty: 2, name: "Agatha's Soul Cauldron" },
  { qty: 2, name: "Kitsa, Otterball Elite" },
  { qty: 2, name: "Long River's Pull" },
  { qty: 4, name: "Sheltered by Ghosts" },
  { qty: 4, name: "Resplendent Angel" },
  { qty: 3, name: "Angel of Finality" },
  { qty: 4, name: "Exemplar of Light" },
  { qty: 1, name: "Morningtide's Light" },
  { qty: 2, name: "Niko, Light of Hope" },
];

const LANDS: { qty: number; name: string; produces: ColourKey[] }[] = [
  { qty: 3, name: "Floodfarm Verge", produces: ["W", "U"] },
  { qty: 3, name: "Gleaming Bastion", produces: ["W", "U"] },
  { qty: 4, name: "Island", produces: ["U"] },
  { qty: 12, name: "Plains", produces: ["W"] },
  { qty: 2, name: "Temple of Enlightenment", produces: ["W", "U"] },
];

function main() {
  const pool = loadAll();
  const byName = new Map<string, ScryfallCard>();
  for (const c of pool) if (!byName.has(c.name)) byName.set(c.name, c);

  // ---- Build SimCard[] for the generic simulator (color-blind baseline) ----
  const simEntries: Array<{ name: string; quantity: number; cmc: number; manaCost: string | null; typeLine: string; producedManaJson?: string }> = [];
  const missing: string[] = [];

  for (const { qty, name } of DECKLIST) {
    const c = byName.get(name);
    if (!c) { missing.push(name); continue; }
    simEntries.push({ name, quantity: qty, cmc: c.cmc, manaCost: c.mana_cost, typeLine: c.type_line });
  }
  for (const { qty, name, produces } of LANDS) {
    simEntries.push({ name, quantity: qty, cmc: 0, manaCost: null, typeLine: "Land", producedManaJson: JSON.stringify(produces) });
  }
  if (missing.length) {
    console.error("MISSING FROM POOL DATA:", missing);
    process.exit(1);
  }

  const deck: SimCard[] = deckToSimCards(simEntries);
  console.log(`Deck built: ${deck.length} cards (expect 60).`);
  if (deck.length !== 60) console.error("WARNING: deck size mismatch!");

  // ---- 1. Baseline generic simulation (10,000 trials, color-blind) ----
  console.log("\n=== BASELINE (color-blind, generic simulator) — 10,000 trials ===");
  const summary = simulateHands(deck, 10_000, 7, 42);
  console.log(`Avg lands in opening hand: ${summary.avgLandsInHand}`);
  console.log(`Keep rate (2-5 lands): ${(summary.keepRate * 100).toFixed(1)}%`);
  console.log(`Mana screw rate (0-1 lands): ${(summary.screwRate * 100).toFixed(1)}%`);
  console.log(`Mana flood rate (5+ lands): ${(summary.floodRate * 100).toFixed(1)}%`);
  console.log("On-curve rates by CMC (color ignored):", summary.onCurveRates);

  // ---- 2. Per-key-card goldfish (color-blind) ----
  console.log("\n=== GOLDFISH: first-castable-turn for key cards (color-blind) — 10,000 trials each ===");
  const keyCards = ["Hope Estheim", "Lyra Dawnbringer", "Space-Time Anomaly", "Resplendent Angel", "Exemplar of Light"];
  for (const name of keyCards) {
    const g = goldfishCard(deck, name, 10, 10_000, true, 7);
    console.log(`${name}: avg first-castable turn ${g.avgFirstCastableTurn}, never castable by turn 10: ${(g.neverCastable * 100).toFixed(1)}%`);
  }

  // ---- 3. Color-aware analysis (the generic simulator ignores this entirely) ----
  console.log("\n=== COLOR-AWARE CHECK: can this deck reliably hit WW and UU-adjacent costs? ===");
  const colorDemand: Record<string, { w: number; u: number }> = {};
  for (const { name } of DECKLIST) {
    const c = byName.get(name)!;
    const pips = parseManaPips(c.mana_cost);
    colorDemand[name] = { w: pips.W ?? 0, u: pips.U ?? 0 };
  }
  for (const [name, { w, u }] of Object.entries(colorDemand)) {
    if (w >= 2 || u >= 2) {
      console.log(`  ${name}: needs ${w}xW / ${u}xU — double-pip cost, most demanding on color`);
    }
  }

  const totalW = LANDS.filter(l => l.produces.includes("W")).reduce((s, l) => s + l.qty, 0);
  const totalU = LANDS.filter(l => l.produces.includes("U")).reduce((s, l) => s + l.qty, 0);
  console.log(`  Total W sources: ${totalW} / 24 lands. Total U sources: ${totalU} / 24 lands.`);

  // ---- 4. Gameplan-aware sim: turns until first meaningful life-gain trigger,
  //         and turns until Space-Time Anomaly is both castable AND profitable
  //         (i.e., life total is actually worth milling with). ----
  console.log("\n=== GAMEPLAN CHECK: turn Space-Time Anomaly becomes castable AND worth casting ===");
  simulateGameplan(deck, byName);
}

interface DeckCard {
  name: string;
  cmc: number;
  isLand: boolean;
  pips: { w: number; u: number };
  producesW: boolean;
  producesU: boolean;
  isHopeEstheim: boolean;
  isLyra: boolean;
  isResplendentAngel: boolean;
  isSTA: boolean;
  isShelteredByGhosts: boolean;
}

function mulberry32(seed: number) {
  return function () {
    seed |= 0;
    seed = (seed + 0x6d2b79f5) | 0;
    let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
function shuffle<T>(arr: T[], rand: () => number): T[] {
  const a = arr.slice();
  for (let i = a.length - 1; i > 0; i--) {
    const j = Math.floor(rand() * (i + 1));
    [a[i], a[j]] = [a[j], a[i]];
  }
  return a;
}

function simulateGameplan(_deck: SimCard[], byName: Map<string, ScryfallCard>) {
  const cards: DeckCard[] = [];
  for (const { qty, name } of DECKLIST) {
    const c = byName.get(name)!;
    const pips = parseManaPips(c.mana_cost);
    for (let i = 0; i < qty; i++) {
      cards.push({
        name,
        cmc: c.cmc,
        isLand: false,
        pips: { w: pips.W ?? 0, u: pips.U ?? 0 },
        producesW: false,
        producesU: false,
        isHopeEstheim: name === "Hope Estheim",
        isLyra: name === "Lyra Dawnbringer",
        isResplendentAngel: name === "Resplendent Angel",
        isSTA: name === "Space-Time Anomaly",
        isShelteredByGhosts: name === "Sheltered by Ghosts",
      });
    }
  }
  for (const { qty, name, produces } of LANDS) {
    for (let i = 0; i < qty; i++) {
      cards.push({
        name,
        cmc: 0,
        isLand: true,
        pips: { w: 0, u: 0 },
        producesW: produces.includes("W"),
        producesU: produces.includes("U"),
        isHopeEstheim: false,
        isLyra: false,
        isResplendentAngel: false,
        isSTA: false,
        isShelteredByGhosts: false,
      });
    }
  }

  const trials = 5000;
  const maxTurns = 12;
  const rand = mulberry32(99);

  let staCastableTurnSum = 0, staCastableCount = 0, staNever = 0;
  let staProfitableTurnSum = 0, staProfitableCount = 0, staNeverProfitable = 0;
  let firstLifeGainTurnSum = 0, firstLifeGainCount = 0, noLifeGainBy12 = 0;
  let colorScrewCount = 0; // hands that had lands but couldn't cast a 1st-pip white or blue spell for 2+ turns
  const staMillAmountAtCastTurn: number[] = [];

  for (let t = 0; t < trials; t++) {
    const shuffled = shuffle(cards, rand);
    let seen = 7;
    const hand = shuffled.slice(0, 7);
    let life = 0;
    let landsInPlay = 0;
    let wSources = 0, uSources = 0;
    let hopeEstheimInPlay = false;
    let lyraInPlay = false;
    let resplendentAngelsInPlay = 0;
    let shelteredByGhostsAttached = false;
    let creaturesInPlay = 0; // any creature that could serve as a Sheltered by Ghosts target
    let staCastTurn: number | null = null;
    let staProfitableTurn: number | null = null;
    let firstLifeGainTurn: number | null = null;
    let stuckColorTurns = 0;

    // Simulate a simple, generous "always land drop if available, always play
    // the biggest castable relevant threat" AI — this is a floor/ceiling probe,
    // not a full game engine (no combat, no opponent interaction modeled).
    const zone = [...hand];
    for (let turn = 1; turn <= maxTurns; turn++) {
      if (turn > 1) {
        const drawn = shuffled[seen];
        if (drawn) { seen++; zone.push(drawn); }
      }
      // Play a land if one is in hand
      const landIdx = zone.findIndex(c => c.isLand);
      if (landIdx >= 0) {
        const land = zone.splice(landIdx, 1)[0];
        landsInPlay++;
        if (land.producesW) wSources++;
        if (land.producesU) uSources++;
      }
      const manaAvailable = landsInPlay;

      // End-of-turn life gain trigger from Hope Estheim and/or a Sheltered by
      // Ghosts-enchanted creature (assume ~2 life/turn per active source,
      // representing a small creature connecting + lifelink — deliberately
      // conservative, not simulating full combat/blockers).
      const activeLifeSources = (hopeEstheimInPlay ? 1 : 0) + (shelteredByGhostsAttached ? 1 : 0);
      if (activeLifeSources > 0) {
        life += 2 * activeLifeSources;
        if (firstLifeGainTurn === null) { firstLifeGainTurn = turn; }
      }

      // Try to cast Hope Estheim (WU, cmc 2) if not in play
      if (!hopeEstheimInPlay) {
        const idx = zone.findIndex(c => c.isHopeEstheim);
        if (idx >= 0 && manaAvailable >= 2 && wSources >= 1 && uSources >= 1) {
          zone.splice(idx, 1);
          hopeEstheimInPlay = true;
          creaturesInPlay++;
        }
      }
      // Try to cast Lyra (3WW, cmc 5)
      if (!lyraInPlay) {
        const idx = zone.findIndex(c => c.isLyra);
        if (idx >= 0 && manaAvailable >= 5 && wSources >= 2) {
          zone.splice(idx, 1);
          lyraInPlay = true;
          creaturesInPlay++;
        }
      }
      // Try to cast a Resplendent Angel (1WW, cmc 3) — track count for future turns
      {
        const idx = zone.findIndex(c => c.isResplendentAngel);
        if (idx >= 0 && manaAvailable >= 3 && wSources >= 2) {
          zone.splice(idx, 1);
          resplendentAngelsInPlay++;
          creaturesInPlay++;
        }
      }
      // Try to cast Sheltered by Ghosts (1W, cmc 2) — requires an existing
      // creature in play as an enchant target (it's an Aura). Grants the
      // enchanted creature lifelink, which is what actually makes it a real
      // life source once attached — not just "a card that mentions life".
      if (!shelteredByGhostsAttached && creaturesInPlay > 0) {
        const idx = zone.findIndex(c => c.isShelteredByGhosts);
        if (idx >= 0 && manaAvailable >= 2 && wSources >= 1) {
          zone.splice(idx, 1);
          shelteredByGhostsAttached = true;
        }
      }
      // Track color screw: 3+ mana available but can't cast anything needing
      // WU/WW/UU specifically due to color, for 2+ consecutive turns
      if (manaAvailable >= 3 && (wSources < 1 || uSources < 1)) {
        stuckColorTurns++;
      }

      // Track Space-Time Anomaly (2WU, cmc 4)
      if (staCastTurn === null) {
        const idx = zone.findIndex(c => c.isSTA);
        if (idx >= 0 && manaAvailable >= 4 && wSources >= 1 && uSources >= 1) {
          staCastTurn = turn;
          if (life >= 10) {
            // "Profitable" threshold: milling for double-digits is a real swing
            staProfitableTurn = turn;
          }
        }
      } else if (staProfitableTurn === null && life >= 10) {
        staProfitableTurn = turn;
      }
    }

    if (staCastTurn !== null) { staCastableTurnSum += staCastTurn; staCastableCount++; staMillAmountAtCastTurn.push(life); }
    else staNever++;
    if (staProfitableTurn !== null) { staProfitableTurnSum += staProfitableTurn; staProfitableCount++; }
    else staNeverProfitable++;
    if (firstLifeGainTurn !== null) { firstLifeGainTurnSum += firstLifeGainTurn; firstLifeGainCount++; }
    else noLifeGainBy12++;
    if (stuckColorTurns >= 2) colorScrewCount++;
  }

  console.log(`Trials: ${trials}, horizon: ${maxTurns} turns`);
  console.log(`Hope Estheim (or another life-gain source) online: avg turn ${firstLifeGainCount > 0 ? (firstLifeGainTurnSum / firstLifeGainCount).toFixed(2) : "N/A"}, never online by turn ${maxTurns}: ${((noLifeGainBy12 / trials) * 100).toFixed(1)}%`);
  console.log(`Space-Time Anomaly castable: avg turn ${staCastableCount > 0 ? (staCastableTurnSum / staCastableCount).toFixed(2) : "N/A"}, never castable by turn ${maxTurns}: ${((staNever / trials) * 100).toFixed(1)}%`);
  console.log(`Space-Time Anomaly "profitable" (cast with life >= 10): avg turn ${staProfitableCount > 0 ? (staProfitableTurnSum / staProfitableCount).toFixed(2) : "N/A"}, never profitable by turn ${maxTurns}: ${((staNeverProfitable / trials) * 100).toFixed(1)}%`);
  console.log(`Hands with 2+ consecutive turns of 3+ mana but missing W or U source (color screw): ${((colorScrewCount / trials) * 100).toFixed(1)}%`);
  if (staMillAmountAtCastTurn.length > 0) {
    const avgMill = staMillAmountAtCastTurn.reduce((a, b) => a + b, 0) / staMillAmountAtCastTurn.length;
    console.log(`Average life total (= mill amount) at the moment Space-Time Anomaly first becomes castable: ${avgMill.toFixed(1)}`);
  }
}

main();
