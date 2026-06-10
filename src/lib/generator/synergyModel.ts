/**
 * synergyModel.ts — Directional source→payoff synergy model
 *
 * Classifies each card's mechanical role as:
 *   ENGINE   – produces the core resource both sides need (e.g. creature that does multiple things)
 *   ENABLER  – supplies inputs to payoffs (token producer, lifegain source, discard outlet)
 *   PAYOFF   – rewards the strategy (scales with life gained, creatures dying, etc.)
 *   SUPPORT  – draw/tutor/ramp that accelerates the plan without being axis-specific
 *   INTERACT – removal/counterspells/wipes
 *
 * Directional pattern pairs (SOURCE → PAYOFF) are keyed by mechanic axis name.
 * Each card is profiled with:
 *   - sourceTags: axes this card PRODUCES
 *   - payoffTags: axes this card BENEFITS FROM
 *   - broadTags:  general mechanics present (keyword-level)
 */

import type { CardRecord } from "../types";
import type { TribalSupportOptions } from "./types";

export const COMMON_TRIBES = [
  "Human",
  "Vampire",
  "Zombie",
  "Elf",
  "Goblin",
  "Knight",
  "Wizard",
  "Angel",
  "Dragon",
  "Spirit",
  "Cat",
  "Rat",
  "Bird",
  "Cleric",
  "Warrior",
  "Soldier",
  "Rogue",
  "Dinosaur",
  "Merfolk",
  "Faerie",
  "Phyrexian",
  "Demon",
  "Elemental",
  "Beast",
] as const;

// ── Enums ────────────────────────────────────────────────────────────────────

export type EngineRole = "engine" | "enabler" | "payoff" | "support" | "interact";

/**
 * Mechanic axes drive source→payoff synergy detection. The subset of these that
 * are user-facing strategy themes is enumerated canonically in
 * {@link ../archetypeVocab.THEME_IDS}; the remaining axes (`draw`, `etb`,
 * `selfMill`) are internal-only synergy primitives with no UI exposure.
 */
export type MechanicAxis =
  // ── User-facing themes (must stay in sync with THEME_IDS) ──
  | "lifegain"
  | "mill"
  | "tokens"
  | "sacrifice"
  | "reanimator"
  | "graveyard"
  | "spellslinger"
  | "burn"
  | "typal"
  | "enchantress"
  | "artifacts"
  | "counters"
  | "blink"
  | "landfall"
  | "domain"
  | "energy"
  | "vehicles"
  | "stax"
  | "discard"
  | "storm"
  // ── Internal-only synergy primitives (not surfaced as themes) ──
  | "draw"
  | "etb"
  | "selfMill";

// ── Directional pattern tables ────────────────────────────────────────────────

/** Regular expressions that detect SOURCE cards for each axis. */
const SOURCE_PATTERNS: Record<MechanicAxis, RegExp[]> = {
  lifegain: [
    /\blifelink\b/i,
    /you gain \d+ life/i,
    /gains? \d+ life/i,
    /gain life equal/i,
    /create a food token/i,
    /sacrifice.*food.*gain/i,
  ],
  tokens: [
    /create[sd]? [a2-9\d]/i,
    /put[s]? .{0,20}token/i,
    /creates? a .{0,30}token/i,
  ],
  sacrifice: [
    /sacrifice (a|another|any number) (creature|permanent|artifact)/i,
    /: sacrifice/i,
    /\{[^}]+\}(?:,)? sacrifice (a|another)/i,
  ],
  graveyard: [
    /\bflashback\b/i,
    /\bescape\b/i,
    /\bembalm\b/i,
    /\brecur\b/i,
    /return.{0,40}from (your |a |their )?graveyard/i,
  ],
  draw: [
    /draw[s]? (a|[2-9]|\d+) card/i,
    /you may draw/i,
    /draw cards? equal/i,
  ],
  etb: [
    /when .{0,60} enters(?: the battlefield)?/i,
  ],
  counters: [
    /put[s]? [a\d].{0,10}\+1\/\+1 counter/i,
    /proliferate/i,
    /\bbolster\b/i,
    /\badapt\b/i,
    /\bevolve\b/i,
  ],
  discard: [
    /discard[s]? (a|[2-9]|\d+|that many|that) cards?/i,
    /each player discards/i,
    /each opponent discards/i,
    /target player discards/i,
    /target opponent discards/i,
    /you may discard/i,
    /discard a card:?/i,
    /draw .{0,30} discard/i,
    /discard .{0,30} draw/i,
  ],
  selfMill: [
    /(?:^|[^\w])(?!(?:target opponent|target player|each opponent|each player)\s+mills?)(you |self-)?mills? (?:a|x|\d+|one|two|three|four|five|six|seven|eight|nine|ten|that many) cards?/i,
    /put[s]? .{0,20}top .{0,20}(?:cards? )?of your library .{0,20}into your graveyard/i,
    /surveil \d+/i,
  ],
  mill: [
    /target (?:opponent|player) mills?/i,
    /each opponent mills?/i,
    /(?:target (?:opponent|player)|each opponent).{0,80}put[s]? .{0,30}top .{0,40}(?:cards? )?of .{0,30}library .{0,40}graveyard/i,
  ],
  enchantress: [
    /enchant (creature|permanent|player|land)/i,
    /create.*enchantment token/i,
  ],
  blink: [
    /exile (target|another|it).{0,60}(?:then )?return.{0,60}battlefield/i,
    /\bflicker\b/i,
    /phase out/i,
  ],
  typal: [
    /\b(human|humans|elf|elves|goblin|goblins|vampire|vampires|zombie|zombies|merfolk|dragon|dragons|angel|angels|warrior|warriors|wizard|wizards|knight|knights|rat|rats|spirit|spirits|bird|birds|cat|cats|cleric|clerics|soldier|soldiers|rogue|rogues|dinosaur|dinosaurs|faerie|faeries|phyrexian|phyrexians|demon|demons|elemental|elementals|beast|beasts)\b/i,
  ],
  spellslinger: [
    /\bprowess\b/i,
    /\bmagecraft\b/i,
    /whenever you cast (an instant|a sorcery|a spell)/i,
  ],
  reanimator: [
    /return.{0,40}creature card.{0,40}from (your |a |their )?graveyard.{0,40}(to the battlefield|onto the battlefield)/i,
    /put.{0,40}creature card.{0,40}from.{0,20}graveyard.{0,20}onto the battlefield/i,
    /\breanimate\b/i,
  ],
  burn: [
    /deals \d+ damage to (any target|target player|each opponent|that player)/i,
    /deals damage to (any target|target player|each opponent) equal/i,
  ],
  artifacts: [
    /\baffinity for artifacts\b/i,
    /\baffinity\b/i,
    /create[sd]? .{0,20}(treasure|clue|food|map|blood|powerstone|gold) token/i,
    /\bartifact creature\b/i,
  ],
  landfall: [
    /\blandfall\b/i,
    /whenever a land enters/i,
    /whenever a land you control enters/i,
    /whenever .{0,30} land enters the battlefield under your control/i,
  ],
  domain: [
    /basic land types? among lands you control/i,
    /\bdomain\b/i,
  ],
  energy: [
    /you get (?:\{e\}|one or more \{e\}|that much \{e\})/i,
    /\{e\}\{e\}/i,
    /pay (?:\{e\}|one \{e\}|.{0,12}\{e\})/i,
  ],
  vehicles: [
    /\bcrew \d+\b/i,
    /artifact .{0,10}vehicle/i,
    /\bvehicle\b/i,
  ],
  stax: [
    /(?:each |an? )?opponent[s']*.{0,40}can't/i,
    /spells? cost \{?\d?\}? .{0,10}more to cast/i,
    /players? can't/i,
    /\btax\b/i,
  ],
  storm: [
    /\bstorm\b/i,
    /copy (?:that|target) (?:instant or sorcery|spell)/i,
    /for each spell .{0,20}cast this turn/i,
  ],
};

/** Regular expressions that detect PAYOFF cards for each axis. */
const PAYOFF_PATTERNS: Record<MechanicAxis, RegExp[]> = {
  lifegain: [
    /whenever you gain life/i,
    /each time you gain life/i,
    /whenever (a player |you |)gains? life/i,
    /if you (?:have |)gained life/i,
    /for each (?:1 |one )?life you (?:gained|gain)/i,
  ],
  tokens: [
    /whenever (?:a |another |you create a? )token/i,
    /for each token/i,
    /tokens (?:you control )?get/i,
    /whenever you create/i,
  ],
  sacrifice: [
    /whenever .{0,80} (?:a|another|or another) creature (?:you control )?dies/i,
    /whenever you sacrifice (?:a|another)/i,
    /each creature that dies/i,
    /whenever a creature dies/i,
  ],
  graveyard: [
    /whenever .{0,30} is put into .{0,20}graveyard/i,
    /for each card in (?:your |a |their )?graveyard/i,
    /from your graveyard/i,
  ],
  draw: [
    /whenever you draw/i,
    /each time you draw/i,
    /if you (?:have |)drawn/i,
    /for each card (?:drawn|you draw)/i,
  ],
  etb: [
    /whenever (?:a |another )creature enters/i,
    /whenever .{0,30} enters the battlefield under your control/i,
    /each time a creature enters/i,
  ],
  counters: [
    /for each \+1\/\+1 counter/i,
    /whenever .{0,20}\+1\/\+1 counter (?:is )?placed/i,
    /number of \+1\/\+1 counters/i,
    /with (?:a |one or more )?\+1\/\+1 counter/i,
  ],
  discard: [
    /whenever (?:you |a player |an opponent )discards/i,
    /opponent discards/i,
    /for each card discarded/i,
  ],
  selfMill: [
    /for each card in your graveyard/i,
    /number of cards in your graveyard/i,
    /cards? in your graveyard/i,
    /from your graveyard/i,
  ],
  mill: [
    /whenever (?:an opponent|one or more opponents).{0,40}mill/i,
    /whenever .{0,20}card .{0,20}put into (?:an opponent's|their) graveyard from/i,
    /for each card in (?:their|an opponent'?s|opponents'?) graveyard/i,
  ],
  enchantress: [
    /whenever you cast an enchantment/i,
    /whenever an enchantment enters/i,
    /\bconstellation\b/i,
    /for each enchantment you control/i,
  ],
  blink: [
    /whenever .{0,40} enters the battlefield/i,
    /when .{0,40} enters the battlefield/i,
  ],
  typal: [
    /other .{0,20}(?:humans?|elves?|goblins?|vampires?|zombies?|merfolk|dragons?|angels?|warriors?|wizards?|knights?|rats?|spirits?|birds?|cats?|clerics?|soldiers?|rogues?|dinosaurs?|faeries?|phyrexians?|demons?|elementals?|beasts?) you control get/i,
    /for each .{0,20}(?:human|elf|goblin|vampire|zombie|merfolk|dragon|angel|warrior|wizard|knight|rat|spirit|bird|cat|cleric|soldier|rogue|dinosaur|faerie|phyrexian|demon|elemental|beast)/i,
    /choose a creature type/i,
  ],
  spellslinger: [
    /for each (?:instant or sorcery|other spell|spell) (?:you'?ve )?cast this turn/i,
    /number of (?:instants?|sorceries|spells).*cast this turn/i,
    /spells? you cast this turn/i,
  ],
  reanimator: [
    /for each creature card in your graveyard/i,
    /return.{0,40}creature card.{0,40}from (your |a |their )?graveyard/i,
  ],
  burn: [
    /whenever .{0,30} deals (?:combat )?damage to (?:a player|an opponent|each opponent)/i,
    /can't gain life/i,
  ],
  artifacts: [
    /for each artifact you control/i,
    /whenever (?:an|another) artifact (?:you control )?enters/i,
    /metalcraft/i,
    /artifacts? you control/i,
  ],
  landfall: [
    /whenever a land enters/i,
    /\blandfall\b/i,
  ],
  domain: [
    /for each basic land type among lands you control/i,
    /basic land types? among lands you control/i,
  ],
  energy: [
    /pay (?:\{e\}|one \{e\}|.{0,12}\{e\})/i,
    /for each \{e\}/i,
  ],
  vehicles: [
    /whenever .{0,20}vehicle .{0,20}(?:attacks|enters)/i,
    /vehicles? you control/i,
  ],
  stax: [
    /(?:each |an? )?opponent[s']*.{0,40}can't/i,
    /players? can't/i,
  ],
  storm: [
    /\bstorm\b/i,
    /for each spell .{0,20}cast this turn/i,
  ],
};

/** Broader oracle-text patterns for general keyword detection. */
const BROAD_PATTERNS: Record<string, RegExp> = {
  ramp:        /add \{/i,
  tutor:       /search your library for (a |an |)/i,
  removal:     /destroy target|exile target|deals \d+ damage to target creature/i,
  wipe:        /destroy all|exile all|(each creature|all creatures) gets? -/i,
  draw:        /draw (a|[2-9]|\d+) card/i,
  counter:     /counter target spell/i,
  discard:     /discard|look at .* hand|reveals? .* hand/i,
  bounce:      /return target .{0,40} to its owner/i,
  protection:  /\bhexproof\b|\bindestructible\b|\bshroud\b|ward|protection from/i,
  haste:       /\bhaste\b/i,
  flying:      /\bflying\b/i,
  trample:     /\btrample\b/i,
  vigilance:   /\bvigilance\b/i,
  deathtouch:  /\bdeathtouch\b/i,
  lifelink:    /\blifelink\b/i,
  menace:      /\bmenace\b/i,
  token:       /create[sd]? .{0,20}token|put .{0,20}token/i,
  graveyard:   /graveyard/i,
  cycling:     /\bcycling\b/i,
  flashback:   /\bflashback\b/i,
  kicker:      /\bkicker\b/i,
  adventure:   /\badventure\b/i,
};

// ── Synergy Profile ───────────────────────────────────────────────────────────

export interface CardSynergyProfile {
  name: string;
  typeLine: string;
  cmc: number;
  sourceTags: Set<MechanicAxis>;
  payoffTags: Set<MechanicAxis>;
  broadTags: Set<string>;
  engineRole: EngineRole;
  isLand: boolean;
}

export interface SynergyConnectionSummary {
  partners: number;
  links: number;
  feeds: string[];
  fedBy: string[];
}

export function normalizeTribe(tribe: string | undefined): string {
  return (tribe ?? "").trim().toLowerCase().replace(/s$/, "");
}

export function cardMatchesTribe(card: CardRecord, tribe: string | undefined): boolean {
  const normalized = normalizeTribe(tribe);
  if (!normalized || !card.typeLine.includes("Creature")) return false;
  return parseCreatureTypes(card.typeLine).some((type) => normalizeTribe(type) === normalized);
}

export function cardReferencesTribe(card: CardRecord, tribe: string | undefined): boolean {
  const normalized = normalizeTribe(tribe);
  if (!normalized) return false;
  const plural = `${normalized}s`;
  const haystack = (card.oracleText ?? "").toLowerCase();
  return (
    new RegExp(`\\b${escapeRegExp(normalized)}\\b`, "i").test(haystack) ||
    new RegExp(`\\b${escapeRegExp(plural)}\\b`, "i").test(haystack) ||
    /choose a creature type/i.test(haystack) ||
    /creatures? of the chosen type/i.test(haystack)
  );
}

export function tribalCardBonus(card: CardRecord, tribal: TribalSupportOptions | undefined): number {
  if (!tribal?.tribe) return 0;
  let bonus = 0;
  if (cardMatchesTribe(card, tribal.tribe)) bonus += tribal.mode === "exclusive" ? 12 : 8;
  if (cardReferencesTribe(card, tribal.tribe)) bonus += tribal.mode === "exclusive" ? 10 : 7;
  return bonus;
}

export function generateTribalReasons(card: CardRecord, tribal: TribalSupportOptions | undefined): string[] {
  if (!tribal?.tribe) return [];
  const tribe = titleCaseTribe(tribal.tribe);
  const reasons: string[] = [];
  const matches = cardMatchesTribe(card, tribal.tribe);
  const references = cardReferencesTribe(card, tribal.tribe);
  if (matches) reasons.push(`Tribal: matches selected ${tribe} creature type`);
  if (references) reasons.push(`Tribal payoff/support: references ${tribe} or chosen creature types`);
  if (!matches && !references && tribal.mode === "exclusive") {
    reasons.push("Exclusive tribal mode: included as essential interaction/support");
  }
  return reasons;
}

function parseCreatureTypes(typeLine: string): string[] {
  const [, subtypes = ""] = typeLine.split(/[—-]/, 2);
  return subtypes.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function titleCaseTribe(tribe: string): string {
  const normalized = normalizeTribe(tribe);
  return normalized ? normalized[0].toUpperCase() + normalized.slice(1) : tribe;
}

/**
 * Build a rich directional synergy profile from a CardRecord.
 */
export function buildSynergyProfile(card: CardRecord): CardSynergyProfile {
  const oracle = (card.oracleText ?? "").toLowerCase();
  const tl = card.typeLine;
  const kw: string[] = (() => {
    try { return JSON.parse(card.keywordsJson || "[]") as string[]; } catch { return []; }
  })();
  const kwText = kw.join(" ").toLowerCase();
  const haystack = oracle + " " + kwText;
  const isLand = tl.includes("Land");

  const sourceTags = new Set<MechanicAxis>();
  const payoffTags = new Set<MechanicAxis>();
  const broadTags  = new Set<string>();

  if (!isLand) {
    // Enchantments are themselves enchantress sources
    if (tl.includes("Enchantment")) sourceTags.add("enchantress");

    for (const [axis, patterns] of Object.entries(SOURCE_PATTERNS) as [MechanicAxis, RegExp[]][]) {
      if (patterns.some(p => p.test(haystack))) sourceTags.add(axis);
    }
    for (const [axis, patterns] of Object.entries(PAYOFF_PATTERNS) as [MechanicAxis, RegExp[]][]) {
      if (patterns.some(p => p.test(haystack))) payoffTags.add(axis);
    }
    // Opponent-mill cards often contain the substring "mills three cards", which
    // looks like self-mill if we only inspect the verb phrase. Explicit opponent
    // targeting wins: keep them on the opponent-mill axis and prevent accidental
    // graveyard/self-mill recursion bonuses.
    if (sourceTags.has("mill") && isExplicitOpponentMill(haystack)) sourceTags.delete("selfMill");
    for (const [tag, pattern] of Object.entries(BROAD_PATTERNS)) {
      if (pattern.test(haystack)) broadTags.add(tag);
    }
  }

  const engineRole = classifyEngineRole(card, sourceTags, payoffTags, broadTags, tl);

  return { name: card.name, typeLine: tl, cmc: card.cmc, sourceTags, payoffTags, broadTags, engineRole, isLand };
}

function isExplicitOpponentMill(text: string): boolean {
  return /(?:target (?:opponent|player)|each opponent|each player) mills?/i.test(text);
}

function classifyEngineRole(
  card: CardRecord,
  source: Set<MechanicAxis>,
  payoff: Set<MechanicAxis>,
  broad: Set<string>,
  tl: string,
): EngineRole {
  if (tl.includes("Land")) return "support";
  if (broad.has("removal") || broad.has("wipe") || broad.has("counter") || broad.has("bounce") || broad.has("discard")) return "interact";
  if (source.size > 0 && payoff.size > 0) return "engine";  // supplies AND benefits
  if (payoff.size > 0) return "payoff";
  if (source.size > 0) return "enabler";
  if (broad.has("draw") || broad.has("ramp") || broad.has("tutor")) return "support";
  // High-power creature with no axis tag = generic threat/enabler
  const power = parseInt(card.power ?? "0", 10);
  if (!isNaN(power) && power >= 3 && (tl.includes("Creature") || tl.includes("Planeswalker"))) return "enabler";
  return "support";
}

// ── Deck axis inference ───────────────────────────────────────────────────────

/**
 * Infer the primary mechanical axes from a collection of profiles.
 * Returns axes sorted by coverage descending (> threshold).
 */
export function inferPrimaryAxes(profiles: CardSynergyProfile[]): MechanicAxis[] {
  const axisCounts = new Map<MechanicAxis, { sources: number; payoffs: number; engines: number }>();
  for (const p of profiles) {
    for (const a of p.sourceTags) {
      const current = axisCounts.get(a) ?? { sources: 0, payoffs: 0, engines: 0 };
      current.sources += 1;
      if (p.engineRole === "engine") current.engines += 1;
      axisCounts.set(a, current);
    }
    for (const a of p.payoffTags) {
      const current = axisCounts.get(a) ?? { sources: 0, payoffs: 0, engines: 0 };
      current.payoffs += 1;
      if (p.engineRole === "engine") current.engines += 1;
      axisCounts.set(a, current);
    }
  }
  const total = profiles.length;
  const MIN_COVERAGE = Math.max(3, Math.ceil(total * 0.12));  // narrow strategies like mill need fewer dedicated cards
  return [...axisCounts.entries()]
    .map(([axis, counts]) => ({
      axis,
      coverage: counts.sources + counts.payoffs,
      score: counts.sources + counts.payoffs * 1.5 + counts.engines * 2,
      qualifiesByPayoffs: counts.payoffs >= 2 && counts.sources + counts.payoffs >= 4,
    }))
    .filter((entry) => entry.coverage >= MIN_COVERAGE || entry.qualifiesByPayoffs)
    .sort((a, b) => b.score - a.score || b.coverage - a.coverage)
    .slice(0, 3)
    .map((entry) => entry.axis);
}

// ── Axis score for card selection ─────────────────────────────────────────────

/**
 * Score how well a candidate card fits the deck's chosen axes.
 * Returns 0–40 (higher = better fit).
 */
export function axisScore(
  _card: CardRecord,
  profile: CardSynergyProfile,
  deckAxes: MechanicAxis[],
  deckProfiles: CardSynergyProfile[],
): number {
  if (deckAxes.length === 0) return 0;

  let score = 0;

  // Source/payoff hits on active axes
  for (const axis of deckAxes) {
    if (profile.sourceTags.has(axis)) score += 8;
    if (profile.payoffTags.has(axis)) score += 10;  // payoffs more valuable — they close out games
  }

  // Engine role bonus
  if (profile.engineRole === "engine")  score += 6;
  if (profile.engineRole === "payoff")  score += 4;
  if (profile.engineRole === "enabler") score += 3;

  // Synergy density: how many existing deck cards does this connect with?
  let partners = 0;
  for (const dp of deckProfiles) {
    if (dp.isLand) continue;
    // This card's source feeds dp's payoff
    for (const src of profile.sourceTags) {
      if (dp.payoffTags.has(src)) { partners++; break; }
    }
    // This card's payoff is fed by dp's source
    for (const pay of profile.payoffTags) {
      if (dp.sourceTags.has(pay)) { partners++; break; }
    }
  }
  // Add up to 12 points for density (cap at ~15 partners)
  score += Math.min(12, partners * 1.2);

  return Math.min(40, score);
}

export function summarizeSynergyConnections(
  profile: CardSynergyProfile,
  deckProfiles: CardSynergyProfile[],
): SynergyConnectionSummary {
  const feeds: string[] = [];
  const fedBy: string[] = [];
  let links = 0;

  for (const dp of deckProfiles) {
    if (dp.isLand || dp.name === profile.name) continue;
    for (const src of profile.sourceTags) {
      if (dp.payoffTags.has(src)) {
        links += 1;
        if (!feeds.includes(dp.name)) feeds.push(dp.name);
      }
    }
    for (const pay of profile.payoffTags) {
      if (dp.sourceTags.has(pay)) {
        links += 1;
        if (!fedBy.includes(dp.name)) fedBy.push(dp.name);
      }
    }
    for (const axis of profile.sourceTags) {
      if (profile.payoffTags.has(axis) && dp.sourceTags.has(axis) && dp.payoffTags.has(axis)) {
        links += 1;
      }
    }
  }

  return { partners: new Set([...feeds, ...fedBy]).size, links, feeds, fedBy };
}

export function synergyDensityMultiplier(summary: SynergyConnectionSummary): number {
  if (summary.partners >= 8 || summary.links >= 12) return 1.55;
  if (summary.partners >= 5 || summary.links >= 8) return 1.38;
  if (summary.partners >= 3 || summary.links >= 5) return 1.22;
  if (summary.partners >= 1 || summary.links >= 2) return 1.10;
  return 1.0;
}

export function crossAxisCompositionBonus(
  profile: CardSynergyProfile,
  deckProfiles: CardSynergyProfile[],
): number {
  const deckAxes = new Set<MechanicAxis>();
  for (const dp of deckProfiles) {
    for (const axis of dp.sourceTags) deckAxes.add(axis);
    for (const axis of dp.payoffTags) deckAxes.add(axis);
  }

  const candidateAxes = new Set<MechanicAxis>([...profile.sourceTags, ...profile.payoffTags]);
  let bonus = 0;

  if (hasPair(deckAxes, candidateAxes, "tokens", "sacrifice")) bonus += 8;
  if (hasPair(deckAxes, candidateAxes, "graveyard", "selfMill")) bonus += 7;
  if (hasPair(deckAxes, candidateAxes, "mill", "draw")) bonus += 4;
  if (hasPair(deckAxes, candidateAxes, "discard", "graveyard")) bonus += 7;
  if (hasPair(deckAxes, candidateAxes, "lifegain", "counters")) bonus += 6;
  if (hasPair(deckAxes, candidateAxes, "tokens", "counters")) bonus += 6;
  if (hasPair(deckAxes, candidateAxes, "blink", "etb")) bonus += 8;
  if (hasPair(deckAxes, candidateAxes, "spellslinger", "draw")) bonus += 5;
  if (hasPair(deckAxes, candidateAxes, "enchantress", "lifegain")) bonus += 4;
  if (hasPair(deckAxes, candidateAxes, "lifegain", "mill")) bonus += 5;
  if (hasPair(deckAxes, candidateAxes, "reanimator", "selfMill")) bonus += 7;
  if (hasPair(deckAxes, candidateAxes, "reanimator", "discard")) bonus += 6;
  if (hasPair(deckAxes, candidateAxes, "artifacts", "vehicles")) bonus += 5;
  if (hasPair(deckAxes, candidateAxes, "landfall", "domain")) bonus += 5;
  if (hasPair(deckAxes, candidateAxes, "spellslinger", "storm")) bonus += 6;
  if (hasPair(deckAxes, candidateAxes, "energy", "counters")) bonus += 4;

  return Math.min(18, bonus);
}

function hasPair(deckAxes: Set<MechanicAxis>, candidateAxes: Set<MechanicAxis>, a: MechanicAxis, b: MechanicAxis): boolean {
  return (candidateAxes.has(a) && deckAxes.has(b)) || (candidateAxes.has(b) && deckAxes.has(a));
}

// ── Per-card reason generation ─────────────────────────────────────────────────

/**
 * Generate concise human-readable reasons why a card was selected.
 */
export function generateCardReasons(
  profile: CardSynergyProfile,
  deckAxes: MechanicAxis[],
  deckProfiles: CardSynergyProfile[],
  roleSlot: string,
): string[] {
  const reasons: string[] = [];

  // Role slot
  const roleMap: Record<string, string> = {
    threats: "Threat",
    removal: "Removal",
    boardWipes: "Board wipe",
    counterspells: "Counterspell",
    cardDraw: "Card draw",
    ramp: "Ramp",
  };
  if (roleMap[roleSlot]) reasons.push(`${roleMap[roleSlot]}: fills the ${roleSlot} role target`);

  // Engine role
  if (profile.engineRole === "engine")   reasons.push("Engine: both produces and rewards the strategy");
  if (profile.engineRole === "payoff")   reasons.push("Payoff: rewards the primary mechanic axes");
  if (profile.engineRole === "enabler")  reasons.push("Enabler: supplies inputs for payoff cards");

  // Axis contributions
  for (const axis of deckAxes) {
    if (profile.sourceTags.has(axis)) {
      reasons.push(`Source: produces ${axis} (feeds deck's ${axis} payoffs)`);
    }
    if (profile.payoffTags.has(axis)) {
      // Count how many deck sources feed this
      const feeders = deckProfiles.filter(dp => dp.sourceTags.has(axis)).length;
      reasons.push(`Payoff: scales with ${axis} (${feeders} source${feeders !== 1 ? "s" : ""} in deck)`);
    }
  }

  // Synergy partners
  const partnerNames: string[] = [];
  for (const dp of deckProfiles) {
    if (dp.isLand || dp.name === profile.name) continue;
    let connected = false;
    for (const src of profile.sourceTags) {
      if (dp.payoffTags.has(src)) { connected = true; break; }
    }
    if (!connected) {
      for (const pay of profile.payoffTags) {
        if (dp.sourceTags.has(pay)) { connected = true; break; }
      }
    }
    if (connected) partnerNames.push(dp.name);
  }
  if (partnerNames.length > 0) {
    const listed = partnerNames.slice(0, 3).join(", ");
    const extra = partnerNames.length > 3 ? ` +${partnerNames.length - 3} more` : "";
    reasons.push(`Synergy: connects with ${listed}${extra}`);
  }

  const offAxisSources = [...profile.sourceTags].filter((axis) => !deckAxes.includes(axis));
  const offAxisPayoffs = [...profile.payoffTags].filter((axis) => !deckAxes.includes(axis));
  if (offAxisSources.length > 0) {
    reasons.push(`Also: produces ${offAxisSources.join(", ")}`);
  }
  if (offAxisPayoffs.length > 0) {
    reasons.push(`Also: pays off ${offAxisPayoffs.join(", ")}`);
  }

  if (reasons.length === 0) {
    reasons.push("Power: high-quality card for the archetype");
  }

  return reasons;
}

// ── Axis from KeywordFocus ─────────────────────────────────────────────────────

/**
 * Map user-selected KeywordFocus values to MechanicAxis values.
 */
/**
 * Convenience wrapper: returns a single 0-30 synergy score from the V2 model,
 * compatible with the legacy computeSynergy signature.
 * Builds profiles inline; accepts the same arguments as the old function.
 */
export function computeSynergyScoreV2(
  card: CardRecord,
  deckEntries: { card: CardRecord; quantity: number; board: string }[]
): number {
  const profiles = deckEntries
    .filter((e) => !e.card.typeLine.includes("Land"))
    .map((e) => buildSynergyProfile(e.card));
  const profile = buildSynergyProfile(card);
  const axes = inferPrimaryAxes([profile, ...profiles]);
  if (axes.length === 0) return 0;
  const score = axisScore(card, profile, axes, profiles);
  return Math.min(30, Math.round(score * 0.75));
}

/**
 * Penalty based on castability probability on natural turn.
 * Returns 0-5 penalty: 0 if prob >= 0.60, rising linearly below that.
 */
export function castabilityFeedbackPenalty(probCastable: number): number {
  if (probCastable >= 0.60) return 0;
  if (probCastable <= 0.10) return 5;
  return Math.round((1 - probCastable / 0.60) * 5);
}

export function keywordFocusToAxes(focus: string[]): MechanicAxis[] {
  const map: Record<string, MechanicAxis | MechanicAxis[]> = {
    Flying:    "spellslinger",  // no exact axis — use as broad flying matters
    Trample:   "counters",      // trample payoffs often counter-based
    Tokens:    "tokens",
    "Go-Wide Tokens": "tokens",
    Sacrifice: "sacrifice",
    Aristocrats: "sacrifice",
    Graveyard: "graveyard",
    Reanimator: ["reanimator", "graveyard", "selfMill"],
    Mill: "mill",
    Lifegain:  "lifegain",
    Counters:  "counters",
    "+1/+1 Counters": "counters",
    Discard:   "discard",
    "Hand Disruption": "discard",
    "Self-Discard/Looting": ["discard", "graveyard", "selfMill", "draw"],
    Spellslinger: "spellslinger",
    Prowess: "spellslinger",
    "ETB/Blink": "blink",
    Enchantress: "enchantress",
    Artifacts: "artifacts",
    Ramp: "draw",
    "Big Mana": "draw",
    "Tribal Support": "typal",
    "Voltron/Auras": "enchantress",
    Stompy: "counters",
    "Flash/Draw-Go": "draw",
    "Evasion Tempo": "spellslinger",
    "Artifacts/Tokens": ["artifacts", "tokens"],
    "Draw-Go Control": "draw",
  };
  const axes: MechanicAxis[] = [];
  for (const kw of focus) {
    const mapped = map[kw];
    const mappedAxes = Array.isArray(mapped) ? mapped : mapped ? [mapped] : [];
    for (const ax of mappedAxes) {
      if (!axes.includes(ax)) axes.push(ax);
}
  }
  return axes;
}
