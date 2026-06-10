/**
 * Hand Simulator — Monte Carlo goldfish tester.
 *
 * Simulates opening hands and early turns to compute:
 *  - Average land count in opening hand
 *  - Probability of a keepable hand (by configurable criteria)
 *  - Probability of casting key cards on curve
 *  - Mana flood / screw frequency
 */

import type { ColourKey } from "./mana";

export interface SimCard {
  name: string;
  cmc: number;
  manaCost: string | null;
  isLand: boolean;
  /** True for basic lands and unconditional untapped duals */
  producesColors?: ColourKey[];
}

export interface HandResult {
  hand: SimCard[];
  landCount: number;
  keepable: boolean;
  /** Cards castable by their "ideal" turn (turn == cmc, min turn 1) */
  onCurveByTurn: Record<number, string[]>;
}

export interface SimulationSummary {
  trials: number;
  avgLandsInHand: number;
  keepRate: number;
  /** % of hands with 0-1 lands (screw) */
  screwRate: number;
  /** % of hands with 5+ lands (flood) */
  floodRate: number;
  /** For each cmc value present in deck: % of trials where ≥1 copy was castable on its natural turn */
  onCurveRates: Record<number, number>;
  /** Raw per-trial results (omitted when trials > 1000 to save memory) */
  trials_detail?: HandResult[];
}

/** Seeded Mulberry32 PRNG for reproducible tests. */
function mulberry32(seed: number) {
  return function (): number {
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

/**
 * Determines whether a 7-card hand is keepable.
 * Default rule: 2-5 lands is keepable.
 */
export function isKeepable(
  hand: SimCard[],
  minLands = 2,
  maxLands = 5
): boolean {
  const lands = hand.filter(c => c.isLand).length;
  return lands >= minLands && lands <= maxLands;
}

/**
 * Checks which non-land cards in the hand are castable by their natural turn
 * given the lands drawn, assuming all lands tap for the right color.
 */
function onCurveMap(
  hand: SimCard[],
  landsInHand: number
): Record<number, string[]> {
  const result: Record<number, string[]> = {};
  for (const card of hand) {
    if (card.isLand) continue;
    const idealTurn = Math.max(1, card.cmc);
    // Can cast if we have >= cmc lands in hand (simplification: ignore color)
    if (landsInHand >= card.cmc) {
      if (!result[idealTurn]) result[idealTurn] = [];
      result[idealTurn].push(card.name);
    }
  }
  return result;
}

/**
 * Simulate `trials` opening hands from the given deck list.
 *
 * @param deck       Full 60-card deck as SimCard array (with duplicates)
 * @param trials     Number of Monte Carlo iterations (default 10 000)
 * @param handSize   Opening hand size (default 7)
 * @param seed       Optional PRNG seed for reproducibility
 * @param minLands   Minimum lands for a keepable hand (default 2)
 * @param maxLands   Maximum lands for a keepable hand (default 5)
 */
export function simulateHands(
  deck: SimCard[],
  trials = 10_000,
  handSize = 7,
  seed?: number,
  minLands = 2,
  maxLands = 5
): SimulationSummary {
  const rand = mulberry32(seed ?? Date.now());

  let totalLands = 0;
  let totalKeep = 0;
  let totalScrew = 0;
  let totalFlood = 0;
  const onCurveHits: Record<number, number> = {};
  const detailedResults: HandResult[] = [];
  const storeDetail = trials <= 1000;

  for (let t = 0; t < trials; t++) {
    const shuffled = shuffle(deck, rand);
    const hand = shuffled.slice(0, handSize);
    const landCount = hand.filter(c => c.isLand).length;

    totalLands += landCount;
    if (landCount <= 1) totalScrew++;
    if (landCount >= 5) totalFlood++;

    const keepable = isKeepable(hand, minLands, maxLands);
    if (keepable) totalKeep++;

    const onCurve = onCurveMap(hand, landCount);
    for (const [turnStr, cards] of Object.entries(onCurve)) {
      const turn = Number(turnStr);
      if (cards.length > 0) {
        onCurveHits[turn] = (onCurveHits[turn] ?? 0) + 1;
      }
    }

    if (storeDetail) {
      detailedResults.push({ hand, landCount, keepable, onCurveByTurn: onCurve });
    }
  }

  // Collect all CMC values present among non-land cards
  const nonLands = deck.filter(c => !c.isLand);
  const cmcValues = [...new Set(nonLands.map(c => Math.max(1, c.cmc)))];
  const onCurveRates: Record<number, number> = {};
  for (const cmc of cmcValues) {
    onCurveRates[cmc] = parseFloat(((onCurveHits[cmc] ?? 0) / trials).toFixed(4));
  }

  const summary: SimulationSummary = {
    trials,
    avgLandsInHand: parseFloat((totalLands / trials).toFixed(3)),
    keepRate: parseFloat((totalKeep / trials).toFixed(4)),
    screwRate: parseFloat((totalScrew / trials).toFixed(4)),
    floodRate: parseFloat((totalFlood / trials).toFixed(4)),
    onCurveRates,
  };

  if (storeDetail) summary.trials_detail = detailedResults;

  return summary;
}

/**
 * Simulate draws through turn N (goldfish) to determine when a key card
 * is likely to be drawn and whether mana exists to cast it.
 *
 * Returns the distribution of "first turn card is castable" across trials.
 */
export interface GoldfishResult {
  cardName: string;
  /** turn -> fraction of trials where card was first castable on that turn */
  firstCastableTurnDistribution: Record<number, number>;
  /** fraction of trials where card was never castable within the simulated turns */
  neverCastable: number;
  avgFirstCastableTurn: number;
}

export function goldfishCard(
  deck: SimCard[],
  targetName: string,
  maxTurns = 10,
  trials = 10_000,
  onDraw = true,
  seed?: number
): GoldfishResult {
  const rand = mulberry32(seed ?? Date.now());
  const turnHits: Record<number, number> = {};
  let neverCount = 0;
  let totalFirstTurn = 0;
  let foundCount = 0;

  for (let t = 0; t < trials; t++) {
    const shuffled = shuffle(deck, rand);
    // Draw opening hand + draw steps
    let cardsSeen = 7;
    let landsInHand = shuffled.slice(0, 7).filter(c => c.isLand).length;
    const handSet = new Set(shuffled.slice(0, 7).map(c => c.name));
    let firstCastable: number | null = null;

    for (let turn = 1; turn <= maxTurns; turn++) {
      // Draw for turn (skip turn 1 on the play)
      if (turn > 1 || onDraw) {
        const drawn = shuffled[cardsSeen];
        if (drawn) {
          cardsSeen++;
          if (drawn.isLand) landsInHand++;
          handSet.add(drawn.name);
        }
      }

      // Land drop assumed every turn up to available lands
      const manaAvailable = Math.min(landsInHand, turn);

      if (handSet.has(targetName)) {
        const card = deck.find(c => c.name === targetName)!;
        if (manaAvailable >= card.cmc) {
          firstCastable = turn;
          break;
        }
      }
    }

    if (firstCastable !== null) {
      turnHits[firstCastable] = (turnHits[firstCastable] ?? 0) + 1;
      totalFirstTurn += firstCastable;
      foundCount++;
    } else {
      neverCount++;
    }
  }

  const distribution: Record<number, number> = {};
  for (const [turn, count] of Object.entries(turnHits)) {
    distribution[Number(turn)] = parseFloat((count / trials).toFixed(4));
  }

  return {
    cardName: targetName,
    firstCastableTurnDistribution: distribution,
    neverCastable: parseFloat((neverCount / trials).toFixed(4)),
    avgFirstCastableTurn:
      foundCount > 0
        ? parseFloat((totalFirstTurn / foundCount).toFixed(2))
        : -1,
  };
}

/**
 * Convert a deck record list (name + quantity) into a flat SimCard array
 * suitable for the simulator.
 */
export function deckToSimCards(
  entries: Array<{ name: string; quantity: number; cmc: number; manaCost: string | null; typeLine: string; producedManaJson?: string }>
): SimCard[] {
  const result: SimCard[] = [];
  for (const entry of entries) {
    const isLand = entry.typeLine.toLowerCase().includes("land");
    let producesColors: ColourKey[] | undefined;
    if (isLand && entry.producedManaJson) {
      try {
        producesColors = JSON.parse(entry.producedManaJson) as ColourKey[];
      } catch {
        producesColors = [];
      }
    }
    for (let i = 0; i < entry.quantity; i++) {
      result.push({
        name: entry.name,
        cmc: entry.cmc,
        manaCost: entry.manaCost,
        isLand,
        producesColors,
      });
    }
  }
  return result;
}
