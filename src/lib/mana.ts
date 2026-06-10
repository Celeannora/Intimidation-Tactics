// Mana pip parsing, land count recommendation, colour source distribution

export type ColourKey = "W" | "U" | "B" | "R" | "G";
export type PipCount = Partial<Record<ColourKey, number>> & { generic?: number };

const COLOUR_SYMBOLS: ColourKey[] = ["W", "U", "B", "R", "G"];

/**
 * Parses a Scryfall mana cost string into a pip count.
 * Handles generic ({1},{2},…,{X},{C}), mono-colour ({W},{U},{B},{R},{G}),
 * hybrid ({W/U},{W/P}), and Phyrexian ({W/P}) symbols.
 */
export function parseManaPips(manaCost: string | null | undefined): PipCount {
  const result: PipCount = {};

  if (!manaCost) return result;

  // tokenise into individual symbols: {X}, {W/U}, {2}, etc.
  const tokens = manaCost.match(/\{[^}]+\}/g) ?? [];

  for (const token of tokens) {
    const inner = token.slice(1, -1); // strip { }

    // Hybrid symbols: W/U, W/P, etc.
    if (inner.includes("/")) {
      const parts = inner.split("/");
      const colourParts = parts.filter(p => COLOUR_SYMBOLS.includes(p as ColourKey));
      if (colourParts.length === 2) {
        // Standard hybrid — 0.5 each
        for (const c of colourParts) {
          const key = c as ColourKey;
          result[key] = (result[key] ?? 0) + 0.5;
        }
      } else if (colourParts.length === 1) {
        // Phyrexian — 0.5 of that colour
        const key = colourParts[0] as ColourKey;
        result[key] = (result[key] ?? 0) + 0.5;
      }
      continue;
    }

    // Mono-colour
    if (COLOUR_SYMBOLS.includes(inner as ColourKey)) {
      const key = inner as ColourKey;
      result[key] = (result[key] ?? 0) + 1;
      continue;
    }

    // X, C, numeric — generic (non-colour)
    if (inner === "X" || inner === "C" || /^\d+$/.test(inner)) {
      result.generic = (result.generic ?? 0) + (inner === "X" ? 0 : parseInt(inner, 10) || 0);
    }
  }

  return result;
}

/**
 * Recommended land count using the linear regression formula from the spec:
 *   lands = 20 + round(AMV * 0.7) * 3, clamped [18, 27]
 * Each mana dork reduces by 0.5; each 4 draw spells reduce by 1.
 */
export function recommendedLandCount(
  avgManaValue: number,
  manaDorks: number,
  drawSpells: number
): number {
  // Heuristic: 16 + 2.5 * AMV gives a sensible spread.
  // AMV 0.8 → 18 (clamped); AMV 5.0 → 28 → 27 (clamped); AMV 2.5 → ~22.
  const base = 16 + 2.5 * avgManaValue;
  const dorkAdjust = manaDorks * 0.5;
  const drawAdjust = Math.floor(drawSpells / 4);
  const raw = base - dorkAdjust - drawAdjust;
  return Math.max(18, Math.min(27, Math.round(raw)));
}

/**
 * Distributes totalLands across required colours proportionally to pip counts.
 * Rounds each colour, then adjusts the largest bucket to fix rounding drift.
 */
export function colorSourceDistribution(
  pips: PipCount,
  totalLands: number
): Partial<Record<ColourKey, number>> {
  const colourPips = COLOUR_SYMBOLS.reduce((acc, c) => {
    if (pips[c]) acc[c] = pips[c]!;
    return acc;
  }, {} as Record<ColourKey, number>);

  const totalPips = Object.values(colourPips).reduce((a, b) => a + b, 0);
  if (totalPips === 0) return {};

  const result: Partial<Record<ColourKey, number>> = {};
  let allocated = 0;

  for (const [colour, count] of Object.entries(colourPips) as [ColourKey, number][]) {
    const share = Math.round((count / totalPips) * totalLands);
    result[colour] = share;
    allocated += share;
  }

  // Fix rounding drift
  const drift = totalLands - allocated;
  if (drift !== 0) {
    const largest = (Object.entries(result) as [ColourKey, number][])
      .sort((a, b) => b[1] - a[1])[0][0];
    result[largest] = (result[largest] ?? 0) + drift;
  }

  return result;
}
