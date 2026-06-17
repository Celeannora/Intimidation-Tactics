/**
 * metaScoring.ts — Meta-aware scoring components
 *
 * Extends the core scoring engine with meta-data-driven adjustments.
 *
 * MetaContext holds per-card and per-archetype performance statistics
 * loaded from external snapshots or manual curation.  The scoring
 * functions in this module inject bounded meta-based corrections into
 * card power scores, role multipliers, and deck-level evaluations so
 * that the engine can differentiate between generically strong cards
 * and cards that are well-positioned in the current metagame.
 *
 * All functions are pure, config-driven, and accept a MetaContext
 * (which may be undefined to degrade gracefully when no meta data is
 * available).
 */

import type { CardRecord } from "../types";
import type { Archetype } from "../archetype";
import type { MetaArchetype } from "./types";
import { getMetaConfig, type MetaConfig } from "../config/scoringConfig";
import { assignRoles } from "../roles";

// ── Meta data types ───────────────────────────────────────────────────────

/** Per-card performance statistics derived from metagame data. */
export interface CardMetaStats {
  /** Oracle ID this stat record applies to. */
  oracleId: string;

  /** Inclusion rate among winning / tiered decks (0–1). */
  inclusionRate: number;

  /** Approximate win-rate delta when drawn (positive = above average). */
  winRateDelta: number;

  /** How many distinct meta archetypes commonly use this card. */
  archetypeCount: number;

  /** Optional: which meta archetypes this card is specifically strong against (ids). */
  effectiveAgainst?: string[];

  /** Optional: which meta archetypes this card is specifically weak against (ids). */
  weakAgainst?: string[];
}

/** Per-archetype performance statistics. */
export interface ArchetypeMetaStats {
  archetypeId: string;
  metaShare: number;
  avgWinRate: number;
  /** Key threats / permanents this archetype relies on (card names). */
  keyThreats: string[];
  /** Common interaction patterns (removal types, counters, discard). */
  commonInteraction: string[];
}

/**
 * A lightweight meta context passed into scoring functions.
 * When undefined, meta-aware scoring functions return their base value
 * with no adjustment.
 */
export interface MetaContext {
  /** Card-level meta statistics keyed by oracleId. */
  cardStats: Map<string, CardMetaStats>;

  /** Archetype-level meta statistics keyed by archetypeId. */
  archetypeStats: Map<string, ArchetypeMetaStats>;

  /** Top meta archetype ids sorted by metaShare descending. */
  topArchetypes: string[];

  /** Source description (e.g. manual curation, API). */
  source: string;

  /** ISO 8601 last updated timestamp. */
  updatedAt: string;
}

// ── Meta stats manager ────────────────────────────────────────────────────

/**
 * Lightweight manager for loading and querying meta stats.
 * Supports loading from JSON and runtime querying.
 */
export class MetaStatsManager {
  private context: MetaContext | null = null;

  /** Load meta context from a JSON-compatible object (e.g. from a bundled snapshot). */
  loadFromJSON(json: {
    cardStats: Record<string, CardMetaStats>;
    archetypeStats: Record<string, ArchetypeMetaStats>;
    topArchetypes: string[];
    source: string;
    updatedAt: string;
  }): void {
    this.context = {
      cardStats: new Map(Object.entries(json.cardStats)),
      archetypeStats: new Map(Object.entries(json.archetypeStats)),
      topArchetypes: json.topArchetypes,
      source: json.source,
      updatedAt: json.updatedAt,
    };
  }

  /** Build a MetaContext from a MetaArchetype snapshot array (simplified bridge). */
  buildFromSnapshot(snapshot: MetaArchetype[]): MetaContext {
    const archetypeStats = new Map<string, ArchetypeMetaStats>();
    const cardStats = new Map<string, CardMetaStats>();
    const topArchetypes: string[] = [];

    for (const arch of snapshot) {
      archetypeStats.set(arch.id, {
        archetypeId: arch.id,
        metaShare: arch.metaShare,
        avgWinRate: 0.5, // default neutral
        keyThreats: arch.keyCards,
        commonInteraction: arch.commonInteraction,
      });
      topArchetypes.push(arch.id);

      // Seed basic card stats for key cards (placeholder inclusion rates)
      for (const cardName of arch.keyCards) {
        const existing = cardStats.get(cardName);
        if (existing) {
          existing.inclusionRate = Math.min(1, existing.inclusionRate + 0.3);
          existing.archetypeCount += 1;
          existing.effectiveAgainst = existing.effectiveAgainst ?? [];
        } else {
          cardStats.set(cardName, {
            oracleId: cardName, // simplified — real impl maps by oracleId
            inclusionRate: 0.7,
            winRateDelta: 0.02,
            archetypeCount: 1,
          });
        }
      }
    }

    // Sort by metaShare descending
    const sorted = snapshot.slice().sort((a, b) => b.metaShare - a.metaShare);
    const topIds = sorted.map((a) => a.id);

    return {
      cardStats,
      archetypeStats,
      topArchetypes: topIds,
      source: "snapshot-derived",
      updatedAt: new Date().toISOString(),
    };
  }

  getContext(): MetaContext | null {
    return this.context;
  }
}

// ── Meta-aware scoring functions ──────────────────────────────────────────

/**
 * Compute a meta-adjusted power score for a card.
 * Adds a bounded meta impact term on top of the base power score.
 *
 * @param basePowerScore — the raw computePowerScore value (0–40).
 * @param card — the card record.
 * @param metaContext — optional meta context; if undefined, returns basePowerScore.
 * @param config — optional overrides for meta config coefficients.
 */
export function computeMetaAdjustedPower(
  basePowerScore: number,
  card: CardRecord,
  metaContext?: MetaContext,
  config?: MetaConfig,
): { adjustedPower: number; metaImpact: number } {
  if (!metaContext) return { adjustedPower: basePowerScore, metaImpact: 0 };

  const cfg = config ?? getMetaConfig();
  const stats = metaContext.cardStats.get(card.oracleId);

  if (!stats) return { adjustedPower: basePowerScore, metaImpact: 0 };

  // Meta impact: inclusion rate × winRateDelta × scalar
  let metaImpact = stats.inclusionRate * (stats.winRateDelta + 0.01) * cfg.metaImpactScalar * 100;

  // Bonus for highly versatile cards (used in many archetypes)
  if (stats.archetypeCount >= 3) metaImpact += 2;
  if (stats.archetypeCount >= 6) metaImpact += 3;

  // Clamp to a reasonable range
  metaImpact = Math.max(-8, Math.min(8, metaImpact));

  return {
    adjustedPower: basePowerScore + metaImpact,
    metaImpact,
  };
}

/**
 * Compute a meta-adjusted role multiplier.
 * Applies small, bounded adjustments to the base role multiplier based on
 * how valuable certain roles are in the current meta.
 *
 * @param baseRole — the base roleMultiplier value.
 * @param card — the card record.
 * @param archetype — the deck's macro archetype.
 * @param metaContext — optional meta context.
 * @param config — optional meta config overrides.
 */
export function computeMetaAdjustedRole(
  baseRole: number,
  card: CardRecord,
  _archetype: Archetype,
  metaContext?: MetaContext,
  config?: MetaConfig,
): { adjustedRole: number; metaRoleAdjustment: number } {
  if (!metaContext || metaContext.topArchetypes.length === 0) {
    return { adjustedRole: baseRole, metaRoleAdjustment: 0 };
  }

  const cfg = config ?? getMetaConfig();
  const roles = assignRoles(card);

  let adjustment = 0;

  // Aggregate meta archetypes and their shares
  const topMeta = metaContext.topArchetypes.slice(0, 5);
  for (const archId of topMeta) {
    const archStats = metaContext.archetypeStats.get(archId);
    if (!archStats) continue;

    const threatDensity = archStats.keyThreats.length > 5 ? 0.3 : -0.1;

    // Boost removal in creature-heavy metas
    if (roles.includes("Removal") || roles.includes("BoardWipe")) {
      adjustment += archStats.metaShare * threatDensity * 0.5;
    }

    // Boost counterspell and discard in combo / spell-heavy metas
    const interactionTypes = archStats.commonInteraction.map((s) => s.toLowerCase());
    const isSpellHeavy = interactionTypes.some((i) =>
      i.includes("counter") || i.includes("draw") || i.includes("combo"),
    );
    if (roles.includes("Counterspell") && isSpellHeavy) {
      adjustment += archStats.metaShare * 0.4;
    }
    if (roles.includes("Discard") && isSpellHeavy) {
      adjustment += archStats.metaShare * 0.3;
    }

    // Boost lifegain in aggro-heavy metas
    if (archStats.keyThreats.length > 4 && roles.includes("Lifegain")) {
      adjustment += archStats.metaShare * 0.25;
    }
  }

  // Clamp adjustment
  adjustment = Math.max(-cfg.metaRoleAdjustmentCap, Math.min(cfg.metaRoleAdjustmentCap, adjustment));

  return {
    adjustedRole: baseRole + adjustment,
    metaRoleAdjustment: adjustment,
  };
}

/**
 * Compute a meta performance score: how well a deck is positioned against
 * specified meta targets, using simple matchup proxies.
 *
 * @param deckEntries — current deck entries.
 * @param metaTargets — archetype IDs the deck is supposed to beat.
 * @param metaContext — meta context containing archetype stats.
 * @returns a score in [−20, +20] where positive = favorable matchups.
 */
export function computeMetaPerformance(
  deckEntries: Array<{ card: CardRecord; quantity: number }>,
  metaTargets: string[] | undefined,
  metaContext?: MetaContext,
): number {
  if (!metaContext || !metaTargets || metaTargets.length === 0) return 0;

  let performanceScore = 0;

  for (const targetId of metaTargets) {
    const archStats = metaContext.archetypeStats.get(targetId);
    if (!archStats) continue;

    // Count how many key threats the deck can answer
    let answeredThreats = 0;
    for (const entry of deckEntries) {
      const cardText = (entry.card.oracleText ?? "").toLowerCase();
      const hasRemoval = /destroy|exile|deal \d+ damage|-\d+\/-\d+|counter target/i.test(cardText);
      const hasDiscard = /discard/i.test(cardText);

      if (hasRemoval || hasDiscard) {
        answeredThreats += entry.quantity;
      }
    }

    // Simple proxy: more interaction = better matchup
    const interactionRatio = Math.min(1, answeredThreats / Math.max(1, deckEntries.reduce((s, e) => s + e.quantity, 0)));
    const coverageBonus = interactionRatio * 10;

    // Bonus if deck includes cards flagged as effective against this archetype
    let effectiveCardBonus = 0;
    for (const entry of deckEntries) {
      const stats = metaContext.cardStats.get(entry.card.oracleId);
      if (stats?.effectiveAgainst?.includes(targetId)) {
        effectiveCardBonus += 2 * entry.quantity;
      }
    }

    performanceScore += (coverageBonus + effectiveCardBonus) * archStats.metaShare;
  }

  // Normalize and clamp
  const normalized = Math.round(performanceScore * 10) / 10;
  return Math.max(-20, Math.min(20, normalized));
}