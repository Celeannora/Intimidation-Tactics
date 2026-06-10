import type { CardRecord } from "./types";
import type { DeckEntry } from "./legality";
import { BASIC_LAND_NAMES } from "./legality";
import type { ConstructedFormat } from "./formats";
import { isCardLegalInFormat } from "./formats";
import { karstenSourcesNeeded, naturalTurn, type Color } from "./karsten";
import { countLandSources } from "./landSources";
import { hypergeometricCDF } from "./hypergeometric";

// ─── Pip parsing ────────────────────────────────────────────────────────────

export interface PipCount {
  W: number;
  U: number;
  B: number;
  R: number;
  G: number;
  C: number; // generic / colorless
  total: number;
}

/**
 * Parse a Scryfall mana cost string like "{2}{W}{U}" or "{W/U}{W/U}"
 * and return weighted pip counts.
 * - Mono symbols  {W}         → 1.0 of that color
 * - Hybrid        {W/U}       → 0.5 W + 0.5 U
 * - Phyrexian     {W/P}       → 0.5 W (life can pay the other 0.5)
 * - Generic       {N}, {X}    → no colored contribution
 * - Snow          {S}         → ignored for color purposes
 */
export function parsePips(manaCost: string | null): PipCount {
  const counts: PipCount = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, total: 0 };
  if (!manaCost) return counts;

  const COLORS = new Set(["W", "U", "B", "R", "G"]);

  const symbols = manaCost.match(/\{[^}]+\}/g) ?? [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1); // strip { }
    const parts = inner.split("/");

    const colorParts = parts.filter(p => COLORS.has(p));
    if (colorParts.length === 0) continue;

    const weight = 1 / colorParts.length;
    const bag = counts as unknown as Record<string, number>;
    for (const c of colorParts) {
      bag[c] += weight;
    }
  }

  counts.total = counts.W + counts.U + counts.B + counts.R + counts.G;
  return counts;
}

// ─── Land count algorithm ────────────────────────────────────────────────────

export interface LandRecommendation {
  recommended: number;
  rangeMin: number;
  rangeMax: number;
  avgManaValue: number;
  adjustments: string[];
}

export function recommendLandCount(entries: DeckEntry[]): LandRecommendation {
  const nonlands = entries.filter(
    e => !e.card.typeLine.includes("Land")
  );

  const totalNonlandCards = nonlands.reduce((s, e) => s + e.quantity, 0);
  if (totalNonlandCards === 0) {
    return { recommended: 24, rangeMin: 18, rangeMax: 27, avgManaValue: 0, adjustments: [] };
  }

  const totalCmc = nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0);
  const avgMV = totalCmc / totalNonlandCards;

  // Base formula: 20 + round(AMV * 0.7) * 3, clamped 18-27
  let base = 20 + Math.round(avgMV * 0.7) * 3;
  base = Math.max(18, Math.min(27, base));

  const adjustments: string[] = [];

  // Mana dorks / ramp spells reduce land recommendation
  const rampCount = nonlands
    .filter(e => {
      const text = (e.card.oracleText ?? "").toLowerCase();
      return (
        text.includes("add {")
        || text.includes("search your library for a basic land")
        || (e.card.producedManaJson && e.card.producedManaJson !== "[]")
      );
    })
    .reduce((s, e) => s + e.quantity, 0);

  if (rampCount > 0) {
    const reduction = Math.round(rampCount * 0.5);
    base -= reduction;
    adjustments.push(`-${reduction} for ${rampCount} ramp/mana-dork spell${rampCount > 1 ? "s" : ""}`);
  }

  // Card draw density: -1 per 4 draw spells
  const drawCount = nonlands
    .filter(e => {
      const text = (e.card.oracleText ?? "").toLowerCase();
      return text.includes("draw a card") || text.includes("draw two") || text.includes("draw three");
    })
    .reduce((s, e) => s + e.quantity, 0);

  if (drawCount >= 4) {
    const reduction = Math.floor(drawCount / 4);
    base -= reduction;
    adjustments.push(`-${reduction} for high draw density (${drawCount} draw spells)`);
  }

  // Modal DFC lands count as 0.5 land
  const mdfcLands = entries
    .filter(e => {
      const layout = e.card.layout;
      return (
        (layout === "modal_dfc" || layout === "transform")
        && e.card.typeLine.includes("Land")
      );
    })
    .reduce((s, e) => s + e.quantity, 0);

  if (mdfcLands > 0) {
    const mdfcCredit = Math.floor(mdfcLands * 0.5);
    if (mdfcCredit > 0) {
      base -= mdfcCredit;
      adjustments.push(`-${mdfcCredit} for ${mdfcLands} modal DFC land${mdfcLands > 1 ? "s" : ""}`);
    }
  }

  base = Math.max(18, Math.min(27, base));

  return {
    recommended: base,
    rangeMin: Math.max(18, base - 1),
    rangeMax: Math.min(27, base + 1),
    avgManaValue: Math.round(avgMV * 100) / 100,
    adjustments
  };
}

// ─── Color distribution algorithm ────────────────────────────────────────────

export interface ColorSourceRecommendation {
  color: Color;
  /** Total weighted pips of this color across all nonland cards (pip *share* input). */
  pips: number;
  /** This color's share of all colored pips (used for UI bar widths). */
  ratio: number;
  /**
   * Karsten-correct minimum sources of this color the deck needs, based on the
   * most demanding card of that color (its pip count at its natural turn).
   */
  recommendedSources: number;
  /** Pip count of the single most demanding card of this color (1, 2, 3, …). */
  requiredPips: number;
  /** Natural turn of the card that drives {@link recommendedSources}. */
  requiredByTurn: number;
  /** Actual weighted sources of this color the deck currently runs. */
  actualSources: number;
  /** True when the deck's actual sources fall short of the Karsten requirement. */
  criticallyUndersourced: boolean;
}

/**
 * Per-color source recommendations driven by Frank Karsten's 2022 tables.
 *
 * Unlike the old proportional heuristic (which set a flat 14/8/6 floor by color
 * count and never looked at the deck's actual lands), this:
 *   - sizes each color's requirement by the *hardest* card of that color — its
 *     colored-pip count at its natural turn (a {W}{W} two-drop needs ~20 W
 *     sources regardless of how many colors the deck plays);
 *   - counts the deck's *actual* typed-land and MDFC sources (see
 *     {@link countLandSources}) and flags undersourcing only when the real
 *     count falls short of the Karsten requirement.
 */
export function recommendColorSources(
  entries: DeckEntry[],
  _totalLands: number
): ColorSourceRecommendation[] {
  const nonlands = entries.filter(e => !e.card.typeLine.includes("Land"));

  const totalPips: PipCount = { W: 0, U: 0, B: 0, R: 0, G: 0, C: 0, total: 0 };
  // Track, per color, the most demanding requirement: the highest single-card
  // pip count and the natural turn of the card imposing it.
  const demand: Record<Color, { pips: number; turn: number }> = {
    W: { pips: 0, turn: 0 },
    U: { pips: 0, turn: 0 },
    B: { pips: 0, turn: 0 },
    R: { pips: 0, turn: 0 },
    G: { pips: 0, turn: 0 },
  };

  const COLORS: Color[] = ["W", "U", "B", "R", "G"];

  for (const entry of nonlands) {
    const pips = parsePips(entry.card.manaCost);
    const qty = entry.quantity;
    for (const c of COLORS) {
      const colorPips = pips[c];
      totalPips[c] += colorPips * qty;
      if (colorPips <= 0) continue;
      // Demand is per single card, not multiplied by copies.
      const cardPips = Math.ceil(colorPips);
      const turn = naturalTurn(entry.card.cmc, cardPips);
      const current = demand[c];
      // Prefer the higher pip requirement; for equal pips, the earlier turn is
      // the more demanding (needs more sources sooner).
      if (
        cardPips > current.pips ||
        (cardPips === current.pips && (current.turn === 0 || turn < current.turn))
      ) {
        demand[c] = { pips: cardPips, turn };
      }
    }
    totalPips.total += pips.total * qty;
  }

  const activeColors = COLORS.filter(c => totalPips[c] > 0);
  const actual = countLandSources(entries);

  return activeColors.map(color => {
    const ratio = totalPips.total > 0 ? totalPips[color] / totalPips.total : 0;
    const { pips: requiredPips, turn: requiredByTurn } = demand[color];
    const recommendedSources = karstenSourcesNeeded(requiredPips, requiredByTurn);
    const actualSources = Math.round(actual[color] * 10) / 10;
    return {
      color,
      pips: Math.round(totalPips[color] * 10) / 10,
      ratio: Math.round(ratio * 1000) / 1000,
      recommendedSources,
      requiredPips,
      requiredByTurn,
      actualSources,
      criticallyUndersourced: actualSources < recommendedSources,
    };
  });
}

// ─── Dual land recommendation ─────────────────────────────────────────────────

export type DualLandTier = 1 | 2 | 3;

export interface DualLandSuggestion {
  card: CardRecord;
  tier: DualLandTier;
  tierLabel: string;
  quantity: number;
}

const ENTERS_TAPPED_PATTERNS = [
  "enters tapped",
  "enters the battlefield tapped"
];

const CONDITIONAL_UNTAPPED_PATTERNS = [
  "unless",
  "as long as",
  "if you control",
  "if a player controls",
  "reveal"
];

function getDualTier(card: CardRecord): DualLandTier {
  const text = (card.oracleText ?? "").toLowerCase();

  const tapped = ENTERS_TAPPED_PATTERNS.some(p => text.includes(p));
  if (tapped) return 3;

  const conditional = CONDITIONAL_UNTAPPED_PATTERNS.some(p => text.includes(p));
  if (conditional) return 2;

  return 1;
}

export function recommendDualLands(
  allCards: CardRecord[],
  activeColors: Array<"W" | "U" | "B" | "R" | "G">,
  _totalLands: number,
  format?: ConstructedFormat
): DualLandSuggestion[] {
  if (activeColors.length < 2) return [];

  const colorSet = new Set(activeColors);

  const TIER_LABELS: Record<DualLandTier, string> = {
    1: "Enters untapped (unconditional)",
    2: "Enters untapped (conditional)",
    3: "Enters tapped"
  };

  const duals = allCards.filter(card => {
    if (!card.typeLine.includes("Land")) return false;
    if (BASIC_LAND_NAMES.has(card.name)) return false;
    if (!isCardLegalInFormat(card, format)) return false;

    const ci: string[] = JSON.parse(card.colorIdentityJson || "[]");
    // Must cover exactly 2 of our active colors (and only those colors)
    const relevantColors = ci.filter(c => colorSet.has(c as "W" | "U" | "B" | "R" | "G"));
    return relevantColors.length >= 2 && ci.length <= activeColors.length;
  });

  // Deduplicate by oracleId, pick best tier per oracle
  const byOracle = new Map<string, CardRecord>();
  for (const card of duals) {
    const existing = byOracle.get(card.oracleId);
    if (!existing || getDualTier(card) < getDualTier(existing)) {
      byOracle.set(card.oracleId, card);
    }
  }

  const sorted = [...byOracle.values()].sort((a, b) => {
    const tierDiff = getDualTier(a) - getDualTier(b);
    if (tierDiff !== 0) return tierDiff;
    return (a.edhrecRank ?? 99999) - (b.edhrecRank ?? 99999);
  });

  // Suggest quantity based on tier and total land budget
  return sorted.slice(0, 12).map(card => {
    const tier = getDualTier(card);
    const quantity = tier === 1 ? 4 : tier === 2 ? 3 : 2;
    return {
      card,
      tier,
      tierLabel: TIER_LABELS[tier],
      quantity
    };
  });
}

// ─── Mana curve ───────────────────────────────────────────────────────────────

export interface CurveSlot {
  mv: number;
  total: number;
  creatures: number;
  instants: number;
  sorceries: number;
  enchantments: number;
  artifacts: number;
  planeswalkers: number;
  other: number;
}

export function buildManaCurve(entries: DeckEntry[]): CurveSlot[] {
  const nonlands = entries.filter(e => !e.card.typeLine.includes("Land"));

  const slotMap = new Map<number, CurveSlot>();

  const getSlot = (mv: number): CurveSlot => {
    const key = Math.min(mv, 7);
    if (!slotMap.has(key)) {
      slotMap.set(key, { mv: key, total: 0, creatures: 0, instants: 0, sorceries: 0, enchantments: 0, artifacts: 0, planeswalkers: 0, other: 0 });
    }
    return slotMap.get(key)!;
  };

  for (const entry of nonlands) {
    const slot = getSlot(entry.card.cmc);
    const qty = entry.quantity;
    const tl = entry.card.typeLine;

    slot.total += qty;
    if (tl.includes("Creature")) slot.creatures += qty;
    else if (tl.includes("Instant")) slot.instants += qty;
    else if (tl.includes("Sorcery")) slot.sorceries += qty;
    else if (tl.includes("Enchantment")) slot.enchantments += qty;
    else if (tl.includes("Artifact")) slot.artifacts += qty;
    else if (tl.includes("Planeswalker")) slot.planeswalkers += qty;
    else slot.other += qty;
  }

  // Ensure all slots 0-7 exist
  for (let mv = 0; mv <= 7; mv++) getSlot(mv);

  return [...slotMap.entries()]
    .sort(([a], [b]) => a - b)
    .map(([, slot]) => slot);
}

export type ArchetypeCurveProfile = "aggro" | "midrange" | "control" | "combo";

export const IDEAL_CURVES: Record<ArchetypeCurveProfile, number[]> = {
  // index = MV (0-7+), value = % of nonland cards at that MV
  aggro:    [0.05, 0.25, 0.35, 0.20, 0.10, 0.03, 0.01, 0.01],
  midrange: [0.03, 0.10, 0.20, 0.30, 0.20, 0.10, 0.05, 0.02],
  control:  [0.02, 0.05, 0.15, 0.20, 0.20, 0.20, 0.10, 0.08],
  combo:    [0.05, 0.15, 0.25, 0.25, 0.15, 0.10, 0.03, 0.02]
};

// ─── Turn-by-turn castability (hypergeometric approximation) ─────────────────

/**
 * Hypergeometric probability of drawing at least one copy of a card by turn T
 * on the draw (7 + T cards seen).
 *
 * Delegates to the canonical, overflow-safe log-factorial engine in
 * {@link ./hypergeometric} rather than re-deriving combinations here (the old
 * local `combinations`/`hypergeometric` pair overflowed for large N).
 */
export function probAtLeastOneByTurn(
  deckSize: number,
  copiesInDeck: number,
  turn: number // 1 = see 8 cards on draw, etc.
): number {
  const cardsSeen = Math.min(7 + turn, deckSize); // 7 opening + 1 per turn on draw
  const p = hypergeometricCDF(deckSize, copiesInDeck, cardsSeen, 1);
  return Math.round(p * 1000) / 1000;
}

export interface CastabilityWarning {
  cardName: string;
  cmc: number;
  copiesInDeck: number;
  probByNaturalTurn: number;
  naturalTurn: number;
  warning: boolean;
}

/**
 * For each nonland in the deck, compute probability of having it castable
 * by its "natural turn" (= CMC, assuming one land per turn).
 * Flag cards below 60% probability as a warning.
 */
export function computeCastabilityWarnings(
  entries: DeckEntry[],
  deckSize: number
): CastabilityWarning[] {
  const warnings: CastabilityWarning[] = [];

  const nonlands = entries.filter(e => !e.card.typeLine.includes("Land"));

  for (const entry of nonlands) {
    const cmc = entry.card.cmc;
    const naturalTurn = Math.max(1, Math.ceil(cmc));
    const prob = probAtLeastOneByTurn(deckSize, entry.quantity, naturalTurn);

    if (prob < 0.6 && cmc >= 3) {
      warnings.push({
        cardName: entry.card.name,
        cmc,
        copiesInDeck: entry.quantity,
        probByNaturalTurn: prob,
        naturalTurn,
        warning: true
      });
    }
  }

  return warnings.sort((a, b) => a.probByNaturalTurn - b.probByNaturalTurn);
}
