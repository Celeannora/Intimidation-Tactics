/**
 * Canonical "how many sources of each color does this deck actually run"
 * counter. This is the half of the mana-base system that the old code never
 * had: typed dual / triome lands and MDFC land faces are counted as sources
 * for *each* color they can produce, so the Karsten thresholds in
 * {@link ./karsten} can be checked against what the deck really plays.
 *
 * A land is a source for a color C if any of the following say so (in order of
 * preference):
 *   1. Scryfall `produced_mana` (producedManaJson) contains C — the ground
 *      truth for what a land can tap for, including fetch-ish / utility lands.
 *   2. Its color identity (colorIdentityJson) contains C — fallback for rows
 *      that predate produced_mana being stored.
 *
 * MDFC / transform cards whose *back* (or front) face is a land are counted at
 * a fractional weight, per Karsten's treatment of modal lands: 0.74 of a source
 * if the land face enters untapped, 0.38 if it enters tapped. They are real
 * fixing but not as reliable as a dedicated land slot.
 */

import type { CardRecord } from "./types";
import type { DeckEntry } from "./legality";
import type { Color } from "./karsten";

export const MDFC_UNTAPPED_WEIGHT = 0.74;
export const MDFC_TAPPED_WEIGHT = 0.38;

const COLORS: Color[] = ["W", "U", "B", "R", "G"];

function parseJsonArray(json: string | null | undefined): string[] {
  if (!json) return [];
  try {
    const parsed = JSON.parse(json);
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function isLand(typeLine: string | null | undefined): boolean {
  return !!typeLine && typeLine.toLowerCase().includes("land");
}

/** Colors a card can tap for: produced_mana if present, else color identity. */
function producedColors(card: CardRecord): Color[] {
  const produced = parseJsonArray(card.producedManaJson).filter((c): c is Color =>
    COLORS.includes(c as Color)
  );
  if (produced.length > 0) return produced;
  return parseJsonArray(card.colorIdentityJson).filter((c): c is Color =>
    COLORS.includes(c as Color)
  );
}

/**
 * Does a (possibly MDFC) card have a land face, and if so does that face have a
 * land type in its own type line? Returns the land-face type line if found.
 */
function landFaceTypeLine(card: CardRecord): string | null {
  if (isLand(card.typeLine)) return card.typeLine;
  const faces = parseJsonArray(card.cardFacesJson) as unknown as Array<{
    type_line?: string;
    oracle_text?: string;
  }>;
  for (const face of faces) {
    if (isLand(face?.type_line)) return face!.type_line!;
  }
  return null;
}

/** Whether a land (or land face) enters tapped, by oracle-text heuristic. */
function entersTapped(card: CardRecord): boolean {
  const texts: string[] = [];
  if (card.oracleText) texts.push(card.oracleText);
  const faces = parseJsonArray(card.cardFacesJson) as unknown as Array<{
    type_line?: string;
    oracle_text?: string;
  }>;
  for (const face of faces) {
    if (isLand(face?.type_line) && face?.oracle_text) texts.push(face.oracle_text);
  }
  const blob = texts.join(" ").toLowerCase();
  if (!blob.includes("tapped")) return false;
  // "enters the battlefield tapped" / "enters tapped" — treat conditional
  // untapped duals ("unless you control…") as untapped for source purposes,
  // since they are usually untapped in the relevant early turns.
  if (blob.includes("unless") || blob.includes("if you control")) return false;
  return true;
}

/**
 * The source weight a single copy of a card contributes to each color it
 * produces. Pure lands = 1.0; MDFC/transform land faces = 0.74 (untapped) or
 * 0.38 (tapped); non-lands = 0.
 */
export function landSourceWeight(card: CardRecord): number {
  if (isLand(card.typeLine)) return 1;
  // Not a pure land — does it have a land face (MDFC / transform)?
  if (landFaceTypeLine(card)) {
    return entersTapped(card) ? MDFC_TAPPED_WEIGHT : MDFC_UNTAPPED_WEIGHT;
  }
  return 0;
}

/**
 * Count the deck's color sources for every color, summing per-copy weights.
 * Returns a fractional source count per color (lands contribute 1 each, MDFC
 * land faces a fraction). Callers typically compare these against
 * {@link karstenSourcesNeeded}.
 */
export function countLandSources(entries: DeckEntry[]): Record<Color, number> {
  const sources: Record<Color, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const entry of entries) {
    const card = entry.card;
    const weight = landSourceWeight(card);
    if (weight === 0) continue;
    for (const color of producedColors(card)) {
      sources[color] += weight * entry.quantity;
    }
  }
  return sources;
}
