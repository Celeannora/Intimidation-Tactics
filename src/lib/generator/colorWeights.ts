/**
 * colorWeights.ts — Color-pie affinity model
 *
 * Each role × color cell expresses how well that color performs that role
 * on the canonical Magic color pie. 1.0 = neutral, >1.0 = signature strength,
 * <1.0 = off-pie (color rarely does this well / efficiently).
 *
 * The per-card affinity is the MAX across the card's color identity for each
 * of its assigned roles, averaged across roles. Colorless cards default to 1.0.
 *
 * Used as a multiplicative factor on the role × power term in card scoring.
 */
import type { CardRecord, ManaColor } from "../types";
import { assignRoles, type CardRole } from "../roles";

type AffinityKey = CardRole | "default";

const TABLE: Record<AffinityKey, Record<ManaColor, number>> = {
  // Threats
  Beater:         { W: 0.85, U: 0.55, B: 0.95, R: 1.05, G: 1.45 },
  EvasiveThreat:  { W: 1.20, U: 1.25, B: 0.80, R: 0.65, G: 0.40 },
  Finisher:       { W: 1.20, U: 1.10, B: 1.20, R: 1.15, G: 1.30 },
  ValueEngine:    { W: 1.05, U: 1.20, B: 1.20, R: 0.95, G: 1.10 },
  Planeswalker:   { W: 1.00, U: 1.00, B: 1.00, R: 1.00, G: 1.00 },

  // Interaction
  Removal:        { W: 1.20, U: 0.70, B: 1.30, R: 1.05, G: 0.65 },
  Counterspell:   { W: 0.30, U: 1.50, B: 0.40, R: 0.30, G: 0.30 },
  Bounce:         { W: 0.70, U: 1.40, B: 0.50, R: 0.55, G: 0.45 },
  Discard:        { W: 0.40, U: 0.80, B: 1.40, R: 0.45, G: 0.30 },
  BoardWipe:      { W: 1.40, U: 0.95, B: 1.10, R: 1.00, G: 0.55 },
  GraveyardHate:  { W: 1.15, U: 0.85, B: 0.95, R: 0.85, G: 1.20 },

  // Support
  CardDraw:       { W: 0.65, U: 1.40, B: 1.15, R: 0.70, G: 0.85 },
  Tutor:          { W: 0.80, U: 1.05, B: 1.35, R: 0.50, G: 0.70 },
  Ramp:           { W: 0.55, U: 0.65, B: 0.75, R: 0.85, G: 1.45 },
  LandFetch:      { W: 0.70, U: 0.60, B: 0.60, R: 0.55, G: 1.45 },
  Lifegain:       { W: 1.30, U: 0.65, B: 1.05, R: 0.50, G: 1.05 },
  Protection:     { W: 1.30, U: 0.95, B: 0.65, R: 0.55, G: 1.15 },

  default:        { W: 1.00, U: 1.00, B: 1.00, R: 1.00, G: 1.00 },
};

const NEUTRAL = 1.0;

function parseIdentity(card: CardRecord): ManaColor[] {
  try {
    return JSON.parse(card.colorIdentityJson) as ManaColor[];
  } catch {
    return [];
  }
}

/**
 * Per-card color-pie affinity. Returns ~0.3–1.5.
 * Colorless cards return 1.0. Lands return 1.0 (no role contribution).
 */
export function colorAffinity(card: CardRecord, strength: number = 1.0): number {
  if (card.typeLine.includes("Land")) return NEUTRAL;
  const colors = parseIdentity(card);
  if (colors.length === 0) return NEUTRAL;
  const roles = assignRoles(card);
  const keys: AffinityKey[] = roles.length > 0 ? roles : ["default"];

  let sum = 0;
  let count = 0;
  for (const role of keys) {
    const row = TABLE[role] ?? TABLE.default;
    let best = -Infinity;
    for (const c of colors) {
      const v = row[c];
      if (v > best) best = v;
    }
    if (best === -Infinity) continue;
    sum += best;
    count += 1;
  }
  if (count === 0) return NEUTRAL;
  const raw = sum / count;

  // strength scales the deviation around 1.0. strength=0 disables; 1=default; 2=double.
  const s = Math.max(0, strength);
  return NEUTRAL + (raw - NEUTRAL) * s;
}

export interface ColorAffinityDetail {
  affinity: number;
  perRole: { role: AffinityKey; color: ManaColor | null; value: number }[];
}

export function colorAffinityDetail(card: CardRecord, strength: number = 1.0): ColorAffinityDetail {
  const colors = parseIdentity(card);
  const roles = assignRoles(card);
  const keys: AffinityKey[] = roles.length > 0 ? roles : ["default"];
  const perRole: ColorAffinityDetail["perRole"] = [];

  if (card.typeLine.includes("Land") || colors.length === 0) {
    return { affinity: NEUTRAL, perRole };
  }

  for (const role of keys) {
    const row = TABLE[role] ?? TABLE.default;
    let best = -Infinity;
    let bestColor: ManaColor | null = null;
    for (const c of colors) {
      const v = row[c];
      if (v > best) { best = v; bestColor = c; }
    }
    if (best !== -Infinity) perRole.push({ role, color: bestColor, value: best });
  }

  return { affinity: colorAffinity(card, strength), perRole };
}

/**
 * Human-readable reasons describing the color-pie fit for the most relevant role.
 */
export function generateColorPieReasons(card: CardRecord, strength: number = 1.0): string[] {
  if (card.typeLine.includes("Land")) return [];
  const detail = colorAffinityDetail(card, strength);
  if (detail.perRole.length === 0) return [];

  // Report the single most extreme contribution (furthest from 1.0).
  const ranked = [...detail.perRole].sort(
    (a, b) => Math.abs(b.value - NEUTRAL) - Math.abs(a.value - NEUTRAL)
  );
  const top = ranked[0];
  if (Math.abs(top.value - NEUTRAL) < 0.06) return [];
  const direction = top.value >= NEUTRAL ? "On-pie" : "Off-pie";
  const colorName = top.color ? COLOR_NAMES[top.color] : "Colorless";
  return [`${direction}: ${colorName} ${top.value >= NEUTRAL ? "excels at" : "rarely produces"} ${top.role} (×${top.value.toFixed(2)})`];
}

const COLOR_NAMES: Record<ManaColor, string> = {
  W: "White",
  U: "Blue",
  B: "Black",
  R: "Red",
  G: "Green",
};
