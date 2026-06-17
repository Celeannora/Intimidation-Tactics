import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import type { Archetype } from "../archetype";
import { assignRoles, isThreat, type CardRole } from "../roles";
import { computePowerScore } from "../powerScore";
import { IDEAL_CURVES, recommendColorSources, parsePips, type ArchetypeCurveProfile } from "../manaBase";
import type { GenerateOptions, KeywordFocus, ScoreBreakdown } from "./types";
import { axisScore, buildSynergyProfile, crossAxisCompositionBonus, keywordFocusToAxes, summarizeSynergyConnections, synergyDensityMultiplier, tribalCardBonus } from "./synergyModel";
import { colorAffinity } from "./colorWeights";
import {
  getCardConfig,
  getDeckConfig,
} from "../config/scoringConfig";
import { computeMetaPerformance } from "../meta/metaScoring";
import {
  ARCHETYPE_PROFILES,
  computeProfileLoss,
  computeRedundancyScore,
  rolesToBuckets,
  cmcToCurveBin,
  type CurveBin,
  type RoleBucket,
} from "../config/archetypeProfiles";

/**
 * Research-backed scoring engine.
 *
 * Per-card score:
 *   cardScore(c, deck) =
 *     roleWeight(archetype, c) * powerScore(c)            // base power × role fit
 *   + V2 directional scoring (axisScore + synergyDensityMultiplier)  // source→payoff synergy
 *   + keywordBonus(c, keywordFocus)                       // user mechanic preference
 *   - cmcPenalty(c, archetype, speed)                     // off-curve penalty
 *   - pricePenalty(c, totalBudgetUsd)                     // budget pressure
 *
 * Whole-deck score:
 *   deckScore(deck, opts) =
 *     Σ cardScore(c, deck)
 *   - 4.0 * curveDeviation(deck, archetype, speed)        // Wasserstein-1 vs ideal
 *   - 6.0 * (1 - manaBaseCoverage(deck))                  // Frank Karsten coverage
 *
 * Higher = better. Optimizer maximizes this.
 */

// Per-archetype role multipliers — how much each card type matters.
const ROLE_WEIGHT: Record<Archetype, Partial<Record<CardRole | "Threat" | "default", number>>> = {
  Aggro:     { Beater: 2.1, EvasiveThreat: 2.3, Removal: 1.8, Protection: 1.2, BoardWipe: 0.05, Counterspell: 0.1, CardDraw: 0.8, Ramp: 0.2, Threat: 1.8, default: 0.55 },
  Midrange:  { Beater: 1.6, EvasiveThreat: 1.6, ValueEngine: 2.4, Removal: 2.2, Discard: 2.0, CardDraw: 1.8, BoardWipe: 1.4, Counterspell: 1.4, Threat: 1.5, default: 0.8 },
  Control:   { BoardWipe: 2.7, Counterspell: 2.8, CardDraw: 2.4, Removal: 2.4, Discard: 2.0, Bounce: 1.7, Finisher: 1.5, default: 0.45 },
  Tempo:     { EvasiveThreat: 2.4, Counterspell: 2.3, Bounce: 2.0, Removal: 1.8, Discard: 1.7, CardDraw: 1.5, Threat: 1.5, default: 0.65 },
  Combo:     { Tutor: 2.4, CardDraw: 2.0, Ramp: 1.6, Counterspell: 1.8, Discard: 1.8, Finisher: 1.5, default: 0.75 },
  Ramp:      { Ramp: 2.5, LandFetch: 2.2, BoardWipe: 1.8, Removal: 1.6, Finisher: 1.9, CardDraw: 1.5, default: 0.65 },
  Prison:    { BoardWipe: 2.2, Removal: 2.2, Counterspell: 2.0, CardDraw: 1.8, ValueEngine: 1.6, Finisher: 1.4, default: 0.5 },
  Unknown:   { Removal: 1.9, Counterspell: 1.5, Discard: 1.5, CardDraw: 1.4, Threat: 1.3, default: 0.75 },
};

const ARCHETYPE_TO_CURVE_PROFILE: Record<Archetype, ArchetypeCurveProfile> = {
  Aggro: "aggro", Tempo: "aggro",
  Midrange: "midrange",
  Control: "control", Prison: "control",
  Combo: "combo", Ramp: "control",
  Unknown: "midrange",
};

const KEYWORD_PATTERNS: Record<KeywordFocus, RegExp> = {
  Flying:    /\bflying\b/i,
  Trample:   /\btrample\b/i,
  Tokens:    /\b(create|creates) .* token/i,
  "Go-Wide Tokens": /\b(create|creates) .* token|tokens you control|creatures you control get/i,
  Sacrifice: /\bsacrifice (a|an|another)\b/i,
  Aristocrats: /\bsacrifice|whenever .* dies|each opponent loses|drain/i,
  Graveyard: /\bgraveyard\b/i,
  Reanimator: /return .* from your graveyard|reanimate|graveyard/i,
  Mill: /\bmill|put .* library .* graveyard/i,
  Lifegain:  /\bgain (\d+|x) life|\blifelink\b/i,
  Counters:  /\b\+1\/\+1 counter|\bcounter on\b/i,
  "+1/+1 Counters": /\b\+1\/\+1 counter|proliferate|adapt|evolve/i,
  Discard:   /\bdiscard(?:s|ed|ing)?\b|target (?:opponent|player) discards|each (?:opponent|player) discards|whenever .* discards/i,
  "Hand Disruption": /target (?:opponent|player) reveals|target (?:opponent|player) discards|each opponent discards|look at .* hand|exile .* from .* hand|opponent.*discard/i,
  "Self-Discard/Looting": /you may discard|discard a card:?|draw .* discard|discard .* draw|loot|rummage|from your graveyard|return .* from your graveyard/i,
  Spellslinger: /instant or sorcery|whenever you cast|magecraft|storm/i,
  Prowess: /\bprowess\b|whenever you cast .* noncreature/i,
  "ETB/Blink": /enters the battlefield|exile .* then return|blink|flicker/i,
  Enchantress: /enchantment|constellation|whenever you cast an enchantment/i,
  Artifacts: /artifact|treasure token|clue token|food token/i,
  Ramp: /add \{|search your library for .* land|mana/i,
  "Big Mana": /add \{|search your library for .* land|mana|costs? .* less|x spell|x damage/i,
  "Tribal Support": /choose a creature type|creatures? of the chosen type|other .* you control get|for each .* you control/i,
  "Voltron/Auras": /aura|equip|enchanted creature|equipped creature|get[s]? \+|has lifelink|has flying/i,
  Stompy: /trample|power [4-9]|gets \+\d\/\+\d|creatures you control get/i,
  "Flash/Draw-Go": /\bflash\b|as though .* flash|counter target|draw .* card|instant|until end of turn|return target/i,
  "Evasion Tempo": /\bflying\b|\bmenace\b|can't be blocked|unblockable|return target|counter target|tap target/i,
  "Artifacts/Tokens": /artifact|treasure token|clue token|food token|map token|blood token|whenever .* artifact|for each artifact/i,
  "Draw-Go Control": /counter target|draw .* card|instant|flash|destroy target|exile target/i,
};

export function roleMultiplier(card: CardRecord, archetype: Archetype): number {
  const weights = ROLE_WEIGHT[archetype];
  const def = weights.default ?? 1.0;
  const roles = assignRoles(card);
  if (roles.length === 0) return def;

  let max = def;
  if (isThreat(roles) && weights.Threat) max = Math.max(max, weights.Threat);
  for (const r of roles) {
    const w = weights[r];
    if (w !== undefined && w > max) max = w;
  }
  return max;
}

export function keywordBonus(card: CardRecord, focus: KeywordFocus[] | undefined): number {
  if (!focus || focus.length === 0) return 0;
  const haystack = (card.oracleText ?? "") + " " + (card.keywordsJson ?? "") + " " + (card.typeLine ?? "");
  let bonus = 0;
  for (const kw of focus) {
    if (KEYWORD_PATTERNS[kw].test(haystack)) bonus += 4;
  }
  return bonus;
}

export function focusCardBonus(card: CardRecord, options: GenerateOptions): number {
  const focusEntries = options.focusEntries ?? [];
  if (focusEntries.length === 0) return 0;
  return focusEntries.some((entry) => entry.card.oracleId === card.oracleId) ? 14 : 0;
}

/**
 * Soft-prefer bonus. Cards in `preferEntries` are not pinned into the deck,
 * but receive a strong score boost so the optimizer is much more likely to
 * include them. Smaller than focusCardBonus because the card isn't locked.
 */
export function preferCardBonus(card: CardRecord, options: GenerateOptions): number {
  const preferEntries = options.preferEntries ?? [];
  if (preferEntries.length === 0) return 0;
  if (!preferEntries.some((entry) => entry.card.oracleId === card.oracleId)) return 0;
  const roles = assignRoles(card);
  let bonus = 55;
  if (roles.includes("Ramp") || roles.includes("LandFetch")) bonus += 16;
  if (roles.includes("CardDraw") || roles.includes("Tutor")) bonus += 14;
  if (roles.some((role) => ["Removal", "Counterspell", "BoardWipe", "Bounce", "Discard"].includes(role))) bonus += 12;
  return bonus;
}

/** Penalize cards above the target average MV for the archetype/speed. */
export function cmcPenalty(card: CardRecord, archetype: Archetype, targetAvgCmc: number): number {
  if (card.typeLine.includes("Land")) return 0;
  const overshoot = Math.max(0, card.cmc - (targetAvgCmc + 1));
  // Stronger penalty for fast archetypes
  const slope = archetype === "Aggro" ? 4 : 2;
  return overshoot * slope;
}

/** Penalize expensive cards proportional to total deck budget. */
export function pricePenalty(card: CardRecord, totalBudgetUsd: number | undefined): number {
  if (totalBudgetUsd == null || card.priceUsd == null) return 0;
  // If a single card eats >5% of budget, penalize linearly above that.
  const fivePct = totalBudgetUsd * 0.05;
  if (card.priceUsd <= fivePct) return 0;
  return Math.min(15, (card.priceUsd - fivePct) * 0.5);
}

function efficiencyScore(card: CardRecord, roles: CardRole[], archetype: Archetype): number {
  if (card.typeLine.includes("Land")) return 0;
  let score = 0;
  if (roles.includes("Removal") && card.cmc <= 2) score += 4;
  else if (roles.includes("Removal") && card.cmc <= 3) score += 2;
  if (roles.includes("Counterspell") && card.cmc <= 3) score += 4;
  if (roles.includes("Discard") && card.cmc <= 2) score += 3;
  if (roles.includes("Bounce") && card.cmc <= 2) score += 2;
  if (roles.includes("BoardWipe") && card.cmc <= 4) score += 3;
  if (roles.includes("CardDraw") && card.cmc <= 3) score += 2;
  if (isThreat(roles) && (archetype === "Aggro" || archetype === "Tempo") && card.cmc <= 2) score += 3;
  return score;
}

function flexibilityScore(card: CardRecord, roles: CardRole[]): number {
  const text = (card.oracleText ?? "").toLowerCase();
  let score = 0;
  if (roles.length >= 2) score += 1.5;
  if (/choose (one|two)|up to one|or planeswalker|nonland permanent|artifact or enchantment|creature or planeswalker/i.test(text)) score += 2.5;
  if (card.layout === "split" || card.layout === "adventure" || card.layout === "modal_dfc") score += 1.5;
  if ((roles.includes("Removal") || roles.includes("Counterspell")) && roles.includes("CardDraw")) score += 2;
  return score;
}

function ladderBo1Score(card: CardRecord, roles: CardRole[], options: GenerateOptions): number {
  if (options.format !== "standard" || options.playEnvironment !== "bo1") return 0;
  let score = 0;
  const text = (card.oracleText ?? "").toLowerCase();
  if (roles.some((r) => ["Removal", "Counterspell", "Discard", "Bounce", "BoardWipe"].includes(r))) score += card.cmc <= 3 ? 2.5 : 1;
  if (roles.includes("Lifegain") && (options.archetype === "Control" || options.archetype === "Midrange")) score += 1;
  if (roles.includes("GraveyardHate") && !text.includes("draw a card")) score -= 1.5;
  if (card.cmc >= 5 && options.archetype !== "Ramp" && options.archetype !== "Control") score -= 2;
  return score;
}

function deadCardPenalty(card: CardRecord, roles: CardRole[], options: GenerateOptions): number {
  if (card.typeLine.includes("Land")) return 0;
  let penalty = 0;
  if (card.cmc >= 6 && options.archetype !== "Ramp" && options.archetype !== "Control") penalty += 3;
  if (roles.includes("BoardWipe") && (options.archetype === "Aggro" || options.archetype === "Tempo")) penalty += 5;
  if (options.playEnvironment === "bo1" && roles.includes("GraveyardHate") && roles.length === 1) penalty += 2;
  return penalty;
}

export function cardScore(
  card: CardRecord,
  deckSoFar: DeckEntry[],
  options: GenerateOptions,
  targetAvgCmc: number
): number {
  return cardScoreDetail(card, deckSoFar, options, targetAvgCmc).total;
}

export interface CardScoreDetail {
  total: number;
  roleMultiplier: number;
  powerScore: number;
  colorAffinity: number;
  rolePowerContribution: number;
  synergyScore: number;
  synergyContribution: number;
  directionalScore: number;
  directionalContribution: number;
  synergyMultiplier: number;
  compositionBonus: number;
  signalScore: number;
  signalContribution: number;
  efficiencyContribution: number;
  flexibilityContribution: number;
  ladderContribution: number;
  focusBonus: number;
  focusCardBonus: number;
  preferCardBonus: number;
  tribalBonus: number;
  cmcPenalty: number;
  pricePenalty: number;
}

export function cardScoreDetail(
  card: CardRecord,
  deckSoFar: DeckEntry[],
  options: GenerateOptions,
  targetAvgCmc: number
): CardScoreDetail {
  const roles = assignRoles(card);
  const power = computePowerScore(card);
  const role = roleMultiplier(card, options.archetype);
  const pieStrength = options.colorPieStrength ?? 1.0;
  const colorAff = colorAffinity(card, pieStrength);
  const focus = keywordBonus(card, options.keywordFocus);
  const focusCard = focusCardBonus(card, options);
  const preferCard = preferCardBonus(card, options);
  const tribal = tribalCardBonus(card, options.tribalSupport);
  const deckProfiles = deckSoFar
    .filter((e) => !e.card.typeLine.includes("Land"))
    .map((e) => buildSynergyProfile(e.card));
  const deckAxes = keywordFocusToAxes(options.keywordFocus ?? []);
  const profile = buildSynergyProfile(card);
  const directional = axisScore(card, profile, deckAxes, deckProfiles);
  const connectionSummary = summarizeSynergyConnections(profile, deckProfiles);
  const synergyMultiplier = synergyDensityMultiplier(connectionSummary);
  const compositionBonus = crossAxisCompositionBonus(profile, deckProfiles);
  const cmcPen = cmcPenalty(card, options.archetype, targetAvgCmc);
  const pricePen = pricePenalty(card, options.totalBudgetUsd);
  const efficiency = efficiencyScore(card, roles, options.archetype);
  const flexibility = flexibilityScore(card, roles);
  const ladder = ladderBo1Score(card, roles, options);
  const deadCardPen = deadCardPenalty(card, roles, options);
  // Load config for current format/environment
  const cardCfg = getCardConfig(options.format, options.playEnvironment);

  const rawRolePowerContribution = role * power * colorAff;
  const rolePowerContribution = rawRolePowerContribution <= cardCfg.rolePowerLinearCap
    ? rawRolePowerContribution
    : cardCfg.rolePowerLinearCap + Math.log1p(rawRolePowerContribution - cardCfg.rolePowerLinearCap) * cardCfg.rolePowerLogSlope;

  // Config-driven directional contribution with log-compression
  const rawSynergy = directional * synergyMultiplier;
  let compressedSynergy: number;
  if (rawSynergy <= cardCfg.directionalLinearCap) {
    compressedSynergy = rawSynergy;
  } else {
    compressedSynergy = cardCfg.directionalLinearCap + Math.log1p(rawSynergy - cardCfg.directionalLinearCap) * cardCfg.directionalLogSlope;
  }
  const directionalContribution = Math.min(cardCfg.directionalMaxContribution, cardCfg.directionalScalar * compressedSynergy);
  const efficiencyContribution = cardCfg.efficiencyScalar * efficiency;
  const flexibilityContribution = cardCfg.flexibilityScalar * flexibility;
  const ladderContribution = cardCfg.ladderScalar * ladder;

  const total =
    rolePowerContribution +
    directionalContribution +
    compositionBonus +
    efficiencyContribution +
    flexibilityContribution +
    ladderContribution +
    focus +
    focusCard +
    preferCard +
    tribal -
    cmcPen -
    pricePen -
    deadCardPen;

  return {
    total,
    roleMultiplier: role,
    powerScore: power,
    colorAffinity: colorAff,
    rolePowerContribution,
    synergyScore: directional,
    synergyContribution: directionalContribution,
    directionalScore: directional,
    directionalContribution,
    synergyMultiplier,
    compositionBonus,
    signalScore: directional,
    signalContribution: directionalContribution * 0.12,
    efficiencyContribution,
    flexibilityContribution,
    ladderContribution,
    focusBonus: focus,
    focusCardBonus: focusCard,
    preferCardBonus: preferCard,
    tribalBonus: tribal,
    cmcPenalty: cmcPen,
    pricePenalty: pricePen + deadCardPen,
  };
}

/**
 * Wasserstein-1 distance between the deck's nonland CMC distribution and
 * the archetype's ideal curve. Lower = better fit.
 * Range: 0 (exact match) to ~2 (worst case).
 */
export function curveDeviation(entries: DeckEntry[], archetype: Archetype): number {
  const profile = ARCHETYPE_TO_CURVE_PROFILE[archetype];
  const ideal = IDEAL_CURVES[profile];

  const nonlands = entries.filter((e) => !e.card.typeLine.includes("Land"));
  const total = nonlands.reduce((s, e) => s + e.quantity, 0);
  if (total === 0) return 2;

  const actual = new Array<number>(8).fill(0);
  for (const e of nonlands) {
    const slot = Math.min(7, Math.floor(e.card.cmc));
    actual[slot] += e.quantity;
  }
  const actualPct = actual.map((c) => c / total);

  // Cumulative distribution function distance (Wasserstein-1 on integer support).
  let cumA = 0;
  let cumB = 0;
  let dist = 0;
  for (let i = 0; i < 8; i++) {
    cumA += actualPct[i];
    cumB += ideal[i];
    dist += Math.abs(cumA - cumB);
  }
  return dist;
}

/**
 * Coverage of the Frank-Karsten "minimum sources per pip" thresholds.
 * Returns 0–1 (1 = fully covered, 0 = catastrophically undersourced).
 */
export function manaBaseCoverage(entries: DeckEntry[]): number {
  const lands = entries.filter((e) => e.card.typeLine.includes("Land"));
  const totalLands = lands.reduce((s, e) => s + e.quantity, 0);
  if (totalLands === 0) return 0;

  const sourcesPerColor: Record<"W" | "U" | "B" | "R" | "G", number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const e of lands) {
    const ci = (() => {
      try {
        return JSON.parse(e.card.colorIdentityJson) as ("W" | "U" | "B" | "R" | "G")[];
      } catch {
        return [] as ("W" | "U" | "B" | "R" | "G")[];
      }
    })();
    for (const c of ci) sourcesPerColor[c] += e.quantity;
  }

  const recs = recommendColorSources(entries, totalLands);
  if (recs.length === 0) return 1;

  let covered = 0;
  for (const rec of recs) {
    const have = sourcesPerColor[rec.color];
    const need = rec.recommendedSources;
    if (need <= 0) covered += 1;
    else covered += Math.min(1, have / need);
  }
  return covered / recs.length;
}

export interface DeckScore {
  total: number;
  cardScoreSum: number;
  curveDeviation: number;
  manaBaseCoverage: number;
  /** role-profile loss (lower is better, 0 = perfect fit). */
  profileLoss: number;
  /** redundancy score (0–20, higher = more robust engines). */
  redundancyScore: number;
  /** meta performance score ([−20, +20], positive = favorable matchups). */
  metaPerformance: number;
  /** curve penalty term. */
  curvePenalty: number;
  /** mana coverage penalty term. */
  manaPenalty: number;
  /** role profile penalty term. */
  profilePenalty: number;
  /** redundancy contribution term. */
  redundancyContribution: number;
  /** meta performance contribution term. */
  metaPerformanceContribution: number;
}

/**
 * Compute deck-level role bucket counts and curve histogram from entries.
 */
function computeDeckRoleProfile(entries: DeckEntry[]): {
  buckets: Partial<Record<RoleBucket, number>>;
  curve: Record<CurveBin, number>;
  landCount: number;
} {
  const buckets: Partial<Record<RoleBucket, number>> = {};
  const curve: Record<CurveBin, number> = { 0: 0, 1: 0, 2: 0, 3: 0, 4: 0, 5: 0, 6: 0, 7: 0 };
  let landCount = 0;

  for (const e of entries) {
    if (e.card.typeLine.includes("Land")) {
      landCount += e.quantity;
    } else {
      const roles = assignRoles(e.card);
      const roleBuckets = rolesToBuckets(roles, e.card.cmc);
      for (const bucket of roleBuckets) {
        buckets[bucket] = (buckets[bucket] ?? 0) + e.quantity;
      }
      // Also count synergy engine cards (any card with an active engine-related role)
      const profile = buildSynergyProfile(e.card);
      const er = profile.engineRole;
      if (er === "engine" || er === "enabler" || er === "payoff") {
        buckets["synergyEngine"] = (buckets["synergyEngine"] ?? 0) + e.quantity;
      }

      const bin = cmcToCurveBin(e.card.cmc);
      curve[bin] = (curve[bin] ?? 0) + e.quantity;
    }
  }
  return { buckets, curve, landCount };
}

/**
 * Compute redundancy metrics from synergy profiles of all nonland cards.
 */
function computeDeckRedundancy(entries: DeckEntry[]): number {
  const nonlands = entries.filter((e) => !e.card.typeLine.includes("Land"));
  if (nonlands.length === 0) return 0;

  const profiles = nonlands.map((e) => buildSynergyProfile(e.card));

  // Aggregate per-axis counts across the deck using sourceTags and payoffTags
  const axisData = new Map<string, { sources: number; payoffs: number; engines: number }>();
  for (const p of profiles) {
    for (const axis of p.sourceTags) {
      const existing = axisData.get(axis) ?? { sources: 0, payoffs: 0, engines: 0 };
      existing.sources += 1;
      axisData.set(axis, existing);
    }
    for (const axis of p.payoffTags) {
      const existing = axisData.get(axis) ?? { sources: 0, payoffs: 0, engines: 0 };
      existing.payoffs += 1;
      axisData.set(axis, existing);
    }
    // Count engines/enablers per axis — if the card has an engine role and any source/payoff tag,
    // attribute an engine count to those axes
    if (p.engineRole === "engine") {
      for (const axis of new Set([...p.sourceTags, ...p.payoffTags])) {
        const existing = axisData.get(axis) ?? { sources: 0, payoffs: 0, engines: 0 };
        existing.engines += 1;
        axisData.set(axis, existing);
      }
    }
  }

  // Determine primary axes by coverage (simple heuristic: sources + payoffs >= 5)
  const axisProfiles = Array.from(axisData.entries()).map(([, data]) => ({
    sources: data.sources,
    payoffs: data.payoffs,
    engines: data.engines,
    isPrimary: data.sources + data.payoffs >= 5,
  }));

  const metrics = computeRedundancyScore(axisProfiles);
  return metrics.score;
}

export function deckScore(
  entries: DeckEntry[],
  options: GenerateOptions,
  targetAvgCmc: number
): DeckScore {
  const deckCfg = getDeckConfig(options.format, options.playEnvironment);

  let cardScoreSum = 0;
  for (const e of entries) {
    if (e.card.typeLine.includes("Land")) continue;
    cardScoreSum += cardScore(e.card, entries, options, targetAvgCmc) * e.quantity;
  }
  const curveDev = curveDeviation(entries, options.archetype);
  const coverage = manaBaseCoverage(entries);

  // Compute role profile loss
  const profile = computeDeckRoleProfile(entries);
  const archetypeProfile = ARCHETYPE_PROFILES[options.archetype];
  const profileLoss = computeProfileLoss(
    profile.buckets,
    profile.curve,
    profile.landCount,
    archetypeProfile,
  );

  // Compute redundancy score
  const redundancy = computeDeckRedundancy(entries);

  // Apply config-driven multipliers
  const curvePenalty = deckCfg.curveDeviationMultiplier * curveDev;
  const manaPenalty = deckCfg.manaCoverageMultiplier * (1 - coverage);
  const profilePenalty = deckCfg.roleProfileLossMultiplier * profileLoss;
  const redundancyContribution = deckCfg.redundancyMultiplier * redundancy;

  // Compute meta performance against specified targets
  const metaPerf = computeMetaPerformance(
    entries.map((e) => ({ card: e.card, quantity: e.quantity })),
    options.metaTargets ?? undefined,
    undefined, // metaContext — pass undefined until wired from snapshot
  );
  const metaPerformanceContribution = deckCfg.metaPerformanceMultiplier * metaPerf;

  const total =
    cardScoreSum +
    redundancyContribution +
    metaPerformanceContribution -
    curvePenalty -
    manaPenalty -
    profilePenalty;

  return {
    total,
    cardScoreSum,
    curveDeviation: curveDev,
    manaBaseCoverage: coverage,
    profileLoss,
    redundancyScore: redundancy,
    metaPerformance: metaPerf,
    curvePenalty,
    manaPenalty,
    profilePenalty,
    redundancyContribution,
    metaPerformanceContribution,
  };
}

export function buildScoreBreakdown(
  entries: DeckEntry[],
  options: GenerateOptions,
  targetAvgCmc: number
): ScoreBreakdown {
  const cardScores = entries
    .filter((e) => !e.card.typeLine.includes("Land"))
    .map((entry) => {
      const detail = cardScoreDetail(entry.card, entries, options, targetAvgCmc);
      return {
        oracleId: entry.card.oracleId,
        name: entry.card.name,
        quantity: entry.quantity,
        board: entry.board,
        perCopyScore: detail.total,
        contribution: detail.total * entry.quantity,
        roleMultiplier: detail.roleMultiplier,
        powerScore: detail.powerScore,
        rolePowerContribution: detail.rolePowerContribution,
        colorAffinity: detail.colorAffinity,
        synergyScore: detail.synergyScore,
        synergyContribution: detail.synergyContribution,
        directionalScore: detail.directionalScore,
        directionalContribution: detail.directionalContribution,
        synergyMultiplier: detail.synergyMultiplier,
        compositionBonus: detail.compositionBonus,
        signalScore: detail.signalScore,
        signalContribution: detail.signalContribution,
        efficiencyContribution: detail.efficiencyContribution,
        flexibilityContribution: detail.flexibilityContribution,
        ladderContribution: detail.ladderContribution,
        focusBonus: detail.focusBonus,
        focusCardBonus: detail.focusCardBonus,
        tribalBonus: detail.tribalBonus,
        cmcPenalty: detail.cmcPenalty,
        pricePenalty: detail.pricePenalty,
      };
    })
    .sort((a, b) => b.contribution - a.contribution);

  const score = deckScore(entries, options, targetAvgCmc);

  return {
    cardScores,
    totals: {
      cardScoreSum: score.cardScoreSum,
      curvePenalty: score.curvePenalty,
      manaPenalty: score.manaPenalty,
      profilePenalty: score.profilePenalty,
      redundancyContribution: score.redundancyContribution,
      finalScore: score.total,
    },
  };
}

/** Compute the avg-CMC target for an archetype, optionally overridden by SpeedProfile. */
export function targetAvgCmcFor(options: GenerateOptions, defaultAvg: number): number {
  if (options.speed === "fast") return Math.min(defaultAvg, 2.2);
  if (options.speed === "slow") return Math.max(defaultAvg, 3.4);
  if (options.speed === "midrange") return 3.0;
  return defaultAvg;
}

/** Used by the pool builder to pre-rank by simple heuristic before deeper scoring. */
export function quickRank(card: CardRecord, archetype: Archetype): number {
  return roleMultiplier(card, archetype) * computePowerScore(card)
    - (card.edhrecRank ? card.edhrecRank / 1000 : 5)
    + (card.gameChanger ? 5 : 0);
}

/** Pip parser re-export so the optimizer can use it for color-source counting. */
export { parsePips };