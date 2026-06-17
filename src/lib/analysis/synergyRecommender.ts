/**
 * synergyRecommender.ts — Pre-AI synergy card recommendations.
 *
 * Given a small set of seed cards (e.g. "Space-Time Anomaly" + "Hope Estheim"),
 * this module:
 *   1. Extracts structured features from each seed (mechanic axes, type tags,
 *      oracle-text patterns, color identity).
 *   2. Queries the local Dexie card database for candidates that complement
 *      those features.
 *   3. Scores each candidate and returns a ranked list with human-readable
 *      explanations — NO AI call required.
 *
 * The results are meant to be reviewed/accepted by the user *before* the AI
 * generator is invoked, allowing curated seeds to be passed to the AI layer.
 */

import { db } from "../db";
import type { CardRecord, ManaColor } from "../types";
import {
  buildSynergyProfile,
  type MechanicAxis,
} from "../generator/synergyModel";

// ── Public types ─────────────────────────────────────────────────────────────

export interface SynergyCandidate {
  card: CardRecord;
  score: number;
  /** Short explanation of why this card was recommended. */
  reasons: string[];
  /** Which seed cards this candidate connects to */
  connectsTo: string[];
  /** Primary mechanic axis driving this recommendation */
  primaryAxis: MechanicAxis | "type-synergy" | "keyword-overlap" | "color-support";
}

export interface SynergyRecommendation {
  seeds: CardRecord[];
  candidates: SynergyCandidate[];
  /** Primary mechanic themes detected in the seed set */
  detectedThemes: string[];
  /** Narrative summary of what was found */
  narrative: string;
  /** ISO timestamp */
  computedAt: string;
}

export type RecommenderFilter = {
  /** Only show cards within this CMC range; undefined = no filter */
  maxCmc?: number;
  /** Restrict to these card types; empty = no restriction */
  typeFilter?: string[];
  /** Max results to return (default 40) */
  limit?: number;
  /** Exclude cards already in the current deck */
  excludeOracleIds?: Set<string>;
  /**
   * Format legality filter. "any" = no filter (default).
   * Options: "commander" | "standard" | "pioneer" | "modern" | "legacy" | "vintage" | "pauper"
   * Uses `legalitiesJson` for non-standard formats; falls back to `legalityStandard` for "standard".
   * Older DB rows that lack `legalitiesJson` are always allowed through.
   */
  legalityFormat?: string;
};

// ── Constants ────────────────────────────────────────────────────────────────

const ORACLE_PATTERN_GROUPS: Array<{
  name: string;
  patterns: RegExp[];
  complementPatterns: RegExp[];
  axis: MechanicAxis | "type-synergy";
}> = [
  {
    name: "Life Gain Engine",
    patterns: [/whenever you gain life/i, /each time you gain life/i],
    complementPatterns: [
      /you gain \d+ life/i,
      /gains? \d+ life/i,
      /lifelink/i,
      /you gain life/i,
      /life each turn/i,
    ],
    axis: "lifegain",
  },
  {
    name: "Life Gain Source",
    patterns: [/you gain \d+ life/i, /gains? \d+ life/i, /lifelink/i, /you gain life/i],
    complementPatterns: [/whenever you gain life/i, /each time you gain life/i],
    axis: "lifegain",
  },
  {
    name: "Mill / Library Removal",
    patterns: [/mills?/i, /puts? the top .* of .* library into .* graveyard/i, /reveal the top.*put.*(graveyard|grave)/i],
    complementPatterns: [
      /whenever .* card .* put into a graveyard from a library/i,
      /whenever .* mill/i,
      /exile.*graveyard/i,
      /return.*from.*graveyard/i,
    ],
    axis: "graveyard",
  },
  {
    name: "Graveyard Payoff",
    patterns: [
      /from (your|a|their) graveyard/i,
      /return.*from.*graveyard/i,
      /cards? in (your|a) graveyard/i,
    ],
    complementPatterns: [/discard/i, /mills?/i, /self-mill/i, /puts?.*into.*graveyard/i],
    axis: "graveyard",
  },
  {
    name: "Token Generator",
    patterns: [/create[s]? .*(token|tokens)/i, /put[s]? .*(token|tokens) onto the battlefield/i],
    complementPatterns: [
      /whenever .* creature .*(enters|token)/i,
      /for each (creature|token)/i,
      /creature[s]? you control get/i,
    ],
    axis: "tokens",
  },
  {
    name: "Token Payoff",
    patterns: [/whenever a token/i, /for each (creature|token) you control/i, /creature[s]? you control get/i],
    complementPatterns: [/create[s]? .*(token|tokens)/i, /put[s]? .*(token|tokens)/i],
    axis: "tokens",
  },
  {
    name: "Sacrifice Engine",
    patterns: [/sacrifice a/i, /whenever .* (is|are) sacrificed/i, /pay \d+ life/i],
    complementPatterns: [/sacrifice (a|an|another)/i, /when .* dies/i, /whenever .* creature (dies|is put)/i],
    axis: "sacrifice",
  },
  {
    name: "Death / ETB Trigger",
    patterns: [/whenever .* creature (dies|is put into a graveyard)/i, /when .* creature dies/i],
    complementPatterns: [/sacrifice a creature/i, /destroy target creature/i, /deal \d+ damage to .* creature/i],
    axis: "sacrifice",
  },
  {
    name: "Counter Synergy",
    patterns: [/\+1\/\+1 counter/i, /put .* \+1\/\+1 counter/i, /proliferate/i],
    complementPatterns: [/\+1\/\+1 counter/i, /for each counter/i, /whenever .* counter/i, /proliferate/i],
    axis: "counters",
  },
  {
    name: "Spell Slinger",
    patterns: [/whenever you cast .*(instant|sorcery)/i, /whenever you cast a (noncreature )?spell/i],
    complementPatterns: [/instant/i, /sorcery/i, /draw .* card/i],
    axis: "spellslinger",
  },
  {
    name: "Draw Engine",
    patterns: [/whenever .* draw .* card/i, /whenever you draw/i, /each .* draws/i],
    complementPatterns: [/draw (a|two|three|\d+) card/i, /scry/i, /look at .* top/i],
    axis: "spellslinger",
  },
  {
    name: "Enchantress",
    patterns: [/whenever you (cast|play) an enchantment/i, /whenever an enchantment (enters|is put)/i],
    complementPatterns: [/enchantment/i, /aura/i, /enchant /i],
    axis: "enchantress",
  },
  {
    name: "Artifact Synergy",
    patterns: [/whenever .* (artifact|treasure|clue|food) (enters|is (put|created))/i, /for each artifact/i],
    complementPatterns: [/create .*(treasure|clue|food)/i, /artifact/i],
    axis: "artifacts",
  },
  {
    name: "Landfall",
    patterns: [/landfall/i, /whenever a land enters/i],
    complementPatterns: [/search (your|their) library for .* land/i, /land enters.*tapped/i, /fetch/i],
    axis: "landfall",
  },
  {
    name: "Burn / Direct Damage",
    patterns: [/deals? \d+ damage to (any|each|target)/i],
    complementPatterns: [/deal .* damage/i, /whenever .* damage/i, /double the damage/i],
    axis: "burn",
  },
  {
    name: "Reanimator",
    patterns: [/return .* creature .* from .* graveyard .* battlefield/i, /put .* from .* graveyard onto the battlefield/i],
    complementPatterns: [/discard/i, /mills?/i, /puts?.*into.*graveyard/i, /high.*converted mana cost/i],
    axis: "reanimator",
  },
  {
    name: "Storm / Combo",
    patterns: [/storm/i, /copy .*(spell|ability)/i, /whenever .* cast .* spell .* copy/i],
    complementPatterns: [/instant/i, /sorcery/i, /reduced? .* cost/i],
    axis: "storm",
  },
];

// Regex patterns for oracle text that hint at a card being "generic support"
const RAMP_PATTERNS = [/search your library for .* land/i, /add \{/i, /create .* treasure/i];
const DRAW_PATTERNS = [/draw .* card/i, /scry \d/i, /look at the top/i];
const REMOVAL_PATTERNS = [/destroy target/i, /exile target/i, /deal \d+ damage to target/i, /counter target/i];
const PROTECTION_PATTERNS = [/hexproof/i, /indestructible/i, /shroud/i, /protection from/i];

// ── Main export ───────────────────────────────────────────────────────────────

/**
 * Analyse seed cards and return synergy candidate recommendations
 * pulled entirely from the local Dexie database.
 */
export async function recommendSynergyCards(
  seeds: CardRecord[],
  filter: RecommenderFilter = {}
): Promise<SynergyRecommendation> {
  const { limit = 40, excludeOracleIds = new Set<string>(), maxCmc, typeFilter = [], legalityFormat } = filter;

  if (seeds.length === 0) {
    return {
      seeds: [],
      candidates: [],
      detectedThemes: [],
      narrative: "No seed cards provided. Add cards to your deck or select seed cards to get synergy recommendations.",
      computedAt: new Date().toISOString(),
    };
  }

  // ── 1. Extract features from seeds ─────────────────────────────────────────
  const features = seeds.map(extractSeedFeatures);
  const combinedColorIds = getUnionColorIdentity(seeds);
  const allAxes = new Map<MechanicAxis, number>();
  const detectedPatterns: Set<string> = new Set();

  for (const f of features) {
    for (const axis of f.sourceAxes) allAxes.set(axis, (allAxes.get(axis) ?? 0) + 1);
    for (const axis of f.payoffAxes) allAxes.set(axis, (allAxes.get(axis) ?? 0) + 1);
    for (const pat of f.textPatternGroups) detectedPatterns.add(pat);
  }

  // Sort axes by evidence count
  const rankedAxes = [...allAxes.entries()].sort((a, b) => b[1] - a[1]).map(([axis]) => axis);

  // ── 2. Query DB for candidates ─────────────────────────────────────────────
  // Strategy: scan all cards, score each one. For 30k cards this takes ~50-150 ms.
  // We filter hard on color identity first via Dexie index, then score in JS.
  const seedIds = new Set(seeds.map((s) => s.oracleId));
  const excluded = new Set([...seedIds, ...excludeOracleIds]);

  let query = db.cards.toCollection();

  // Apply CMC filter if requested
  if (maxCmc !== undefined) {
    query = db.cards.where("cmc").belowOrEqual(maxCmc);
  }

  const allCandidates = await query.toArray();

  // ── 3. Score candidates ────────────────────────────────────────────────────
  const scored: SynergyCandidate[] = [];

  for (const card of allCandidates) {
    if (excluded.has(card.oracleId)) continue;

    // Color identity check — must be a subset of combined seed colors (or colorless)
    const cardColors = parseColors(card.colorIdentityJson);
    if (!isColorSubset(cardColors, combinedColorIds)) continue;

    // Type filter
    if (typeFilter.length > 0) {
      const hasType = typeFilter.some((t) => card.typeLine.toLowerCase().includes(t.toLowerCase()));
      if (!hasType) continue;
    }

    // Skip basic lands
    if (card.typeLine.includes("Basic Land")) continue;

    // Legality filter
    if (legalityFormat && legalityFormat !== "any" && !isCardLegalInFormat(card, legalityFormat)) continue;

    const result = scoreCandidateAgainstSeeds(card, features, rankedAxes, seeds);
    if (result.score <= 0) continue;

    scored.push(result);
  }

  // ── 4. Sort and trim ───────────────────────────────────────────────────────
  scored.sort((a, b) => b.score - a.score);
  const candidates = scored.slice(0, limit);

  // ── 5. Build metadata ──────────────────────────────────────────────────────
  const detectedThemes = buildThemeLabels(detectedPatterns, rankedAxes);
  const narrative = buildNarrative(seeds, detectedThemes, candidates.length);

  return {
    seeds,
    candidates,
    detectedThemes,
    narrative,
    computedAt: new Date().toISOString(),
  };
}

// ── Feature extraction ────────────────────────────────────────────────────────

interface SeedFeatures {
  oracleId: string;
  name: string;
  sourceAxes: MechanicAxis[];
  payoffAxes: MechanicAxis[];
  textPatternGroups: string[];
  types: string[];
  subtypes: string[];
  keywords: string[];
  colorIdentity: ManaColor[];
  cmc: number;
}

function extractSeedFeatures(card: CardRecord): SeedFeatures {
  const profile = buildSynergyProfile(card);
  const text = (card.oracleText ?? "").toLowerCase();
  const types = card.typeLine.split("—")[0]?.trim().split(/\s+/) ?? [];
  const subtypes = card.typeLine.split("—")[1]?.trim().split(/\s+/) ?? [];
  const keywords = parseStringArray(card.keywordsJson);
  const colorIdentity = parseColors(card.colorIdentityJson);

  const textPatternGroups: string[] = [];
  for (const group of ORACLE_PATTERN_GROUPS) {
    if (group.patterns.some((rx) => rx.test(text))) {
      textPatternGroups.push(group.name);
    }
  }

  return {
    oracleId: card.oracleId,
    name: card.name,
    sourceAxes: [...profile.sourceTags],
    payoffAxes: [...profile.payoffTags],
    textPatternGroups,
    types,
    subtypes,
    keywords,
    colorIdentity,
    cmc: card.cmc,
  };
}

// ── Scoring ───────────────────────────────────────────────────────────────────

function scoreCandidateAgainstSeeds(
  card: CardRecord,
  seedFeatures: SeedFeatures[],
  rankedAxes: MechanicAxis[],
  _seeds: CardRecord[]
): SynergyCandidate {
  const candidateProfile = buildSynergyProfile(card);
  const candidateText = (card.oracleText ?? "").toLowerCase();
  const candidateKeywords = parseStringArray(card.keywordsJson);
  const cardSubtypes = card.typeLine.split("—")[1]?.trim().split(/\s+/) ?? [];

  let score = 0;
  const reasons: string[] = [];
  const connectsTo: string[] = [];
  let primaryAxis: MechanicAxis | "type-synergy" | "keyword-overlap" | "color-support" = "color-support";
  let bestAxisScore = 0;

  // ── Source/payoff axis matching ─────────────────────────────────────────────
  for (const sf of seedFeatures) {
    for (const axis of sf.payoffAxes) {
      if (candidateProfile.sourceTags.has(axis)) {
        const axisScore = 4 + (rankedAxes.indexOf(axis) < 2 ? 2 : 0);
        score += axisScore;
        if (axisScore > bestAxisScore) { bestAxisScore = axisScore; primaryAxis = axis; }
        if (!connectsTo.includes(sf.name)) connectsTo.push(sf.name);
        addReason(reasons, `Supplies ${axis} that ${sf.name} rewards.`);
      }
    }
    for (const axis of sf.sourceAxes) {
      if (candidateProfile.payoffTags.has(axis)) {
        const axisScore = 4 + (rankedAxes.indexOf(axis) < 2 ? 2 : 0);
        score += axisScore;
        if (axisScore > bestAxisScore) { bestAxisScore = axisScore; primaryAxis = axis; }
        if (!connectsTo.includes(sf.name)) connectsTo.push(sf.name);
        addReason(reasons, `Rewards ${axis} that ${sf.name} supplies.`);
      }
    }
    // Shared axes (both in deck already, candidate extends the axis)
    for (const axis of sf.sourceAxes) {
      if (candidateProfile.sourceTags.has(axis) && sf.payoffAxes.includes(axis)) {
        score += 2;
        if (!connectsTo.includes(sf.name)) connectsTo.push(sf.name);
        addReason(reasons, `Extends ${axis} axis shared with ${sf.name}.`);
      }
    }
  }

  // ── Text complement pattern matching ────────────────────────────────────────
  for (const sf of seedFeatures) {
    for (const group of ORACLE_PATTERN_GROUPS) {
      const seedMatchesPattern = sf.textPatternGroups.includes(group.name);
      const candidateMatchesComplement = group.complementPatterns.some((rx) => rx.test(candidateText));
      if (seedMatchesPattern && candidateMatchesComplement) {
        score += 3;
        if (!connectsTo.includes(sf.name)) connectsTo.push(sf.name);
        addReason(reasons, `Complements "${group.name}" from ${sf.name}.`);
        if (primaryAxis === "color-support") primaryAxis = group.axis as MechanicAxis;
      }
    }
  }

  // ── Tribal / type synergy ────────────────────────────────────────────────────
  for (const sf of seedFeatures) {
    // Candidate shares a subtype with a seed → tribal synergy
    const sharedSubtypes = cardSubtypes.filter((st) =>
      st.length > 1 && sf.subtypes.includes(st) && !["the", "of"].includes(st.toLowerCase())
    );
    if (sharedSubtypes.length > 0) {
      score += 3 * sharedSubtypes.length;
      if (!connectsTo.includes(sf.name)) connectsTo.push(sf.name);
      addReason(reasons, `Shares tribe(s): ${sharedSubtypes.join(", ")} with ${sf.name}.`);
      if (primaryAxis === "color-support") primaryAxis = "type-synergy";
    }

    // Candidate's text references a subtype of the seed
    for (const sub of sf.subtypes) {
      if (sub.length > 2 && candidateText.includes(sub.toLowerCase())) {
        score += 2;
        addReason(reasons, `References ${sub} (type of ${sf.name}).`);
      }
    }
  }

  // ── Keyword overlap ─────────────────────────────────────────────────────────
  for (const sf of seedFeatures) {
    const shared = candidateKeywords.filter((kw) => sf.keywords.includes(kw) && kw.length > 2);
    if (shared.length > 0) {
      score += shared.length;
      addReason(reasons, `Shared keywords with ${sf.name}: ${shared.slice(0, 2).join(", ")}.`);
      if (primaryAxis === "color-support") primaryAxis = "keyword-overlap";
    }
  }

  // ── Generic support bonus ───────────────────────────────────────────────────
  // Cards that draw cards, ramp, remove threats, or protect are always useful
  const isRamp = RAMP_PATTERNS.some((rx) => rx.test(candidateText));
  const isDraw = DRAW_PATTERNS.some((rx) => rx.test(candidateText));
  const isRemoval = REMOVAL_PATTERNS.some((rx) => rx.test(candidateText));
  const isProtection = PROTECTION_PATTERNS.some((rx) => rx.test(candidateText));

  if (isRamp && score > 0) { score += 1; addReason(reasons, "Provides mana acceleration."); }
  if (isDraw && score > 0) { score += 1; addReason(reasons, "Provides card draw."); }
  if (isRemoval && score > 0) { score += 0.5; addReason(reasons, "Interaction / removal."); }
  if (isProtection && score > 0) { score += 0.5; }

  // ── EDHREC popularity slight tiebreaker ─────────────────────────────────────
  if (card.edhrecRank != null && score > 0) {
    // Lower rank = more popular. Normalize to 0–0.5 bonus.
    score += Math.max(0, 0.5 - card.edhrecRank / 20_000);
  }

  return {
    card,
    score: Math.round(score * 100) / 100,
    reasons: reasons.slice(0, 4),
    connectsTo,
    primaryAxis,
  };
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function isCardLegalInFormat(card: CardRecord, format: string): boolean {
  if (!format || format === "any") return true;
  if (format === "standard") return card.legalityStandard === "legal";
  if (card.legalitiesJson) {
    try {
      const legalities = JSON.parse(card.legalitiesJson) as Record<string, string>;
      const status = legalities[format];
      return status === "legal" || status === "restricted";
    } catch { return true; }
  }
  // Older DB rows without legalitiesJson: allow through rather than hiding valid cards
  return true;
}

function addReason(list: string[], reason: string): void {
  if (!list.includes(reason) && list.length < 5) list.push(reason);
}

function parseColors(jsonStr: string): ManaColor[] {
  try { return JSON.parse(jsonStr || "[]") as ManaColor[]; }
  catch { return []; }
}

function parseStringArray(jsonStr: string): string[] {
  try { return JSON.parse(jsonStr || "[]") as string[]; }
  catch { return []; }
}

function getUnionColorIdentity(seeds: CardRecord[]): ManaColor[] {
  const colors = new Set<ManaColor>();
  for (const seed of seeds) {
    for (const c of parseColors(seed.colorIdentityJson)) colors.add(c);
  }
  return [...colors];
}

function isColorSubset(cardColors: ManaColor[], deckColors: ManaColor[]): boolean {
  if (deckColors.length === 0) return true; // no seeds = no restriction
  return cardColors.every((c) => deckColors.includes(c));
}

function buildThemeLabels(patterns: Set<string>, axes: MechanicAxis[]): string[] {
  const themes: string[] = [];
  // Prioritize detected text patterns
  for (const p of patterns) {
    if (themes.length < 5) themes.push(p);
  }
  // Fill with top axes
  for (const axis of axes) {
    const label = axisToLabel(axis);
    if (!themes.includes(label)) {
      themes.push(label);
      if (themes.length >= 6) break;
    }
  }
  return themes;
}

function axisToLabel(axis: MechanicAxis): string {
  const map: Partial<Record<MechanicAxis, string>> = {
    lifegain: "Life Gain",
    graveyard: "Graveyard",
    tokens: "Tokens",
    sacrifice: "Sacrifice",
    spellslinger: "Spellslinger",
    enchantress: "Enchantress",
    artifacts: "Artifacts",
    counters: "+1/+1 Counters",
    landfall: "Landfall",
    burn: "Burn",
    reanimator: "Reanimator",
    storm: "Storm/Combo",
    mill: "Mill",
    stax: "Stax",
  };
  return map[axis] ?? axis;
}

function buildNarrative(seeds: CardRecord[], themes: string[], candidateCount: number): string {
  if (seeds.length === 0) return "No seeds provided.";
  const seedNames = seeds.map((s) => s.name).join(", ");
  if (themes.length === 0) return `Analyzed ${seedNames}. No strong mechanic themes detected — showing color-identity matches.`;
  const themeStr = themes.slice(0, 3).join(", ");
  return `Based on ${seedNames}: detected ${themeStr} themes. Found ${candidateCount} synergy suggestion${candidateCount !== 1 ? "s" : ""} sorted by relevance.`;
}
