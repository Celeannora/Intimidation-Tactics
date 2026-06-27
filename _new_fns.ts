
// -- Tempo and card-advantage scoring (sonar.md Part 3) --

/**
 * Compute a tempo score for the deck (0-100).
 * Tempo = proactive pressure + interaction on the opponent turn.
 * Measures: low-curve threats, flash/instant density, cheap interaction.
 */
export function computeTempoScore(deck: DeckEntry[], archetype: Archetype): number {
  const mainboard = deck.filter(e => !e.card.typeLine.includes("Land));
  if (mainboard.length === 0) return 0;

