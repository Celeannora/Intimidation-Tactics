/**
 * seedSynergy.ts — seed-driven, role-gap-aware deckbuilding helpers.
 *
 * This module is intentionally isolated from the shared scoring engine
 * (`scoreEngine.ts`, `scoringConfig.ts`). Its input is an explicit seed
 * package and, when available, a resource inferred from the seed payoff
 * cards. Nothing here is wired into the app's default pipeline.
 */

import type { CardRecord } from "../types";
import { assignRoles } from "../roles";

// ── Seed configuration and role model ───────────────────────────────────

export interface SeedCard {
  name: string;
  quantity: number;
}

export type SeedPackage = SeedCard[];

/**
 * Seed roles are a narrower, purpose-built taxonomy layered on top
 * of (not replacing) the shared `CardRole` model in roles.ts. A card can
 * satisfy more than one seed role; every nonland card MUST satisfy at
 * least one, or it is rejected regardless of standalone power.
 */
export type SeedRole = "Enabler" | "Protection" | "Consistency" | "Payoff";

export interface SeedRoleTargets {
  enablers: [number, number];
  protection: [number, number];
  consistency: [number, number];
  payoffs: [number, number];
  lands: number;
}

/** Default tunable deckbuilding bands for a 60-card, 24-land seed build. */
export const SEED_ROLE_TARGETS: SeedRoleTargets = {
  enablers: [10, 14],
  protection: [8, 12],
  // Keep draw/filtering as a supporting role rather than allowing broad
  // multi-role tags to absorb most of an overflow pass.
  consistency: [4, 8],
  payoffs: [6, 8],
  lands: 24,
};

function isInSeedPackage(card: CardRecord, seedPackage: SeedPackage): boolean {
  return seedPackage.some((seedCard) => seedCard.name === card.name);
}

// ── Seed role classification ────────────────────────────────────────────

const CANTRIP_HINT = /draws? a card/;
// A "draw a card" clause only supports Consistency when the CONTROLLER draws
// as the upside. Cards that route the draw through giving an opponent a
// permanent, life, or control of something ("if they do, you draw a card"
// gated on the opponent gaining something) are a net loss dressed as
// card draw and must not earn Consistency credit.
const ANTI_SYNERGY_DRAW_HINT = /opponent (gains? control|creates?|gains?)[^.]*you draw a card|target opponent[^.]*\. if they do, you draw a card/;
function isGenuineCardDraw(text: string): boolean {
  return CANTRIP_HINT.test(text) && !ANTI_SYNERGY_DRAW_HINT.test(text);
}
const FILTER_HINT = /surveil|scry|look at the top/;
const TUTOR_HINT = /search your library for a/;
const RECURSION_HINT = /return .* from your graveyard to (your hand|the battlefield)/;
const COUNTER_HINT = /counter target spell|counter that spell/;
const SWEEPER_HINT = /destroy all creatures|each creature gets -|deals \d+ damage to each creature/;
const REMOVAL_HINT = /destroy target creature|exile target creature|deals? \d+ damage to target creature|-\d\/-\d until end of turn/;
// Scoped to damage prevention that protects the player's resource total;
// deliberately excludes "prevent damage to [a permanent/creature]" self
// protection clauses, which are a different effect entirely.
const DAMAGE_PREVENTION_HINT = /prevent (all|the next|that) damage that would be dealt to (you|a player|each player|target player)|damage that would be dealt to you is prevented|fog\b/;
const TEMPO_TAX_HINT = /enters? (the battlefield )?tapped|can't attack|can't block|skip.*(untap|combat)/;
// A tax effect only supports a defensive seed plan when it constrains the
// opponent. Cards with self-imposed drawbacks ("this creature can't attack
// unless...") must not earn Enabler — checked sentence-by-sentence so an
// opponent clause elsewhere in the card cannot validate a self-restriction.
function isOpponentTax(text: string): boolean {
  return text
    .split(/[\n.]/)
    .some((s) => TEMPO_TAX_HINT.test(s) && /opponent|attack you|block you|each player/.test(s));
}

/**
 * Classify a card into zero or more seed roles. A card with zero seed
 * roles is rejected from this build regardless of raw power level — this
 * is the "hard instruction" from the brief encoded as an actual filter.
 */
export function classifySeedRoles(
  card: CardRecord,
  seedPackage: SeedPackage,
  resourceSpec: ResourceSpec | null = null,
): SeedRole[] {
  const text = (card.oracleText ?? "").toLowerCase();
  const roles: Set<SeedRole> = new Set();
  const baseRoles = assignRoles(card);

  // The supplied seed cards are the locked payoff package. Candidate cards
  // earn supporting roles only through their rules text.
  if (isInSeedPackage(card, seedPackage)) {
    roles.add("Payoff");
  }

  // ENABLER: cards that produce the payoff resource, plus low-cost tempo
  // setup for defensive seed plans. Resource production is inferred from
  // payoff text; without a clear inference this intentionally declines to
  // guess a resource producer.
  if (
    (resourceSpec !== null && resourceCadence(card, resourceSpec) !== null) ||
    isOpponentTax(text)
  ) {
    roles.add("Enabler");
  }

  // PROTECTION: removal, counters, sweepers, or tempo plays that preserve
  // the resource total and buy time. Damage prevention is explicitly treated
  // as combo support when a payoff scales with the preserved total.
  if (
    baseRoles.includes("Removal") ||
    baseRoles.includes("Counterspell") ||
    baseRoles.includes("BoardWipe") ||
    baseRoles.includes("Bounce") ||
    REMOVAL_HINT.test(text) ||
    COUNTER_HINT.test(text) ||
    SWEEPER_HINT.test(text) ||
    DAMAGE_PREVENTION_HINT.test(text)
  ) {
    roles.add("Protection");
  }

  // CONSISTENCY: cantrips, card draw, filtering, tutoring, or recursion
  // that finds seed pieces.
  // NOTE: baseRoles.includes("CardDraw") is intentionally NOT used standalone
  // here. The shared engine's CardDraw tag (src/lib/roles.ts) is a bare
  // substring match on "draws a card" with no read on cost — it does not
  // distinguish real card advantage from a card that pays for the draw by
  // giving an opponent one of your permanents. That is a net loss for a
  // permanent-dependent plan, not Consistency, even though the shared
  // engine's generic tag treats it as card draw.
  if (
    (baseRoles.includes("CardDraw") && isGenuineCardDraw(text)) ||
    baseRoles.includes("Tutor") ||
    FILTER_HINT.test(text) ||
    TUTOR_HINT.test(text) ||
    RECURSION_HINT.test(text)
  ) {
    roles.add("Consistency");
  }

  return [...roles];
}

export function isSeedEligible(
  card: CardRecord,
  seedPackage: SeedPackage,
  resourceSpec: ResourceSpec | null = null,
): boolean {
  return classifySeedRoles(card, seedPackage, resourceSpec).length > 0;
}

/**
 * Which target-band roles are already at or above their ceiling for the
 * given deck state. Used by sequential fill loops to hard-skip a role
 * once it is full, instead of relying solely on the soft multiplier fade
 * (the fade alone still let one role dominate a fill pass in testing).
 */
export function rolesAtCeiling(
  counts: DeckRoleCounts,
  roleTargets: SeedRoleTargets = SEED_ROLE_TARGETS,
): Set<SeedRole> {
  const atCeiling = new Set<SeedRole>();
  if (counts.enablers >= roleTargets.enablers[1]) atCeiling.add("Enabler");
  if (counts.protection >= roleTargets.protection[1]) atCeiling.add("Protection");
  if (counts.consistency >= roleTargets.consistency[1]) atCeiling.add("Consistency");
  if (counts.payoffs >= roleTargets.payoffs[1]) atCeiling.add("Payoff");
  return atCeiling;
}

// ── Deck role-count tracking ────────────────────────────────────────────

export interface DeckRoleCounts {
  enablers: number;
  protection: number;
  consistency: number;
  payoffs: number;
  lands: number;
  nonlandTotal: number;
}

export function emptyRoleCounts(): DeckRoleCounts {
  return { enablers: 0, protection: 0, consistency: 0, payoffs: 0, lands: 0, nonlandTotal: 0 };
}

export function tallyRoleCounts(
  entries: { card: CardRecord; quantity: number }[],
  seedPackage: SeedPackage,
  resourceSpec: ResourceSpec | null = null,
): DeckRoleCounts {
  const counts = emptyRoleCounts();
  for (const { card, quantity } of entries) {
    if (card.typeLine.includes("Land")) {
      counts.lands += quantity;
      continue;
    }
    const roles = classifySeedRoles(card, seedPackage, resourceSpec);
    if (roles.includes("Enabler")) counts.enablers += quantity;
    if (roles.includes("Protection")) counts.protection += quantity;
    if (roles.includes("Consistency")) counts.consistency += quantity;
    if (roles.includes("Payoff")) counts.payoffs += quantity;
    counts.nonlandTotal += quantity;
  }
  return counts;
}

// -- Batched re-analysis (sequential seed-chain loop) ---------------------

/**
 * Deck-level adjustments produced by re-analysis between pick batches.
 * These recompute DERIVED state only (pip balance, curve shape); the game
 * plan anchor -- role definitions, payoff identity, win condition, the WU
 * color identity itself -- is locked to the original seed and is never
 * re-inferred from the accumulated picks. Without that anchor, twenty
 * white protection cards would eventually outvote the seed and the
 * analyzer would start optimizing TOWARD the drift ("mono-white defensive
 * deck") instead of correcting it.
 */
export interface DeckAdjustments {
  /** Score multiplier applied to candidates whose colored pips are
   *  predominantly this color. 1.0 = neutral, <1.0 = penalized. */
  colorMultiplier: { w: number; u: number };
  /** Bonus for cheap (MV<=2) candidates when the curve is top-heavy. */
  cheapCurveBonus: number;
  /** Human-readable checkpoint notes for the build log. */
  notes: string[];
  /**
   * Deck-level resource counts for cost-dependency checks (e.g. how many
   * artifacts can feed a "sacrifice another artifact" cost). undefined =
   * dependency checking disabled (neutral / straight-through builds).
   */
  supportCounts?: { artifacts: number; creatures: number };
  /**
   * Creature subtype counts (e.g. { Ally: 2, Wizard: 5 }), keyed by exactly
   * the subtype word as it appears in typeLine. Populated generically from
   * whatever subtypes are actually present in the deck -- no fixed list of
   * tribes is hardcoded anywhere. Used to resolve "another/other <Type> you
   * control" trigger-condition dependencies for ANY tribe, not just one.
   */
  subtypeCounts?: Record<string, number>;
}

export function neutralAdjustments(): DeckAdjustments {
  return { colorMultiplier: { w: 1.0, u: 1.0 }, cheapCurveBonus: 0, notes: [] };
}

function pipCounts(entries: { card: CardRecord; quantity: number }[]): { w: number; u: number } {
  let w = 0;
  let u = 0;
  for (const { card, quantity } of entries) {
    if (card.typeLine.includes("Land")) continue;
    const cost = card.manaCost ?? "";
    w += (cost.match(/\{W\}/g)?.length ?? 0) * quantity;
    u += (cost.match(/\{U\}/g)?.length ?? 0) * quantity;
  }
  return { w, u };
}

/**
 * Re-analysis checkpoint for the batched seed-chain loop: recompute
 * deck-level properties the per-pick scorer cannot see, and emit score
 * adjustments for the next batch.
 *
 * Current checks (each one exists because the straight-through build
 * demonstrably missed it):
 * 1. Color-pip balance -- the straight-through build drifted to ~82%
 *    white pips because the role classifier has no color signal at all.
 *    When one color's share of colored pips exceeds BALANCE_THRESHOLD,
 *    candidates that would deepen the skew are penalized progressively.
 * 2. Curve shape -- if the deck is accumulating 4-5 MV cards faster than
 *    cheap early plays, cheap candidates get a bonus so turns 1-2 stay
 *    covered (the brief's turn-by-turn usability requirement).
 */
export function reanalyzeDeck(
  entries: { card: CardRecord; quantity: number }[],
): DeckAdjustments {
  const adj = neutralAdjustments();
  const pips = pipCounts(entries);
  const totalPips = pips.w + pips.u;

  const BALANCE_THRESHOLD = 0.65;
  if (totalPips >= 10) {
    const wShare = pips.w / totalPips;
    const uShare = pips.u / totalPips;
    if (wShare > BALANCE_THRESHOLD) {
      // Scale penalty with excess: 65% -> 1.0, 80% -> 0.7, 95% -> 0.4
      adj.colorMultiplier.w = Math.max(0.4, 1.0 - (wShare - BALANCE_THRESHOLD) * 2);
      adj.notes.push(
        `Color balance: W pip share ${(wShare * 100).toFixed(0)}% exceeds ${BALANCE_THRESHOLD * 100}% threshold — ` +
        `white-leaning candidates penalized x${adj.colorMultiplier.w.toFixed(2)} next batch.`
      );
    } else if (uShare > BALANCE_THRESHOLD) {
      adj.colorMultiplier.u = Math.max(0.4, 1.0 - (uShare - BALANCE_THRESHOLD) * 2);
      adj.notes.push(
        `Color balance: U pip share ${(uShare * 100).toFixed(0)}% exceeds ${BALANCE_THRESHOLD * 100}% threshold — ` +
        `blue-leaning candidates penalized x${adj.colorMultiplier.u.toFixed(2)} next batch.`
      );
    } else {
      adj.notes.push(
        `Color balance OK: W ${(wShare * 100).toFixed(0)}% / U ${((1 - wShare) * 100).toFixed(0)}% of colored pips.`
      );
    }
  }

  // Curve check: among nonland picks, require a healthy floor of
  // cheap plays. Target: at least ~40% of nonland cards at MV<=2 once the
  // deck has 8+ nonland cards.
  let cheap = 0;
  let nonland = 0;
  for (const { card, quantity } of entries) {
    if (card.typeLine.includes("Land")) continue;
    nonland += quantity;
    if (card.cmc <= 2) cheap += quantity;
  }
  if (nonland >= 8) {
    const cheapShare = cheap / nonland;
    if (cheapShare < 0.4) {
      adj.cheapCurveBonus = 3;
      adj.notes.push(
        `Curve: only ${(cheapShare * 100).toFixed(0)}% of nonland cards are MV<=2 (target >=40%) — ` +
        `cheap candidates get +${adj.cheapCurveBonus} next batch.`
      );
    } else {
      adj.notes.push(`Curve OK: ${(cheapShare * 100).toFixed(0)}% of nonland cards are MV<=2.`);
    }
  }

  adj.supportCounts = {
    artifacts: entries.reduce((n, e) => n + (!e.card.typeLine.includes("Land") && e.card.typeLine.includes("Artifact") ? e.quantity : 0), 0),
    creatures: entries.reduce((n, e) => n + (e.card.typeLine.includes("Creature") ? e.quantity : 0), 0),
  };

  // Generic subtype census: split each card's typeLine on the em dash and
  // tally every subtype word actually present in the deck (Ally, Wizard,
  // Soldier, Spirit, whatever). No fixed tribe list -- this covers ANY
  // "another/other <Type> you control" trigger dependency, for any seed,
  // any deck, any tribe, without enumerating tribes in code.
  const subtypeCounts: Record<string, number> = {};
  for (const { card, quantity } of entries) {
    const afterDash = card.typeLine.split(/—|--/)[1];
    if (!afterDash) continue;
    for (const subtype of afterDash.trim().split(/\s+/)) {
      if (!subtype) continue;
      subtypeCounts[subtype] = (subtypeCounts[subtype] ?? 0) + quantity;
    }
  }
  adj.subtypeCounts = subtypeCounts;

  return adj;
}

/**
 * Which single color dominates a candidate's colored pips, if any.
 * Used to apply the re-analysis color-balance multiplier only to cards
 * that would actually deepen the skew (a WU gold card is neutral).
 */
export function dominantColor(card: CardRecord): "w" | "u" | null {
  const cost = card.manaCost ?? "";
  const w = cost.match(/\{W\}/g)?.length ?? 0;
  const u = cost.match(/\{U\}/g)?.length ?? 0;
  if (w > u) return "w";
  if (u > w) return "u";
  return null;
}

// ── Scoring rules ────────────────────────────────────────────────────────

export interface SeedScoreBreakdown {
  base: number;
  roleGapMultiplier: number;
  saturationPenalty: number;
  curveTimingBonus: number;
  preventionBonus: number;
  final: number;
  note: string;
}

/**
 * Rule 1 — Role-gap multiplier.
 * If the current deck is below target for a role, increase the score of
 * cards that fill that role. The larger the deficit, the larger the
 * multiplier. Deficit is measured against the *low* end of the target
 * band (we want to guarantee the floor before optimizing beyond it).
 */
function roleGapMultiplier(
  role: SeedRole,
  counts: DeckRoleCounts,
  roleTargets: SeedRoleTargets,
): number {
  const target = roleTargets;
  const [lo, hi] = role === "Enabler" ? target.enablers
    : role === "Protection" ? target.protection
    : role === "Consistency" ? target.consistency
    : target.payoffs;
  const current = role === "Enabler" ? counts.enablers
    : role === "Protection" ? counts.protection
    : role === "Consistency" ? counts.consistency
    : counts.payoffs;

  const deficit = Math.max(0, lo - current);
  if (deficit > 0) {
    // Below the floor: scale 1.0 -> up to 2.5x at a full-band deficit.
    return 1.0 + Math.min(1.5, (deficit / lo) * 1.5);
  }
  // Inside or above the target band: no bonus, and a mild fade once we're
  // past the ceiling so the engine is pushed to rotate into whichever role
  // is still under target rather than continuing to stack the same one.
  if (current >= hi) {
    const overshoot = current - hi;
    return Math.max(0.4, 1.0 - overshoot * 0.08);
  }
  return 1.0;
}

/**
 * Rule 2 — Payoff saturation penalty.
 * If payoffs exceed enablers by more than a 2:1 ratio, heavily penalize
 * additional payoffs. Enablers/protection are prioritized until repaired.
 */
function saturationPenalty(role: SeedRole, counts: DeckRoleCounts): number {
  if (role !== "Payoff") return 0;
  const ratio = counts.enablers === 0 ? Infinity : counts.payoffs / counts.enablers;
  if (ratio <= 2) return 0;
  // Heavy, escalating penalty once the 2:1 ceiling is breached.
  return Math.min(40, (ratio - 2) * 20);
}

/**
 * Rule 3 — Turn-by-turn usability bonus.
 * Reward cards that are useful on curve and advance the plan immediately.
 */
function curveTimingBonus(
  card: CardRecord,
  roles: SeedRole[],
  seedPackage: SeedPackage,
): number {
  const cmc = card.cmc;
  let bonus = 0;
  if (cmc <= 2 && (roles.includes("Enabler") || roles.includes("Consistency"))) bonus += 6;
  if (cmc >= 2 && cmc <= 4 && (roles.includes("Payoff") || roles.includes("Protection"))) bonus += 4;
  if (cmc >= 4 && roles.includes("Payoff") && isInSeedPackage(card, seedPackage)) bonus += 8;
  return bonus;
}

/**
 * Rule 4 — Damage prevention as combo support, not generic utility.
 * Prevention effects preserve the resource total that a scaling payoff reads.
 */
function preventionBonus(card: CardRecord): number {
  const text = (card.oracleText ?? "").toLowerCase();
  return DAMAGE_PREVENTION_HINT.test(text) ? 10 : 0;
}

/**
 * Score a candidate card against the CURRENT deck state (not in the
 * abstract). This must be called sequentially, re-scoring the remaining
 * pool after every pick, because role-gap and saturation terms are only
 * meaningful relative to what has already been selected.
 */
// ── Resource cadence ────────────────────────────────────────────────────
// A seed's payoff can consume some resource (life, artifacts, tokens, cards
// in graveyards, and so on). Enabler quality is about the CADENCE of
// producing that resource, not the mere presence of matching text:
//   repeatable-proactive  — the card produces the resource every turn on the
//                           controller\'s own initiative (static combat
//                           keywords like lifelink, self-driven per-turn
//                           triggers).
//   repeatable-conditional — recurring production that depends on opponent
//                           actions.
//   one-shot              — a single burst; fuels the payoff once, then is
//                           spent.
export type ResourceCadence = "repeatable-proactive" | "repeatable-conditional" | "one-shot" | null;

export interface ResourceSpec {
  /** Human-readable resource name for build-log notes. */
  name: string;
  /** Static keywords on creatures that produce the resource every combat. */
  staticProducerKeywords: string[];
  /** Resource production inside a repeatable trigger clause. */
  triggerProductionPattern: RegExp;
  /** One-time production text (spells, ETB bursts). */
  oneShotProductionPattern: RegExp;
  /** Role whose candidates are scored by production cadence. */
  weightedRole: SeedRole;
}

// Attach-and-grant permanents that give a creature a static producer keyword
// are just as repeatable as printing the keyword directly on a creature.
// Only fall through to one-shot when the keyword is a truly single-use grant.
const TEMPORARY_GRANT_HINT = /until end of turn|this turn\b/;

export function resourceCadence(card: CardRecord, spec: ResourceSpec): ResourceCadence {
  const text = (card.oracleText ?? "").toLowerCase();
  const isCreature = card.typeLine.includes("Creature");
  const isAttachment = card.typeLine.includes("Aura") || card.typeLine.includes("Equipment");
  const hasStaticProducer = spec.staticProducerKeywords.some(
    (k) => new RegExp(`\\b${k.toLowerCase()}\\b`).test(text) || (card.keywordsJson ?? "").includes(k)
  );
  const grantsStaticProducer =
    isAttachment &&
    spec.staticProducerKeywords.some((k) => new RegExp(`has ${k.toLowerCase()}\\b`).test(text)) &&
    !TEMPORARY_GRANT_HINT.test(text);
  if ((isCreature || grantsStaticProducer) && hasStaticProducer) return "repeatable-proactive";
  for (const sentence of text.split(/(?<=\.)\s+/)) {
    if (/(whenever|at the beginning)/.test(sentence) && spec.triggerProductionPattern.test(sentence)) {
      return /opponent|each player/.test(sentence) ? "repeatable-conditional" : "repeatable-proactive";
    }
  }
  if (spec.oneShotProductionPattern.test(text) || hasStaticProducer) return "one-shot";
  return null;
}

const CADENCE_BONUS: Record<Exclude<ResourceCadence, null>, number> = {
  "repeatable-proactive": 6,
  "repeatable-conditional": 2,
  "one-shot": 0,
};

/**
 * Keywords are generic game vocabulary, not seed identity. Most entries are
 * deliberately null: they are included to make it explicit that only literal
 * resource producers belong in this mapping.
 */
const KEYWORD_RESOURCE_OUTPUTS: Record<string, string | null> = {
  Lifelink: "life",
  Deathtouch: null,
  DoubleStrike: null,
  FirstStrike: null,
  Flying: null,
  Haste: null,
  Hexproof: null,
  Menace: null,
  Reach: null,
  Trample: null,
  Vigilance: null,
};

const RESOURCE_REFERENCE_PATTERNS: RegExp[] = [
  /where\s+[a-z]\s+is\s+(?:the amount of\s+|the number of\s+|your\s+)?([a-z][a-z\s-]*?)(?:\s+you\s+(?:gained|control)|\s+total|[.,;]|$)/g,
  /equal to\s+(?:the amount of\s+|the number of\s+|your\s+)?([a-z][a-z\s-]*?)\s+you\s+(?:gained|control)\b/g,
  /equal to\s+(?:the amount of\s+|the number of\s+|your\s+)?([a-z][a-z\s-]*?)\s+total\b/g,
  /for each\s+(?:the number of\s+|your\s+)?([a-z][a-z\s-]*?)\s+you\s+control\b/g,
];

function normalizeResourceName(candidate: string): string | null {
  const normalized = candidate
    .toLowerCase()
    .replace(/^(?:the amount of|the number of|your)\s+/, "")
    .replace(/\s+(?:you\s+(?:gained|control)|total).*$/, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!normalized || normalized.length > 40) return null;
  const pluralResourceNames: Record<string, string> = {
    artifact: "artifacts",
    card: "cards",
    creature: "creatures",
    land: "lands",
    permanent: "permanents",
    token: "tokens",
  };
  return pluralResourceNames[normalized] ?? normalized;
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function resourceTermPattern(resource: string): string {
  const singularForms: Record<string, string> = {
    artifacts: "artifact",
    cards: "card",
    creatures: "creature",
    lands: "land",
    permanents: "permanent",
    tokens: "token",
  };
  const singular = singularForms[resource];
  return singular ? `${escapeRegex(singular)}s?` : escapeRegex(resource);
}

/**
 * Infer the resource a payoff scales with from its oracle text.
 *
 * This is intentionally a conservative text heuristic, not comprehensive
 * rules parsing. It recognizes common "equal to", "for each", and "where X
 * is" counting clauses. Unusual templating, multiple unrelated resources,
 * implicit references, and non-countable effects can be ambiguous; callers
 * must handle null by skipping cadence scoring rather than assuming a
 * resource that the text did not clearly identify.
 */
export function inferResourceSpec(seedPayoffCards: CardRecord[]): ResourceSpec | null {
  const hits = new Map<string, number>();
  for (const card of seedPayoffCards) {
    const text = (card.oracleText ?? "").toLowerCase();
    for (const pattern of RESOURCE_REFERENCE_PATTERNS) {
      pattern.lastIndex = 0;
      for (const match of text.matchAll(pattern)) {
        const resource = normalizeResourceName(match[1] ?? "");
        if (resource) hits.set(resource, (hits.get(resource) ?? 0) + 1);
      }
    }
  }

  const ranked = [...hits.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  const resource = ranked[0]?.[0];
  if (!resource) {
    console.warn(
      "[seedSynergy] Unable to infer a countable payoff resource from the supplied seed cards; resource-cadence scoring is disabled."
    );
    return null;
  }

  const resourcePattern = resourceTermPattern(resource);
  const staticProducerKeywords = Object.entries(KEYWORD_RESOURCE_OUTPUTS)
    .filter(([, producedResource]) => producedResource === resource)
    .map(([keyword]) => keyword);
  const productionVerbs = "gain(?:s)?|create(?:s)?|put(?:s)?|add(?:s)?|control(?:s)?|have|has";

  return {
    name: resource,
    staticProducerKeywords,
    triggerProductionPattern: new RegExp(
      `(?:${productionVerbs})[^.]*\\b${resourcePattern}\\b|\\b${resourcePattern}\\b[^.]*\\byou control\\b`,
      "i"
    ),
    oneShotProductionPattern: new RegExp(
      `(?:${productionVerbs})\\s+(?:\\d+|x|that much|one|two|three|an?|any number of)?[^.]*\\b${resourcePattern}\\b|\\b${resourcePattern}\\b[^.]*\\byou control\\b`,
      "i"
    ),
    weightedRole: "Enabler",
  };
}

// ── Seed anthem / tribal-lord synergy ───────────────────────────────────

/**
 * A seed card may grant a stat buff and/or keyword(s) to another creature
 * subtype it names directly (an "anthem" or tribal-lord effect), e.g.
 * "Other Angels you control get +1/+1 and have lifelink." This is the
 * reward-side counterpart to TRIBAL_TRIGGER_PATTERN below (which penalizes
 * a trigger that NEEDS a scarce subtype); this instead rewards candidates
 * that MATCH a subtype the seed already promises to reinforce. The subtype
 * name and any granted keywords are captured from the seed card's own text
 * at inference time — no tribe name is ever enumerated in code.
 */
export interface SeedAnthemSpec {
  /** The exact subtype word captured from seed text, e.g. "Angel". */
  subtype: string;
  /** Keywords the anthem grants to matching creatures, if any (e.g. ["Lifelink"]). */
  grantedKeywords: string[];
}

const ANTHEM_PATTERN = /[Oo]ther ([A-Z][a-z]+)s you control get \+\d+\/\+\d+(?:ies)?/;
const ANTHEM_KEYWORD_GRANT_PATTERN = /[Oo]ther [A-Z][a-z]+s you control get \+\d+\/\+\d+ and have ([a-z, ]+?)(?:\.|$)/i;
const KNOWN_KEYWORD_NAMES = Object.keys(KEYWORD_RESOURCE_OUTPUTS);

/**
 * Infer whether any seed card grants an anthem/tribal-lord bonus to a named
 * creature subtype. Conservative text heuristic, mirroring inferResourceSpec:
 * only matches the common "Other <Subtype>s you control get +X/+Y [and have
 * <keywords>]" template. Returns null when no seed card matches — callers
 * must treat null as "no tribal synergy to reward," never invent one.
 */
export function inferSeedAnthemSynergy(seedCards: CardRecord[]): SeedAnthemSpec | null {
  for (const card of seedCards) {
    const text = card.oracleText ?? "";
    const match = text.match(ANTHEM_PATTERN);
    if (!match) continue;
    const subtype = match[1];

    const grantedKeywords: string[] = [];
    const keywordMatch = text.match(ANTHEM_KEYWORD_GRANT_PATTERN);
    if (keywordMatch) {
      const rawNames = keywordMatch[1].split(/,|\band\b/i).map((s) => s.trim()).filter(Boolean);
      for (const raw of rawNames) {
        const found = KNOWN_KEYWORD_NAMES.find((k) => k.toLowerCase() === raw.toLowerCase());
        if (found) grantedKeywords.push(found);
      }
    }

    return { subtype, grantedKeywords };
  }
  return null;
}

/** Does this candidate's type line carry the anthem's target subtype? */
function matchesAnthemSubtype(card: CardRecord, anthem: SeedAnthemSpec): boolean {
  if (!card.typeLine.includes("Creature")) return false;
  const afterDash = card.typeLine.split(/—|--/)[1];
  if (!afterDash) return false;
  return afterDash.trim().split(/\s+/).includes(anthem.subtype);
}

// Activation-cost dependencies: a card whose ability needs OTHER resources is
// only worth its text if the deck can actually pay the cost. A draw ability
// that requires sacrificing another artifact is ineffective in a deck with
// zero other artifacts. Patterns are seed-agnostic and extensible.
const COST_DEPENDENCIES: { pattern: RegExp; resource: "artifacts" | "creatures"; minimum: number }[] = [
  { pattern: /sacrifice (another|an) artifact/i, resource: "artifacts", minimum: 6 },
  { pattern: /sacrifice (another|a) creature/i, resource: "creatures", minimum: 8 },
];

// Generic tribal-trigger dependency: matches "another/other <Subtype> you
// control" for ANY capitalized subtype word, not a fixed tribe list. A
// trigger condition gated this way is only as repeatable as the deck's
// count of that exact subtype -- a trigger requiring another Ally, for
// example, can only fire off itself when the deck has zero other Allies,
// making it a one-shot despite matching a repeatable-production regex. The
// same shape applies to every subtype; the name is captured at match time
// and looked up dynamically against the deck's own subtype census, never
// enumerated in code.
const TRIBAL_TRIGGER_PATTERN = /(?:another|other) ([A-Z][a-z]+)s? you control/;
const TRIBAL_TRIGGER_MINIMUM = 4;

function costDependencyPenalty(
  card: CardRecord,
  adjustments?: DeckAdjustments
): { mult: number; note: string | null } {
  const support = adjustments?.supportCounts;
  const text = card.oracleText ?? "";

  if (support) {
    for (const dep of COST_DEPENDENCIES) {
      if (dep.pattern.test(text) && support[dep.resource] < dep.minimum) {
        return {
          mult: 0.25,
          note: `cost-dependency penalty x0.25: needs ${dep.resource} to sacrifice, deck has ${support[dep.resource]} (min ${dep.minimum})`,
        };
      }
    }
  }

  const subtypeCounts = adjustments?.subtypeCounts;
  if (subtypeCounts) {
    const tribalMatch = text.match(TRIBAL_TRIGGER_PATTERN);
    if (tribalMatch) {
      const subtype = tribalMatch[1];
      const count = subtypeCounts[subtype] ?? 0;
      if (count < TRIBAL_TRIGGER_MINIMUM) {
        return {
          mult: 0.25,
          note: `tribal-trigger dependency penalty x0.25: needs other ${subtype}s to trigger repeatably, deck has ${count} (min ${TRIBAL_TRIGGER_MINIMUM})`,
        };
      }
    }
  }

  return { mult: 1, note: null };
}

export function scoreCandidate(
  card: CardRecord,
  counts: DeckRoleCounts,
  basePowerScore: number,
  seedPackage: SeedPackage,
  resourceSpec: ResourceSpec | null,
  roleTargets: SeedRoleTargets = SEED_ROLE_TARGETS,
  adjustments?: DeckAdjustments,
  anthemSpec: SeedAnthemSpec | null = null,
): SeedScoreBreakdown {
  const roles = classifySeedRoles(card, seedPackage, resourceSpec);
  if (roles.length === 0) {
    return {
      base: basePowerScore,
      roleGapMultiplier: 0,
      saturationPenalty: 0,
      curveTimingBonus: 0,
      preventionBonus: 0,
      final: -Infinity,
      note: "Rejected: fills no seed role (Enabler/Protection/Consistency/Payoff), regardless of standalone power.",
    };
  }

  // Use the single largest role-gap multiplier across the card's roles —
  // a card filling the most under-filled role should get full credit.
  const gapMultipliers = roles.map((r) => roleGapMultiplier(r, counts, roleTargets));
  const gapMultiplier = Math.max(...gapMultipliers);
  const bestGapRole = roles[gapMultipliers.indexOf(gapMultiplier)];

  const satPenalty = Math.max(...roles.map((r) => saturationPenalty(r, counts)));
  const timing = curveTimingBonus(card, roles, seedPackage);
  const prevention = preventionBonus(card);

  // Deck-level adjustments from the batched re-analysis loop (neutral when
  // running straight-through). The color multiplier only applies to cards
  // that would deepen the current skew; WU gold cards are neutral.
  let colorMult = 1.0;
  let curveBonus = 0;
  if (adjustments) {
    const dom = dominantColor(card);
    if (dom === "w") colorMult = adjustments.colorMultiplier.w;
    else if (dom === "u") colorMult = adjustments.colorMultiplier.u;
    if (card.cmc <= 2) curveBonus = adjustments.cheapCurveBonus;
  }

  const dependency = costDependencyPenalty(card, adjustments);

  // Resource-cadence bonus — only for cards filling the inferred resource's
  // weighted role; a repeatable proactive producer feeds the payoff every
  // turn, so it outranks equal-power one-shot or conditional production.
  const cadence = resourceSpec && roles.includes(resourceSpec.weightedRole)
    ? resourceCadence(card, resourceSpec)
    : null;
  const cadenceBonus = cadence ? CADENCE_BONUS[cadence] : 0;

  // Anthem synergy bonus — only for candidates that already earned a role on
  // their own merits (never a substitute for role eligibility). A creature
  // matching the seed's named anthem subtype gets a flat bonus, doubled when
  // the granted keyword also reinforces the inferred payoff resource (e.g.
  // an anthem granting Lifelink to Angels, feeding a life-resource payoff).
  let anthemBonus = 0;
  let anthemNote: string | null = null;
  if (anthemSpec && matchesAnthemSubtype(card, anthemSpec)) {
    const reinforcesResource = resourceSpec !== null && anthemSpec.grantedKeywords.some(
      (kw) => KEYWORD_RESOURCE_OUTPUTS[kw] === resourceSpec.name
    );
    anthemBonus = reinforcesResource ? 16 : 8;
    anthemNote = `${anthemSpec.subtype} anthem synergy +${anthemBonus}${reinforcesResource ? ` (reinforces ${resourceSpec!.name})` : ""}`;
  }

  const final = (basePowerScore * gapMultiplier - satPenalty + timing + prevention + curveBonus + cadenceBonus + anthemBonus) * colorMult * dependency.mult;

  const target = roleTargets;
  const [lo] = bestGapRole === "Enabler" ? target.enablers
    : bestGapRole === "Protection" ? target.protection
    : bestGapRole === "Consistency" ? target.consistency
    : target.payoffs;
  const current = bestGapRole === "Enabler" ? counts.enablers
    : bestGapRole === "Protection" ? counts.protection
    : bestGapRole === "Consistency" ? counts.consistency
    : counts.payoffs;
  const gap = Math.max(0, lo - current);

  const advances: string[] = [];
  if (bestGapRole === "Enabler" || bestGapRole === "Protection") advances.push("early stability");
  if (roles.includes("Enabler")) advances.push("resource production density");
  if (roles.includes("Consistency")) advances.push("payoff access");
  if (roles.includes("Protection")) advances.push("protection");

  return {
    base: basePowerScore,
    roleGapMultiplier: gapMultiplier,
    saturationPenalty: satPenalty,
    curveTimingBonus: timing,
    preventionBonus: prevention,
    final,
    note: `Selected because it fills ${bestGapRole}, current gap is ${gap}, and it improves ${[...new Set(advances)].join(" / ") || "role coverage"}.${cadence && resourceSpec ? ` [${resourceSpec.name} cadence: ${cadence} +${cadenceBonus}]` : ""}${dependency.note ? ` [${dependency.note}]` : ""}${anthemNote ? ` [${anthemNote}]` : ""}` +
      (colorMult !== 1.0 ? ` [color-balance x${colorMult.toFixed(2)}]` : "") +
      (curveBonus > 0 ? ` [cheap-curve +${curveBonus}]` : ""),
  };
}

// ── Feasibility gate ─────────────────────────────────────────────────────

export interface FeasibilityFlag {
  severity: "fail" | "warn";
  message: string;
}

export function checkFeasibility(
  counts: DeckRoleCounts,
  colorSources: { w: number; u: number },
  roleTargets: SeedRoleTargets = SEED_ROLE_TARGETS,
): FeasibilityFlag[] {
  const flags: FeasibilityFlag[] = [];

  const payoffToEnablerRatio = counts.enablers === 0 ? Infinity : counts.payoffs / counts.enablers;
  if (payoffToEnablerRatio > 2) {
    flags.push({
      severity: "fail",
      message: `Too many payoffs relative to enablers (${counts.payoffs} payoffs vs ${counts.enablers} enablers, ratio ${payoffToEnablerRatio.toFixed(2)}:1 > 2:1 ceiling).`,
    });
  }

  if (counts.protection < roleTargets.protection[0]) {
    flags.push({
      severity: "warn",
      message: `Too little interaction to preserve the seed plan (${counts.protection} protection cards, target ${roleTargets.protection[0]}-${roleTargets.protection[1]}).`,
    });
  }

  if (counts.consistency < roleTargets.consistency[0]) {
    flags.push({
      severity: "warn",
      message: `Too little draw/filtering to assemble enabler + payoff (${counts.consistency} consistency cards, target ${roleTargets.consistency[0]}-${roleTargets.consistency[1]}).`,
    });
  }

  if (counts.lands < 23 || counts.lands > 25) {
    flags.push({
      severity: "warn",
      message: `Mana base size (${counts.lands}) outside the stable 23-25 land band for repeated turns and timely payoff access.`,
    });
  }

  if (colorSources.w < 13 || colorSources.u < 11) {
    flags.push({
      severity: "warn",
      message: `Color source count may be unstable for reliable double-pip WU casting (W sources: ${colorSources.w}, U sources: ${colorSources.u}).`,
    });
  }

  return flags;
}

// ── Sequential pick log entry (for the "decision note" requirement) ─────

export interface PickLogEntry {
  cardName: string;
  roles: SeedRole[];
  score: SeedScoreBreakdown;
  countsAfterPick: DeckRoleCounts;
}
