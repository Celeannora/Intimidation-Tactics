/**
 * newSetPipeline.ts — New set onboarding pipeline
 *
 * Implements sonar.md Part 9 — New Set Onboarding Pipeline.
 *
 * When a new MTG set is ingested into the card database, each card must be
 * enriched with:
 *   1. Role classification  (assignRoles → CardRole[])
 *   2. Secondary oracle tags (deriveSecondaryTags → SecondaryCardTag[])
 *   3. Synergy profile       (buildSynergyProfile → SynergyProfile with
 *                             sourceTags / payoffTags / engineRole)
 *
 * The result is an `EnrichedCardRecord` — a `CardRecord` extended with the
 * above derived fields so the generator, scorer, and UI can consume them
 * without re-computing on every generation pass.
 *
 * Usage:
 *   const enriched = runNewSetPipeline(rawCards);
 *   // Store enriched records back to the database / IndexedDB collection.
 */

import type { CardRecord } from "../types";
import { assignRoles, deriveSecondaryTags, type CardRole, type SecondaryCardTag } from "../roles";
import { buildSynergyProfile, type EngineRole, type MechanicAxis } from "../generator/synergyModel";

// ── Enriched record type ──────────────────────────────────────────────────────

/**
 * A `CardRecord` augmented with the three enrichment layers produced by the
 * new-set pipeline.  All three fields are derived deterministically from the
 * card's oracle text and type line, so they can always be re-derived from
 * the base record if needed.
 */
export interface EnrichedCardRecord extends CardRecord {
  /** Role classification from assignRoles (e.g. Threat, Removal, Enabler, Payoff). */
  roles: CardRole[];
  /** Oracle-text secondary tags (e.g. evasive, flash, two_for_one). */
  secondaryTags: SecondaryCardTag[];
  /** Synergy profile: which mechanic axes the card supplies/rewards and its engine role. */
  synergyProfile: {
    engineRole: EngineRole;
    sourceTags: MechanicAxis[];
    payoffTags: MechanicAxis[];
  };
}

// ── Pipeline stages ───────────────────────────────────────────────────────────

/**
 * Stage 1: Assign role classification.
 * Pure function — safe to call in parallel or batch.
 */
export function enrichWithRoles(card: CardRecord): CardRole[] {
  return assignRoles(card);
}

/**
 * Stage 2: Derive secondary oracle tags.
 * Pure function — safe to call in parallel or batch.
 */
export function enrichWithSecondaryTags(card: CardRecord): SecondaryCardTag[] {
  return deriveSecondaryTags(card);
}

/**
 * Stage 3: Build synergy profile (sourceTags, payoffTags, engineRole).
 * Pure function — safe to call in parallel or batch.
 */
export function enrichWithSynergyProfile(card: CardRecord): EnrichedCardRecord["synergyProfile"] {
  const profile = buildSynergyProfile(card);
  return {
    engineRole: profile.engineRole,
    // buildSynergyProfile returns Set<MechanicAxis> — convert to array for serialisation.
    sourceTags: [...profile.sourceTags] as MechanicAxis[],
    payoffTags: [...profile.payoffTags] as MechanicAxis[],
  };
}

// ── Full pipeline ─────────────────────────────────────────────────────────────

/**
 * Run the full new-set onboarding pipeline on a batch of raw `CardRecord` objects.
 *
 * Each card is enriched in-memory with role classification, secondary oracle
 * tags, and a synergy profile.  The original record is not mutated — a new
 * `EnrichedCardRecord` object is returned for each input card.
 *
 * @param cards - Raw card records ingested from the Scryfall bulk-data import.
 * @returns Enriched card records ready for storage and generator consumption.
 */
export function runNewSetPipeline(cards: CardRecord[]): EnrichedCardRecord[] {
  return cards.map((card) => {
    const roles = enrichWithRoles(card);
    const secondaryTags = enrichWithSecondaryTags(card);
    const synergyProfile = enrichWithSynergyProfile(card);

    return {
      ...card,
      // Persist secondary tags back onto the record so CardRecord.secondaryTags is populated.
      secondaryTags,
      roles,
      synergyProfile,
    };
  });
}

// ── Incremental / single-card enrichment ─────────────────────────────────────

/**
 * Enrich a single card record (useful for incremental updates when a single
 * card is added or corrected in the database without re-running the full batch).
 */
export function enrichSingleCard(card: CardRecord): EnrichedCardRecord {
  return runNewSetPipeline([card])[0];
}

// ── Pipeline summary ──────────────────────────────────────────────────────────

export interface PipelineSummary {
  total: number;
  withRoles: number;
  withEnablerRole: number;
  withPayoffRole: number;
  withFlashTag: number;
  withTwoForOneTag: number;
  withGraveyardFillingTag: number;
  axisDistribution: Partial<Record<MechanicAxis, number>>;
}

/**
 * Compute a diagnostic summary of an enriched card batch.
 * Useful for logging after ingesting a new set to verify the pipeline is
 * extracting meaningful signal.
 */
export function computePipelineSummary(enriched: EnrichedCardRecord[]): PipelineSummary {
  const axisDistribution: Partial<Record<MechanicAxis, number>> = {};

  let withRoles = 0;
  let withEnablerRole = 0;
  let withPayoffRole = 0;
  let withFlashTag = 0;
  let withTwoForOneTag = 0;
  let withGraveyardFillingTag = 0;

  for (const card of enriched) {
    if (card.roles.length > 0) withRoles++;
    if (card.roles.includes("Enabler")) withEnablerRole++;
    if (card.roles.includes("Payoff")) withPayoffRole++;
    if (card.secondaryTags.includes("flash")) withFlashTag++;
    if (card.secondaryTags.includes("two_for_one")) withTwoForOneTag++;
    if (card.secondaryTags.includes("graveyard_filling")) withGraveyardFillingTag++;

    for (const axis of card.synergyProfile.sourceTags) {
      axisDistribution[axis] = (axisDistribution[axis] ?? 0) + 1;
    }
    for (const axis of card.synergyProfile.payoffTags) {
      axisDistribution[axis] = (axisDistribution[axis] ?? 0) + 1;
    }
  }

  return {
    total: enriched.length,
    withRoles,
    withEnablerRole,
    withPayoffRole,
    withFlashTag,
    withTwoForOneTag,
    withGraveyardFillingTag,
    axisDistribution,
  };
}
