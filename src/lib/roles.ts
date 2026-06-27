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
  | "Protection"
  /** Sets up synergy triggers: mills, generates tokens, loots, fills graveyard. */
  | "Enabler"
  /** Rewards synergy triggers: scales with graveyard count, token count, sacrifice. */
  | "Payoff";

/**
 * Secondary oracle-text tags derived from keywords/text patterns.
 * Used by the keyword value matrix and the mythic-viability scorer.
 */
export type SecondaryCardTag =
  | "evasive"           // flying, menace, trample, shadow, skulk, unblockable, intimidate
  | "flexible"          // modal, adventure, split, saga with multiple modes
  | "two_for_one"       // replaces itself plus removes/creates another permanent
  | "graveyard_filling" // mills, discards own cards, or puts library cards to graveyard
  | "haste"             // has or grants haste
  | "lifelink"          // has or grants lifelink
  | "flash"             // has flash
  | "protection"        // hexproof, shroud, protection from, indestructible on body
  | "reach"             // has reach
  | "vigilance";        // has vigilance

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

  // Card Draw — handles "draw a card", "draws two cards", "draw 3 cards", etc.
  if (/\bdraws? (?:a|one|two|three|four|five|x|\d+) cards?/.test(text)) {
    roles.push("CardDraw");
  }

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

  // Enabler: sets up synergy triggers without being the payoff
  if (isEnabler(card)) roles.push("Enabler");

  // Payoff: scales or triggers from synergy state
  if (isPayoff(card)) roles.push("Payoff");

  return [...new Set(roles)];
}

// ── Secondary tag derivation ───────────────────────────────────────────────

/**
 * Derive oracle-text secondary tags for a card. These are additive descriptors
 * used by the keyword value matrix and mythic-viability scorer.
 */
export function deriveSecondaryTags(card: CardRecord): SecondaryCardTag[] {
  const tags: SecondaryCardTag[] = [];
  const text = (card.oracleText ?? "").toLowerCase();
  const kw: string[] = JSON.parse(card.keywordsJson || "[]");
  const kwLower = kw.map((k: string) => k.toLowerCase());

  // evasive
  const EVASIVE_KW = ["flying", "menace", "trample", "shadow", "skulk", "intimidate"];
  if (EVASIVE_KW.some(k => kwLower.includes(k)) || text.includes("can't be blocked")) {
    tags.push("evasive");
  }

  // flash
  if (kwLower.includes("flash") || text.includes("flash")) tags.push("flash");

  // haste
  if (kwLower.includes("haste") || text.includes("haste")) tags.push("haste");

  // lifelink
  if (kwLower.includes("lifelink") || text.includes("lifelink")) tags.push("lifelink");

  // reach
  if (kwLower.includes("reach") || text.includes("reach")) tags.push("reach");

  // vigilance
  if (kwLower.includes("vigilance") || text.includes("vigilance")) tags.push("vigilance");

  // protection (body-level — not removal)
  if (
    kwLower.includes("hexproof") ||
    kwLower.includes("shroud") ||
    kwLower.includes("indestructible") ||
    text.includes("protection from") ||
    text.includes("ward {")
  ) tags.push("protection");

  // graveyard_filling
  if (
    text.includes("mill ") ||
    text.includes("mills ") ||
    text.includes("put the top") ||
    text.includes("put cards from the top") ||
    (text.includes("discard") && text.includes("you")) ||
    text.includes("loot") ||
    text.includes("surveil")
  ) tags.push("graveyard_filling");

  // flexible (modal, adventure, split, saga choices)
  if (
    text.includes("choose one") ||
    text.includes("choose two") ||
    text.includes("choose any number") ||
    card.layout === "adventure" ||
    card.layout === "split" ||
    card.layout === "modal_dfc"
  ) tags.push("flexible");

  // two_for_one (replaces itself + removes/creates a permanent)
  const drawsCard = text.includes("draw a card") || text.includes("draw two cards");
  const removesOrCreates =
    text.includes("destroy target") ||
    text.includes("exile target") ||
    text.includes("create a") ||
    text.includes("create token");
  if (drawsCard && removesOrCreates) tags.push("two_for_one");
  // ETB that draws + does something else
  if (
    text.includes("when") &&
    text.includes("enters") &&
    drawsCard &&
    (text.includes("destroy") || text.includes("exile") || text.includes("create"))
  ) tags.push("two_for_one");

  return [...new Set(tags)];
}

// ── Role predicate helpers ─────────────────────────────────────────────────

/**
 * True if the card sets up a synergy *source* state without being the primary
 * payoff. Mills, loots, generates tokens/energy/counters as fuel, self-mills.
 */
export function isEnabler(card: CardRecord): boolean {
  const text = (card.oracleText ?? "").toLowerCase();
  const kw: string[] = JSON.parse(card.keywordsJson || "[]").map((k: string) => k.toLowerCase());

  // Graveyard enablers: mill, discard-self, put into graveyard effects
  if (
    text.includes("mill ") ||
    text.includes("mills ") ||
    text.includes("put the top") ||
    text.includes("put cards from the top") ||
    text.includes("surveil")
  ) return true;

  // Token generators (fuel for sacrifice/go-wide payoffs)
  if (
    (text.includes("create") && text.includes("token")) ||
    (text.includes("create") && /\d\/\d/.test(text))
  ) return true;

  // Energy / counter generation as fuel
  if (
    text.includes("get {e}") ||
    text.includes("gain {e}") ||
    text.includes("gets {e}")
  ) return true;

  // Looting (draw then discard or discard then draw)
  if (
    (text.includes("draw") && text.includes("discard") && text.includes("you")) ||
    kw.includes("cycling")
  ) return true;

  return false;
}

/**
 * True if the card is primarily a *payoff* that scales with or triggers from
 * a synergy axis state (graveyard count, token count, sacrifice, etc.).
 */
export function isPayoff(card: CardRecord): boolean {
  const text = (card.oracleText ?? "").toLowerCase();

  // Graveyard-counting payoffs (delirium, escape, delve, threshold)
  if (
    text.includes("for each card in your graveyard") ||
    text.includes("for each creature card in your graveyard") ||
    text.includes("cards in your graveyard") ||
    (text.includes("each creature in") && text.includes("graveyard")) ||
    text.includes("delirium") ||
    text.includes("threshold") ||
    text.includes("escape—") ||
    text.includes("delve")
  ) return true;

  // Token/go-wide payoffs
  if (
    text.includes("for each creature you control") ||
    text.includes("for each token") ||
    (text.includes("whenever") && text.includes("token") && text.includes("enter"))
  ) return true;

  // Sacrifice payoffs (aristocrats)
  if (
    text.includes("whenever you sacrifice") ||
    text.includes("whenever a creature you control dies") ||
    text.includes("whenever another creature you control dies")
  ) return true;

  // Energy payoff
  if (
    text.includes("pay {e}{e}") ||
    text.includes("pay {e}{e}{e}") ||
    text.includes("for each {e}")
  ) return true;

  // +1/+1 counter payoffs
  if (
    text.includes("for each +1/+1 counter") ||
    (text.includes("whenever") && text.includes("+1/+1 counter") && text.includes("placed"))
  ) return true;

  // Spellslinger payoffs (prowess, magecraft)
  if (
    text.includes("whenever you cast an instant or sorcery") ||
    text.includes("prowess") ||
    text.includes("magecraft") ||
    (text.includes("whenever you cast") && text.includes("instant or sorcery"))
  ) return true;

  return false;
}

// ── Aggregate predicates ───────────────────────────────────────────────────

export function isThreat(roles: CardRole[]): boolean {
  return roles.some(r => ["Beater", "EvasiveThreat", "Finisher", "ValueEngine", "Planeswalker"].includes(r));
}

export function isInteraction(roles: CardRole[]): boolean {
  return roles.some(r => ["Removal", "Counterspell", "Bounce", "Discard", "BoardWipe", "GraveyardHate"].includes(r));
}

export function isSupport(roles: CardRole[]): boolean {
  return roles.some(r => ["CardDraw", "Tutor", "Ramp", "LandFetch", "Lifegain", "Protection"].includes(r));
}
