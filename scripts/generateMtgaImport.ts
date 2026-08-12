// One-off generator: reads the final decklist (hardcoded below, copied from
// the latest comparison run's "Final 60-card decklist" section) and emits an
// MTGA-format import file, using each card's set/collector number as
// recorded in the app's own bulk pool data (POOL_DIR), with ONE manual
// correction: Sheltered by Ghosts must cite its Arena-legal Duskmourn
// printing (DSK #30), not the pool's default oracle-level representative
// printing (Secrets of Strixhaven Commander decks, SOC #171, which is NOT
// Arena-legal). The pool/scoring pipeline only tracks oracle-level data
// (text, legality, color identity) so it always surfaces whichever printing
// Scryfall's oracle_cards dataset picked as "most recognizable" -- for
// Sheltered by Ghosts that happens to be the non-Arena Commander reprint
// even though the card is legitimately Arena-includable via its original
// Duskmourn printing. This substitution must be redone by hand every time
// the decklist changes.
import { readFileSync } from "node:fs";
import { join } from "node:path";
import type { SeedPackage } from "../src/lib/generator/seedSynergy";

const POOL_DIR = "/home/user/workspace/pool_data";

// Script-level build configuration. Change this package when exporting a
// different seed build; the generic engine never owns card-specific data.
const SEED_PACKAGE: SeedPackage = [
  { name: "Hope Estheim", quantity: 4 },
  { name: "Authority of the Consuls", quantity: 4 },
  { name: "Space-Time Anomaly", quantity: 4 },
];

interface ScryfallCard {
  name: string;
  set: string;
  collector_number: string;
  oracle_id: string;
}

function loadAll(): ScryfallCard[] {
  const files = ["azorius_pool.json", "colorless_artifacts.json", "lands.json"];
  const out: ScryfallCard[] = [];
  for (const f of files) {
    try {
      const raw = JSON.parse(readFileSync(join(POOL_DIR, f), "utf-8")) as ScryfallCard[];
      out.push(...raw);
    } catch {
      // file may not exist for this pool variant; skip
    }
  }
  return out;
}

// Manual overrides for known false/unhelpful oracle-level printings.
const PRINTING_OVERRIDE: Record<string, { set: string; number: string }> = {
  "Sheltered by Ghosts": { set: "DSK", number: "30" },
};

const DECKLIST: { qty: number; name: string }[] = [
  ...SEED_PACKAGE.map(({ quantity, name }) => ({ qty: quantity, name })),
  { qty: 2, name: "Excalibur II" },
  { qty: 2, name: "Stiltzkin, Moogle Merchant" },
  { qty: 2, name: "Agatha's Soul Cauldron" },
  { qty: 1, name: "Jace Reawakened" },
  { qty: 2, name: "Kitsa, Otterball Elite" },
  { qty: 3, name: "Sheltered by Ghosts" },
  { qty: 2, name: "Super-Adaptoid" },
  { qty: 2, name: "Venat, Heart of Hydaelyn // Hydaelyn, the Mothercrystal" },
  { qty: 2, name: "Morningtide's Light" },
  { qty: 2, name: "Niko, Light of Hope" },
  { qty: 4, name: "Season of the Burrow" },
];

const LANDS: { qty: number; name: string }[] = [
  { qty: 3, name: "Floodfarm Verge" },
  { qty: 3, name: "Gleaming Bastion" },
  { qty: 5, name: "Island" },
  { qty: 11, name: "Plains" },
  { qty: 2, name: "Temple of Enlightenment" },
];

function main() {
  const pool = loadAll();
  const byName = new Map<string, ScryfallCard>();
  for (const c of pool) {
    if (!byName.has(c.name)) byName.set(c.name, c);
  }

  const lines: string[] = ["Deck"];
  const missing: string[] = [];

  for (const { qty, name } of [...DECKLIST, ...LANDS]) {
    const override = PRINTING_OVERRIDE[name];
    if (override) {
      lines.push(`${qty} ${name} (${override.set}) ${override.number}`);
      continue;
    }
    const card = byName.get(name);
    if (!card) {
      missing.push(name);
      lines.push(`${qty} ${name}`);
      continue;
    }
    lines.push(`${qty} ${name} (${card.set.toUpperCase()}) ${card.collector_number}`);
  }

  const totalNonland = DECKLIST.reduce((s, e) => s + e.qty, 0);
  const totalLand = LANDS.reduce((s, e) => s + e.qty, 0);
  console.log(`# ${totalNonland} nonland + ${totalLand} land = ${totalNonland + totalLand} total`);
  console.log(lines.join("\n"));
  if (missing.length) {
    console.error("MISSING PRINTING DATA FOR:", missing);
    process.exit(1);
  }
}

main();
