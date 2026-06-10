/**
 * Frank Karsten "How Many Sources Do You Need" lookup tables (2022 update,
 * 60-card Constructed). These tables answer: *how many sources of a color do
 * you need in a 60-card deck so that a card with a given colored-pip
 * requirement is castable on its natural turn ~90% of the time?*
 *
 * Reference: Frank Karsten, "How Many Sources Do You Need to Consistently Cast
 * Your Spells? A 2022 Update" (TCGplayer). The figures below are the 60-card
 * column for 1-, 2-, and 3-pip requirements, indexed by the turn on which you
 * want to cast the spell (≈ its mana value).
 *
 * The whole point of grounding the engine in this table — rather than the old
 * hardcoded 14/8/6 floors — is that the requirement is driven by *pip count*
 * and *turn*, not by how many colors the deck happens to play. A two-color deck
 * with a double-pip two-drop still needs ~20 sources of that color; a two-color
 * deck whose hardest card is a single off-color pip on turn 5 only needs ~10.
 */

export type Color = "W" | "U" | "B" | "R" | "G";

/**
 * sources[pips][turn] = colored sources needed in a 60-card deck to cast a card
 * with `pips` colored pips of one color on `turn` ~90% of the time.
 *
 * `turn` is clamped to the table's range; the natural turn for a card is
 * max(pips, ceil(mana value)).
 */
const KARSTEN_60: Record<number, Record<number, number>> = {
  // Single colored pip, e.g. {W}
  1: { 1: 14, 2: 13, 3: 12, 4: 11, 5: 10, 6: 9, 7: 9, 8: 8 },
  // Double colored pip, e.g. {W}{W}
  2: { 2: 20, 3: 18, 4: 16, 5: 15, 6: 14, 7: 13, 8: 12 },
  // Triple colored pip, e.g. {W}{W}{W}
  3: { 3: 23, 4: 22, 5: 20, 6: 19, 7: 18, 8: 17 },
};

/** Largest pip count the table covers; higher requirements clamp to this row. */
const MAX_PIPS = 3;

/**
 * Required colored sources for a single color, given how many pips of that
 * color a card needs and the turn you intend to cast it.
 *
 * - `pips` is rounded up (hybrid/Phyrexian half-pips round to the next whole
 *   pip, because you still need to be able to produce that color).
 * - `pips` of 4+ clamps to the triple-pip row (the hardest published figure).
 * - `turn` is clamped into each row's defined range.
 * - `pips <= 0` needs no sources.
 */
export function karstenSourcesNeeded(pips: number, turn: number): number {
  const p = Math.min(MAX_PIPS, Math.ceil(pips));
  if (p <= 0) return 0;

  const row = KARSTEN_60[p];
  const turns = Object.keys(row).map(Number);
  const minTurn = Math.min(...turns);
  const maxTurn = Math.max(...turns);
  const t = Math.max(minTurn, Math.min(maxTurn, Math.round(turn)));
  return row[t];
}

/**
 * The turn on which a card "wants" to be cast: the later of its mana value and
 * its heaviest single-color pip count (you cannot cast a {W}{W}{W} card before
 * turn 3 no matter how cheap its generic cost).
 */
export function naturalTurn(manaValue: number, maxPips: number): number {
  return Math.max(1, Math.ceil(manaValue), Math.ceil(maxPips));
}
