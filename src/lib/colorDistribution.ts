import type { CardRecord } from "./types";

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

function countManaCostPips(manaCost: string | null): Record<string, number> {
  if (!manaCost) return {};
  const counts: Record<string, number> = {};
  const matches = manaCost.matchAll(/\{([WUBRG])\}/g);
  for (const m of matches) {
    counts[m[1]] = (counts[m[1]] ?? 0) + 1;
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
