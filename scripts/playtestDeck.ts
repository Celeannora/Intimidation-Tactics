// Generic playtest driver. Reads a decklist JSON (as produced by
// buildFromSeed.ts, or any {name, quantity, cmc, typeLine, manaCost}[]
// shape) and runs the shared, deck-agnostic Monte Carlo hand simulator
// (src/lib/handSimulator.ts) against it. Owns zero card-specific logic:
// which cards to goldfish are taken from --goldfish (or default to the
// deck's own seed list if present in the input file), never hardcoded.
//
// Usage:
//   npx tsx scripts/playtestDeck.ts --deck path/to/generated.json --trials 10000 --goldfish "Card A,Card B"

import { readFileSync, writeFileSync } from "node:fs";
import { simulateHands, goldfishCard, deckToSimCards } from "../src/lib/handSimulator";

interface DeckFile {
  seed?: { name: string; quantity: number }[];
  mainboard: { name: string; quantity: number; typeLine: string; cmc: number }[];
}

function parseArgs(argv: string[]) {
  const get = (flag: string, fallback?: string) => {
    const i = argv.indexOf(flag);
    return i >= 0 ? argv[i + 1] : fallback;
  };
  return {
    deckPath: get("--deck")!,
    trials: Number(get("--trials", "10000")),
    goldfishRaw: get("--goldfish"),
    out: get("--out", "playtest_result.json")!,
  };
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  if (!args.deckPath) throw new Error("Missing required --deck <path>");
  const deckFile: DeckFile = JSON.parse(readFileSync(args.deckPath, "utf-8"));

  const simCards = deckToSimCards(
    deckFile.mainboard.map((e) => ({
      name: e.name,
      quantity: e.quantity,
      cmc: e.cmc,
      manaCost: null,
      typeLine: e.typeLine,
    }))
  );
  const total = simCards.length;
  console.log(`Loaded ${total}-card mainboard from ${args.deckPath}.`);

  const summary = simulateHands(simCards, args.trials, 7, 42);
  console.log(`\nOpening hand simulation (${args.trials.toLocaleString()} trials):`);
  console.log(`  Avg lands in hand: ${summary.avgLandsInHand}`);
  console.log(`  Keep rate (2-5 lands): ${(summary.keepRate * 100).toFixed(1)}%`);
  console.log(`  Screw rate (0-1 lands): ${(summary.screwRate * 100).toFixed(1)}%`);
  console.log(`  Flood rate (5+ lands): ${(summary.floodRate * 100).toFixed(1)}%`);

  const goldfishTargets = args.goldfishRaw
    ? args.goldfishRaw.split(",").map((s) => s.trim())
    : (deckFile.seed ?? []).map((s) => s.name);

  const goldfishResults = goldfishTargets
    .filter((name) => simCards.some((c) => c.name === name))
    .map((name) => goldfishCard(simCards, name, 10, args.trials, true, 42));

  console.log(`\nGoldfish results (first-castable turn):`);
  for (const g of goldfishResults) {
    console.log(
      `  ${g.cardName}: avg turn ${g.avgFirstCastableTurn === -1 ? "never" : g.avgFirstCastableTurn}, ` +
        `never-castable ${(g.neverCastable * 100).toFixed(1)}%`
    );
  }

  writeFileSync(
    args.out,
    JSON.stringify({ deckPath: args.deckPath, trials: args.trials, handSummary: summary, goldfish: goldfishResults }, null, 2)
  );
  console.log(`\nWrote full playtest result to ${args.out}`);
}

main();
