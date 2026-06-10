import type { CardRecord } from "./types";
import { parsePips } from "./manaBase";

export interface ColorPip {
  color: "W" | "U" | "B" | "R" | "G";
  count: number;
  fraction: number;
}

export interface ColorDistribution {
  pips: ColorPip[];
  landSplit: Record<string, number>;
  sources: Record<string, number>;
}

const COLOR_NAMES: Record<string, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};

// Delegates to the canonical pip parser in manaBase so hybrid/Phyrexian costs
// are handled identically across the codebase (this module previously ignored
// hybrid pips via a {W} -only regex).
function countManaCostPips(manaCost: string | null): Record<string, number> {
  if (!manaCost) return {};
  const pips = parsePips(manaCost);
  const counts: Record<string, number> = {};
  for (const color of ["W", "U", "B", "R", "G"] as const) {
    if (pips[color] > 0) counts[color] = pips[color];
  }
  return counts;
}

export function computeColorDistribution(
  spells: CardRecord[],
  totalLands: number
): ColorDistribution {
  const totalPips: Record<string, number> = {};

  for (const card of spells) {
    const pips = countManaCostPips(card.manaCost);
    for (const [color, count] of Object.entries(pips)) {
      totalPips[color] = (totalPips[color] ?? 0) + count;
    }
  }

  const grandTotal = Object.values(totalPips).reduce((s, v) => s + v, 0);

  const pips: ColorPip[] = Object.entries(totalPips)
    .map(([color, count]) => ({
      color: color as ColorPip["color"],
      count,
      fraction: grandTotal > 0 ? count / grandTotal : 0,
    }))
    .sort((a, b) => b.count - a.count);

  const landSplit: Record<string, number> = {};
  const sources: Record<string, number> = {};
  for (const pip of pips) {
    const landCount = Math.round(pip.fraction * totalLands);
    landSplit[COLOR_NAMES[pip.color] ?? pip.color] = landCount;
    sources[pip.color] = landCount;
  }

  return { pips, landSplit, sources };
}
