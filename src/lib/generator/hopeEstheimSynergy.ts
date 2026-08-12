/**
 * hopeEstheimSynergy.ts — Synergy-first deckbuilding instructions for the
 * Hope Estheim / Space-Time Anomaly / Authority of the Consuls seed.
 *
 * TEST BRANCH MODULE. This is intentionally isolated from the shared
 * scoring engine (`scoreEngine.ts`, `scoringConfig.ts`) rather than
 * rewriting those shared files in place. It exists to trial a sequential,
 * role-gap-aware, saturation-penalized generation pass for one specific
 * seed before any of this logic is proposed for the general-purpose
 * generator. Nothing here is wired into the app's default pipeline.
 *
 * Core identity being enforced
 * -----------------------------
 * Build a 60-card Azorius lifegain-mill-control deck, Standard format.
 * The deck wins by converting life gain and preserved life total into mill:
 *
 *  - Hope Estheim ({W}{U}, 2/2 Lifelink) — ENGINE. At your end step, each
 *    opponent mills X cards, where X is the life *gained this turn* only.
 *    Source: https://scryfall.com/card/fin/226/hope-estheim
 *  - Space-Time Anomaly ({2}{W}{U} sorcery) — PAYOFF. Target player mills
 *    cards equal to your *total life total* at resolution (not life gained
 *    that turn — this is the key mechanical distinction from Hope).
 *    Source: https://www.pojo.com/space-time-anomaly/
 *  - Authority of the Consuls ({W} enchantment) — PREMIUM ENABLER. Opposing
 *    creatures enter tapped; you gain 1 life whenever an opponent's
 *    creature enters. This is a *reactive* trigger (fires off opponents'
 *    plays, not a repeatable activated source), so it must be scored as
 *    variance-reducing tempo + incidental lifegain, not as a controlled
 *    lifegain engine on its own.
 *    Source: https://gatherer.wizards.com/pages/card/Details.aspx?multiverseid=417578
 *
 * The deck should play like Azorius control with a lifegain-mill finish —
 * not generic creature-lifegain beatdown, and not a pile of individually
 * powerful "good stuff" cards with no engine support.
 */

import type { CardRecord } from "../types";
import { assignRoles, deriveSecondaryTags } from "../roles";

// ── Role model for this seed ────────────────────────────────────────────

/**
 * This seed's roles are a narrower, purpose-built taxonomy layered on top
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

export const SEED_ROLE_TARGETS: SeedRoleTargets = {
  enablers: [10, 14],
  protection: [8, 12],
  consistency: [6, 10],
  payoffs: [6, 8],
  lands: 24,
};

export const SEED_PACKAGE: Record<string, number> = {
  "Hope Estheim": 4,
  "Authority of the Consuls": 4,
  "Space-Time Anomaly": 4, // upper end of the 3-4 instructed range
};

// ── Seed role classification ────────────────────────────────────────────

const LIFEGAIN_TEXT = /\bgain(?:s)?\b.*\blife\b|\blife\b.*\bgain/;
const REPEATABLE_LIFEGAIN_HINTS = [
  "whenever you gain life",
  "whenever a creature enters the battlefield under your control",
  "whenever another creature enters",
  "at the beginning of your upkeep",
  "lifelink",
];
const CANTRIP_HINT = /draws? a card/;
const FILTER_HINT = /surveil|scry|look at the top/;
const TUTOR_HINT = /search your library for a/;
const RECURSION_HINT = /return .* from your graveyard to (your hand|the battlefield)/;
const COUNTER_HINT = /counter target spell|counter that spell/;
const SWEEPER_HINT = /destroy all creatures|each creature gets -|deals \d+ damage to each creature/;
const REMOVAL_HINT = /destroy target creature|exile target creature|deals? \d+ damage to target creature|-\d\/-\d until end of turn/;
// Scoped to damage prevention that protects the PLAYER's life total (what
// Space-Time Anomaly reads and what keeps Hope's turn-gain nonzero) —
// deliberately excludes "prevent damage to [a permanent/creature]" self
// protection clauses, which are a different effect entirely.
const DAMAGE_PREVENTION_HINT = /prevent (all|the next|that) damage that would be dealt to (you|a player|each player|target player)|damage that would be dealt to you is prevented|fog\b/;
const TEMPO_TAX_HINT = /enters? (the battlefield )?tapped|can't attack|can't block|skip.*(untap|combat)/;
// A tax effect only supports the seed plan when it constrains the OPPONENT
// (Authority of the Consuls, Ghostly Prison, etc.). Cards with self-imposed
// drawbacks ("this creature can't attack unless...") must not earn Enabler —
// checked sentence-by-sentence so an opponent clause elsewhere in the card
// can't validate a self-restriction sentence.
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
export function classifySeedRoles(card: CardRecord): SeedRole[] {
  const text = (card.oracleText ?? "").toLowerCase();
  const name = card.name;
  const roles: Set<SeedRole> = new Set();
  const baseRoles = assignRoles(card);
  const tags = deriveSecondaryTags(card);

  // Seed payoffs are locked by name; everything else earns Payoff only if
  // it is a very small number of redundant finishers (see feasibility gate).
  if (SEED_PACKAGE[name] !== undefined) {
    roles.add("Payoff");
  }

  // ENABLER: recurring lifegain, lifelink, or low-cost setup that turns on
  // Hope (life gained *this turn*) or increases Space-Time Anomaly
  // lethality (raises total life total).
  if (
    tags.includes("lifelink") ||
    LIFEGAIN_TEXT.test(text) ||
    REPEATABLE_LIFEGAIN_HINTS.some((h) => text.includes(h)) ||
    isOpponentTax(text) // Authority-style tax effects that indirectly enable lifegain windows
  ) {
    roles.add("Enabler");
  }

  // PROTECTION: removal, counters, sweepers, or tempo plays that preserve
  // life total and buy time. Damage prevention is explicitly treated as
  // combo support (it directly raises the life total Space-Time Anomaly
  // reads, and keeps Hope's turn-gain nonzero by avoiding losses).
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
  // that finds engine pieces (Hope, Authority, Space-Time Anomaly).
  if (
    baseRoles.includes("CardDraw") ||
    baseRoles.includes("Tutor") ||
    CANTRIP_HINT.test(text) ||
    FILTER_HINT.test(text) ||
    TUTOR_HINT.test(text) ||
    RECURSION_HINT.test(text)
  ) {
    roles.add("Consistency");
  }

  return [...roles];
}

export function isSeedEligible(card: CardRecord): boolean {
  return classifySeedRoles(card).length > 0;
}

/**
 * Which target-band roles are already at or above their ceiling for the
 * given deck state. Used by sequential fill loops to hard-skip a role
 * once it is full, instead of relying solely on the soft multiplier fade
 * (the fade alone still let one role dominate a fill pass in testing).
 */
export function rolesAtCeiling(counts: DeckRoleCounts): Set<SeedRole> {
  const atCeiling = new Set<SeedRole>();
  if (counts.enablers >= SEED_ROLE_TARGETS.enablers[1]) atCeiling.add("Enabler");
  if (counts.protection >= SEED_ROLE_TARGETS.protection[1]) atCeiling.add("Protection");
  if (counts.consistency >= SEED_ROLE_TARGETS.consistency[1]) atCeiling.add("Consistency");
  if (counts.payoffs >= SEED_ROLE_TARGETS.payoffs[1]) atCeiling.add("Payoff");
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

export function tallyRoleCounts(entries: { card: CardRecord; quantity: number }[]): DeckRoleCounts {
  const counts = emptyRoleCounts();
  for (const { card, quantity } of entries) {
    if (card.typeLine.includes("Land")) {
      counts.lands += quantity;
      continue;
    }
    const roles = classifySeedRoles(card);
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

  // Curve check: among nonland nonseed picks, require a healthy floor of
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
function roleGapMultiplier(role: SeedRole, counts: DeckRoleCounts): number {
  const target = SEED_ROLE_TARGETS;
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
function curveTimingBonus(card: CardRecord, roles: SeedRole[]): number {
  const cmc = card.cmc;
  let bonus = 0;
  if (cmc <= 2 && (roles.includes("Enabler") || roles.includes("Consistency"))) bonus += 6;
  if (cmc >= 2 && cmc <= 4 && (roles.includes("Payoff") || roles.includes("Protection"))) bonus += 4;
  if (cmc >= 4 && card.name === "Space-Time Anomaly") bonus += 8; // T4+ payoff turn
  return bonus;
}

/**
 * Rule 4 — Damage prevention as combo support, not generic utility.
 * Prevention effects preserve/raise the life total Space-Time Anomaly
 * reads, and keep Hope's turn-gain nonzero by avoiding net losses.
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
// ── Resource cadence (seed-agnostic engine) ─────────────────────────────
// A seed\'s payoff consumes some RESOURCE (life gained this turn, artifacts,
// tokens, cards in graveyard, ...). Enabler quality is about the CADENCE of
// producing that resource, not the mere presence of matching text:
//   repeatable-proactive  — the card produces the resource every turn on the
//                           controller\'s own initiative (static combat
//                           keywords like lifelink, self-driven per-turn
//                           triggers).
//   repeatable-conditional — recurring production that depends on opponent
//                           actions.
//   one-shot              — a single burst; fuels the payoff once, then is
//                           spent.
// The ENGINE below is generic; each seed module supplies only DATA (a
// ResourceSpec) describing how its resource is produced. For a graveyard
// seed the spec would list keywords like "mill" and a /put.*into.*graveyard/
// trigger pattern instead — no engine change needed.
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

export function resourceCadence(card: CardRecord, spec: ResourceSpec): ResourceCadence {
  const text = (card.oracleText ?? "").toLowerCase();
  const isCreature = card.typeLine.includes("Creature");
  const hasStaticProducer = spec.staticProducerKeywords.some(
    (k) => new RegExp(`\\b${k.toLowerCase()}\\b`).test(text) || (card.keywordsJson ?? "").includes(k)
  );
  if (isCreature && hasStaticProducer) return "repeatable-proactive";
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

// Seed DATA for Hope Estheim / Space-Time Anomaly: the payoff consumes
// "life gained this turn", produced statically by lifelink combat damage.
export const HOPE_ESTHEIM_RESOURCE: ResourceSpec = {
  name: "lifegain",
  staticProducerKeywords: ["Lifelink"],
  triggerProductionPattern: /gain[^.]*life/,
  oneShotProductionPattern: /gain(s)?\s+(\d+|x|that much)\s+life/,
  weightedRole: "Enabler",
};

// Activation-cost dependencies: a card whose ability needs OTHER resources is
// only worth its text if the deck can actually pay the cost. Found via the
// bulk-DB pool: Technodrome ("{T}, Sacrifice another artifact: Draw a card")
// scored as a Consistency engine in a deck with zero other artifacts — a dead
// ability. Patterns are seed-agnostic and extensible.
const COST_DEPENDENCIES: { pattern: RegExp; resource: "artifacts" | "creatures"; minimum: number }[] = [
  { pattern: /sacrifice (another|an) artifact/i, resource: "artifacts", minimum: 6 },
  { pattern: /sacrifice (another|a) creature/i, resource: "creatures", minimum: 8 },
];

function costDependencyPenalty(
  card: CardRecord,
  adjustments?: DeckAdjustments
): { mult: number; note: string | null } {
  const support = adjustments?.supportCounts;
  if (!support) return { mult: 1, note: null };
  const text = card.oracleText ?? "";
  for (const dep of COST_DEPENDENCIES) {
    if (dep.pattern.test(text) && support[dep.resource] < dep.minimum) {
      return {
        mult: 0.25,
        note: `cost-dependency penalty x0.25: needs ${dep.resource} to sacrifice, deck has ${support[dep.resource]} (min ${dep.minimum})`,
      };
    }
  }
  return { mult: 1, note: null };
}

export function scoreCandidate(
  card: CardRecord,
  counts: DeckRoleCounts,
  basePowerScore: number,
  adjustments?: DeckAdjustments,
): SeedScoreBreakdown {
  const roles = classifySeedRoles(card);
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
  const gapMultipliers = roles.map((r) => roleGapMultiplier(r, counts));
  const gapMultiplier = Math.max(...gapMultipliers);
  const bestGapRole = roles[gapMultipliers.indexOf(gapMultiplier)];

  const satPenalty = Math.max(...roles.map((r) => saturationPenalty(r, counts)));
  const timing = curveTimingBonus(card, roles);
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

  // Resource-cadence bonus — only for cards filling the seed's weighted
  // role; a repeatable proactive producer feeds the payoff EVERY turn, so it
  // outranks equal-power one-shot or opponent-conditional production.
  const spec = HOPE_ESTHEIM_RESOURCE;
  const cadence = roles.includes(spec.weightedRole) ? resourceCadence(card, spec) : null;
  const cadenceBonus = cadence ? CADENCE_BONUS[cadence] : 0;

  const final = (basePowerScore * gapMultiplier - satPenalty + timing + prevention + curveBonus + cadenceBonus) * colorMult * dependency.mult;

  const target = SEED_ROLE_TARGETS;
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
  if (roles.includes("Enabler")) advances.push("life gain density");
  if (roles.includes("Consistency")) advances.push("payoff access");
  if (roles.includes("Protection")) advances.push("protection");

  return {
    base: basePowerScore,
    roleGapMultiplier: gapMultiplier,
    saturationPenalty: satPenalty,
    curveTimingBonus: timing,
    preventionBonus: prevention,
    final,
    note: `Selected because it fills ${bestGapRole}, current gap is ${gap}, and it improves ${[...new Set(advances)].join(" / ") || "role coverage"}.${cadence ? ` [${spec.name} cadence: ${cadence} +${cadenceBonus}]` : ""}${dependency.note ? ` [${dependency.note}]` : ""}` +
      (colorMult !== 1.0 ? ` [color-balance x${colorMult.toFixed(2)}]` : "") +
      (curveBonus > 0 ? ` [cheap-curve +${curveBonus}]` : ""),
  };
}

// ── Feasibility gate ─────────────────────────────────────────────────────

export interface FeasibilityFlag {
  severity: "fail" | "warn";
  message: string;
}

export function checkFeasibility(counts: DeckRoleCounts, colorSources: { w: number; u: number }): FeasibilityFlag[] {
  const flags: FeasibilityFlag[] = [];

  const payoffToEnablerRatio = counts.enablers === 0 ? Infinity : counts.payoffs / counts.enablers;
  if (payoffToEnablerRatio > 2) {
    flags.push({
      severity: "fail",
      message: `Too many payoffs relative to enablers (${counts.payoffs} payoffs vs ${counts.enablers} enablers, ratio ${payoffToEnablerRatio.toFixed(2)}:1 > 2:1 ceiling).`,
    });
  }

  if (counts.protection < SEED_ROLE_TARGETS.protection[0]) {
    flags.push({
      severity: "warn",
      message: `Too little cheap interaction to preserve life total (${counts.protection} protection cards, target ${SEED_ROLE_TARGETS.protection[0]}-${SEED_ROLE_TARGETS.protection[1]}).`,
    });
  }

  if (counts.consistency < SEED_ROLE_TARGETS.consistency[0]) {
    flags.push({
      severity: "warn",
      message: `Too little draw/filtering to assemble enabler + payoff (${counts.consistency} consistency cards, target ${SEED_ROLE_TARGETS.consistency[0]}-${SEED_ROLE_TARGETS.consistency[1]}).`,
    });
  }

  if (counts.lands < 23 || counts.lands > 25) {
    flags.push({
      severity: "warn",
      message: `Mana base size (${counts.lands}) outside the stable Azorius control band (23-25) for repeated turns and turn-4 Space-Time Anomaly access.`,
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
