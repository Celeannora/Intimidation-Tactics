import type { CardRecord } from "./types";

export type CardRole =
  | "Beater"
  | "EvasiveThreat"
  | "Finisher"
  | "ValueEngine"
  | "Planeswalker"
  | "Removal"
  | "Counterspell"
  | "Bounce"
  | "Discard"
  | "BoardWipe"
  | "GraveyardHate"
  | "CardDraw"
  | "Tutor"
  | "Ramp"
  | "LandFetch"
  | "Lifegain"
  | "Protection";

const EVASION_KEYWORDS = ["Flying", "Menace", "Shadow", "Trample", "Skulk", "Unblockable", "Intimidate"];

export function assignRoles(card: CardRecord): CardRole[] {
  const roles: CardRole[] = [];
  const text = (card.oracleText ?? "").toLowerCase();
  const tl = card.typeLine;
  const kw: string[] = JSON.parse(card.keywordsJson || "[]");

  const isCreature = tl.includes("Creature");
  const isLand = tl.includes("Land");

  if (isLand) return [];

  // Planeswalker
  if (tl.includes("Planeswalker")) roles.push("Planeswalker");

  // Threat roles (creatures only)
  if (isCreature) {
    const power = parseInt(card.power ?? "0", 10);
    if (!isNaN(power) && power >= 3 && card.cmc <= 3) roles.push("Beater");
    if (EVASION_KEYWORDS.some(k => kw.includes(k))) roles.push("EvasiveThreat");
    if (card.cmc >= 5) roles.push("Finisher");
    if (
      text.includes("when") &&
      (text.includes("draw") || text.includes("enters") || text.includes("create"))
    ) roles.push("ValueEngine");
  }

  // Finisher for non-creatures
  if (!isCreature && (text.includes("win the game") || text.includes("each opponent loses") || (card.cmc >= 6 && text.includes("each")))) {
    roles.push("Finisher");
  }

  // Removal
  if (
    text.includes("destroy target") ||
    text.includes("exile target") ||
    (text.includes("deals") && text.includes("damage to target creature"))
  ) roles.push("Removal");

  // Counterspell
  if (text.includes("counter target spell") || text.includes("counter that spell")) roles.push("Counterspell");

  // Bounce
  if (text.includes("return target") && (text.includes("to its owner") || text.includes("to their owner"))) roles.push("Bounce");

  // Discard
  if (text.includes("target player discards") || text.includes("each player discards") || text.includes("each opponent discards") || text.includes("that player discards")) roles.push("Discard");

  // Board Wipe
  if (
    text.includes("destroy all") ||
    text.includes("exile all") ||
    (text.includes("each creature") && text.includes("-")) ||
    text.includes("all creatures get -")
  ) roles.push("BoardWipe");

  // Graveyard Hate
  if (
    text.includes("exile target card from a graveyard") ||
    text.includes("exile all cards from all graveyards") ||
    text.includes("exile all graveyards") ||
    text.includes("exile each graveyard")
  ) roles.push("GraveyardHate");

  // Card Draw
  if (
    text.includes("draw a card") ||
    text.includes("draw two cards") ||
    text.includes("draw three cards") ||
    text.includes("draw x cards") ||
    /draw \d+ cards/.test(text)
  ) roles.push("CardDraw");

  // Tutor
  if (text.includes("search your library for a card") || text.includes("search your library for an")) roles.push("Tutor");

  // Ramp
  if (
    text.includes("add {") ||
    (card.producedManaJson && card.producedManaJson !== "[]")
  ) roles.push("Ramp");

  // Land Fetch
  if (text.includes("search your library for a basic land") || text.includes("search your library for a land")) roles.push("LandFetch");

  // Lifegain
  if (text.includes("gain") && text.includes("life")) roles.push("Lifegain");

  // Protection
  if (
    kw.includes("Hexproof") ||
    kw.includes("Indestructible") ||
    kw.includes("Shroud") ||
    text.includes("ward") ||
    text.includes("protection from")
  ) roles.push("Protection");

  return [...new Set(roles)];
}

export function isThreat(roles: CardRole[]): boolean {
  return roles.some(r => ["Beater", "EvasiveThreat", "Finisher", "ValueEngine", "Planeswalker"].includes(r));
}

export function isInteraction(roles: CardRole[]): boolean {
  return roles.some(r => ["Removal", "Counterspell", "Bounce", "Discard", "BoardWipe", "GraveyardHate"].includes(r));
}

export function isSupport(roles: CardRole[]): boolean {
  return roles.some(r => ["CardDraw", "Tutor", "Ramp", "LandFetch", "Lifegain", "Protection"].includes(r));
}
