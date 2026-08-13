// Generic seed-to-deck driver. Takes a seed spec (card names + quantities)
// and pool location as plain CLI/config input, and calls generateDeck()
// directly -- the same generic entry point any caller (UI, API, tests) uses.
//
// This script owns ZERO card-specific or deck-specific logic: it does not
// know what a "Hope Estheim" or "Space-Time Anomaly" is, does not hardcode
// a decklist, and does not special-case any card by name. All synergy
// classification, resource inference, and role-gap scoring happens inside
// the generic pipeline (generator.ts + weights.ts, driven by seedSynergy.ts)
// purely from each seed card's own Oracle text -- exactly as proven by
// src/lib/generator/__tests__/seedSynergyWiring.test.ts using an unrelated
// black/red seed.
//
// Usage:
//   npx tsx scripts/buildFromSeed.ts --seed path/to/seed.json --pool-dir /path --colors WU --archetype Control
//
// seed.json shape: [{ "name": "Card Name", "quantity": 4 }, ...]

import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { toCardRecord, isStandardEligible, type ScryfallCard as ScryfallInput } from "../src/lib/scryfall";
import type { CardRecord, ManaColor } from "../src/lib/types";
import type { DeckEntry } from "../src/lib/legality";
import { generateDeck } from "../src/lib/generator/generator";
import type { GenerateOptions } from "../src/lib/generator/types";
import type { Archetype } from "../src/lib/archetype";

interface CliArgs {
  seedPath: string;
  poolDir: string;
  poolFiles: string[];
  colors: ManaColor[];
  archetype: Archetype;
  mainboardSize: number;
  out: string;
}

function parseArgs(argv: string[]): CliArgs {
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  const seedPath = get("--seed");
  if (!seedPath) throw new Error("Missing required --seed <path-to-seed.json>");
  const poolDir = get("--pool-dir", "/home/user/workspace/pool_data")!;
  const poolFilesRaw = get("--pool-files", "azorius_pool.json,colorless_artifacts.json,lands.json")!;
  const colorsRaw = get("--colors", "")!;
  const archetype = (get("--archetype", "Midrange") as Archetype)!;
  const mainboardSize = Number(get("--mainboard-size", "60"));
  const out = get("--out", "generated_decklist.json")!;
  return {
    seedPath,
    poolDir,
    poolFiles: poolFilesRaw.split(",").map((s) => s.trim()).filter(Boolean),
    colors: colorsRaw.split("").filter((c) => "WUBRG".includes(c)) as ManaColor[],
    archetype,
    mainboardSize,
    out,
  };
}

function loadPool(poolDir: string, files: string[]): CardRecord[] {
  const importedAt = new Date().toISOString();
  const seen = new Map<string, CardRecord>();
  for (const f of files) {
    let raw: ScryfallInput[] = [];
    try {
      raw = JSON.parse(readFileSync(join(poolDir, f), "utf-8"));
    } catch {
      continue; // optional file for this pool variant
    }
    for (const sc of raw) {
      if (!isStandardEligible(sc)) continue;
      const rec = toCardRecord(sc, importedAt);
      // Keep the first (Scryfall's oracle-representative) printing per oracle id.
      if (!seen.has(rec.oracleId)) seen.set(rec.oracleId, rec);
    }
  }
  return [...seen.values()];
}

function resolveSeedEntries(seedSpec: { name: string; quantity: number }[], pool: CardRecord[]): DeckEntry[] {
  const byName = new Map(pool.map((c) => [c.name.toLowerCase(), c]));
  const entries: DeckEntry[] = [];
  for (const s of seedSpec) {
    const card = byName.get(s.name.toLowerCase());
    if (!card) {
      throw new Error(`Seed card "${s.name}" not found in the loaded pool (check --pool-dir/--pool-files).`);
    }
    entries.push({ card, quantity: s.quantity, board: "main" });
  }
  return entries;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const seedSpec: { name: string; quantity: number }[] = JSON.parse(readFileSync(args.seedPath, "utf-8"));

  console.log(`Loading pool from ${args.poolDir} (${args.poolFiles.join(", ")})...`);
  const pool = loadPool(args.poolDir, args.poolFiles);
  console.log(`Loaded ${pool.length} unique Standard-legal oracle cards.`);

  const seedEntries = resolveSeedEntries(seedSpec, pool);
  console.log(`Resolved ${seedEntries.length} seed card(s): ${seedEntries.map((e) => `${e.quantity}x ${e.card.name}`).join(", ")}`);

  const colors: ManaColor[] =
    args.colors.length > 0
      ? args.colors
      : [...new Set(seedEntries.flatMap((e) => JSON.parse(e.card.colorIdentityJson) as ManaColor[]))];

  const options: GenerateOptions = {
    engine: "offline",
    format: "standard",
    archetype: args.archetype,
    colors,
    seedEntries,
    mainboardSize: args.mainboardSize,
    maxMainboardSize: args.mainboardSize,
    optimizationIterations: 200,
  };

  console.log(`Generating deck: archetype=${options.archetype}, colors=${colors.join("")}...`);
  const result = generateDeck(options, pool);

  const mainEntries = result.entries.filter((e) => e.board === "main");
  const sideEntries = result.entries.filter((e) => e.board === "sideboard");
  const mainTotal = mainEntries.reduce((s, e) => s + e.quantity, 0);

  console.log(`\nGenerated ${mainTotal}-card mainboard (+${sideEntries.reduce((s, e) => s + e.quantity, 0)} sideboard).`);
  console.log(`Deck score: ${result.diagnostics.deckScore}`);
  console.log(`\nReasoning trace:`);
  for (const line of result.diagnostics.reasoning) console.log(`  - ${line}`);
  if (result.diagnostics.seedFeasibilityFlags?.length) {
    console.log(`\nSeed feasibility flags:`);
    for (const flag of result.diagnostics.seedFeasibilityFlags) {
      console.log(`  [${flag.severity}] ${flag.message}`);
    }
  }

  const output = {
    options: { archetype: options.archetype, colors, mainboardSize: args.mainboardSize },
    seed: seedSpec,
    diagnostics: result.diagnostics,
    mainboard: mainEntries
      .map((e) => ({ name: e.card.name, quantity: e.quantity, typeLine: e.card.typeLine, cmc: e.card.cmc }))
      .sort((a, b) => a.cmc - b.cmc || a.name.localeCompare(b.name)),
    sideboard: sideEntries.map((e) => ({ name: e.card.name, quantity: e.quantity })),
  };
  writeFileSync(args.out, JSON.stringify(output, null, 2));
  console.log(`\nWrote full result to ${args.out}`);
}

main();
