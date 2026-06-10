/**
 * Hypergeometric distribution utilities for MTG probability calculations.
 *
 * Models drawing exactly k successes in n draws from a population of N cards
 * containing K successes, WITHOUT replacement — which is exactly how MTG works.
 */

/** Precomputed log-factorial cache to avoid redundant BigInt math. */
const _lnFact: number[] = [0];
function lnFact(n: number): number {
  for (let i = _lnFact.length; i <= n; i++) {
    _lnFact[i] = _lnFact[i - 1] + Math.log(i);
  }
  return _lnFact[n];
}

/**
 * ln( C(n, k) ) = lnFact(n) - lnFact(k) - lnFact(n-k)
 * Returns -Infinity when k > n or k < 0.
 */
function lnCombination(n: number, k: number): number {
  if (k < 0 || k > n) return -Infinity;
  return lnFact(n) - lnFact(k) - lnFact(n - k);
}

/**
 * P(X = k) for the hypergeometric distribution.
 *
 * @param N  Population size (deck size, e.g. 60)
 * @param K  Number of successes in population (copies of the card)
 * @param n  Number of draws (hand size, e.g. 7)
 * @param k  Desired successes (e.g. 1)
 */
export function hypergeometricPMF(
  N: number,
  K: number,
  n: number,
  k: number
): number {
  if (K > N || n > N || k > Math.min(K, n)) return 0;
  if (k < Math.max(0, n - (N - K))) return 0;
  const lnP =
    lnCombination(K, k) +
    lnCombination(N - K, n - k) -
    lnCombination(N, n);
  return Math.exp(lnP);
}

/**
 * P(X >= k) — probability of drawing AT LEAST k copies.
 */
export function hypergeometricCDF(
  N: number,
  K: number,
  n: number,
  minK: number
): number {
  let p = 0;
  const maxK = Math.min(K, n);
  for (let k = minK; k <= maxK; k++) {
    p += hypergeometricPMF(N, K, n, k);
  }
  return Math.min(1, p);
}

/**
 * P(drawing at least 1 copy of a card) given deck size, copies, and hand size.
 * This is the most common MTG query: "will I see this card in my opening hand?"
 */
export function probAtLeastOne(
  deckSize: number,
  copies: number,
  handSize: number
): number {
  return hypergeometricCDF(deckSize, copies, handSize, 1);
}

/**
 * Probability of seeing at least `minCopies` of a card by turn N on the draw.
 * Accounts for the initial hand plus draw steps.
 *
 * @param deckSize   Cards in deck (e.g. 60)
 * @param copies     Copies of the card in deck
 * @param turn       Turn number (1-based). On the draw you draw 7 + turn cards by end of turn N.
 * @param onDraw     true = on the draw (draws first turn), false = on the play
 * @param minCopies  Minimum copies desired (default 1)
 */
export function probByTurn(
  deckSize: number,
  copies: number,
  turn: number,
  onDraw: boolean,
  minCopies = 1
): number {
  // Cards seen = opening hand (7) + draw steps
  // On the play: 7 + (turn - 1) draws by end of turn N
  // On the draw: 7 + turn draws by end of turn N
  const drawSteps = onDraw ? turn : turn - 1;
  const cardsSeen = Math.min(7 + drawSteps, deckSize);
  return hypergeometricCDF(deckSize, copies, cardsSeen, minCopies);
}

/**
 * Joint probability, over a single sample of `draws` cards taken from a deck of
 * `deckSize`, of drawing AT LEAST `minSpell` copies of the spell AND AT LEAST
 * `minLand` lands — where the spell (`spellCopies`) and lands (`landCount`) are
 * disjoint subsets of the deck.
 *
 * This is the correct model for castability: the spell and the lands are drawn
 * from the *same* sample of cards seen, so the two events are NOT independent.
 * The old `P(spell) * P(lands)` form treats them as independent and overstates
 * castability (drawing the spell uses up a draw that then can't also be a land).
 *
 * Uses the multivariate hypergeometric distribution: partition the deck into
 * {spell, land, other} and sum P(s spell, l land, rest other) over the valid
 * region s >= minSpell, l >= minLand, s + l <= draws.
 */
export function probSpellAndLands(
  deckSize: number,
  spellCopies: number,
  landCount: number,
  draws: number,
  minSpell: number,
  minLand: number,
): number {
  const n = Math.min(draws, deckSize);
  const other = deckSize - spellCopies - landCount;
  if (other < 0) return 0;
  if (minSpell > spellCopies || minLand > landCount) return 0;

  const lnDenom = lnCombination(deckSize, n);
  let p = 0;
  const maxSpell = Math.min(spellCopies, n);
  for (let s = minSpell; s <= maxSpell; s++) {
    const remainingAfterSpell = n - s;
    if (remainingAfterSpell < minLand) break;
    const maxLand = Math.min(landCount, remainingAfterSpell);
    for (let l = minLand; l <= maxLand; l++) {
      const o = n - s - l;
      if (o < 0 || o > other) continue;
      const lnP =
        lnCombination(spellCopies, s) +
        lnCombination(landCount, l) +
        lnCombination(other, o) -
        lnDenom;
      p += Math.exp(lnP);
    }
  }
  return Math.min(1, p);
}

export interface CastabilityEntry {
  /** Turn number (1-indexed) */
  turn: number;
  /** Probability of having drawn at least one copy by this turn */
  probDrawn: number;
  /** Probability of having enough mana sources to cast the card by this turn */
  probMana: number;
  /** Combined probability: drawn AND mana available (joint, not independent) */
  probCastable: number;
}

/**
 * Per-turn castability table for a single card.
 *
 * @param deckSize     Deck size (usually 60)
 * @param copies       Copies of the card in the deck
 * @param cmc          Converted mana cost of the card
 * @param landCount    Number of lands in the deck
 * @param turns        How many turns to project (default 8)
 * @param onDraw       Whether the player is on the draw
 */
export function castabilityByTurn(
  deckSize: number,
  copies: number,
  cmc: number,
  landCount: number,
  turns = 8,
  onDraw = true
): CastabilityEntry[] {
  const result: CastabilityEntry[] = [];

  for (let turn = 1; turn <= turns; turn++) {
    const probDrawn = probByTurn(deckSize, copies, turn, onDraw);

    // Probability of having hit at least `cmc` land drops by turn N
    // = P(drawn >= cmc lands from landCount in deck by this turn)
    const drawSteps = onDraw ? turn : turn - 1;
    const cardsSeen = Math.min(7 + drawSteps, deckSize);
    const probMana =
      cmc === 0
        ? 1
        : hypergeometricCDF(deckSize, landCount, cardsSeen, cmc);

    // Joint P(drawn >= 1 copy AND drawn >= cmc lands) over the SAME cards seen.
    // Drawing the spell and drawing lands are not independent — they compete for
    // the same draws — so this is strictly <= probDrawn * probMana.
    const probCastable =
      cmc === 0
        ? probDrawn
        : probSpellAndLands(deckSize, copies, landCount, cardsSeen, 1, cmc);

    result.push({
      turn,
      probDrawn: parseFloat(probDrawn.toFixed(4)),
      probMana: parseFloat(probMana.toFixed(4)),
      probCastable: parseFloat(probCastable.toFixed(4)),
    });
  }

  return result;
}
