/**
 * archetypeProfiles.ts — Archetype-specific role and curve target profiles
 *
 * Defines desired counts of key roles, mana-curve distributions, and
 * land-count targets for each macro-archetype.  Used by deckScore to compute
 * a profile-loss term that penalizes decks deviating from their archetype's
 * structural expectations.
 *
 * Ranges are expressed as [min, max] counts for a 60-card deck (scaled
 * proportionally for Commander / Limited).
 */

import type { Archetype } from "../archetype";
import type { CardRole } from "../roles";

// ── Role bucket keys ──────────────────────────────────────────────────────

export type RoleBucket =
  | "threat"
  | "earlyThreat"
  | "removal"
  | "sweeper"
  | "counterspell"
  | "discard"
  | "bounce"
  | "cardDraw"
  | "ramp"
  | "tutor"
  | "finisher"
  | "lifegain"
  | "protection"
  | "graveyardHate"
  | "synergyEngine"; // cards tagged as engine/enabler/payoff

// ── Curve bin indices ─────────────────────────────────────────────────────

export type CurveBin = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7; // 0 = 0-CMC, 7 = 7+

export interface RoleProfile {
  /** [min, max] for each role bucket. Use 0 for irrelevant buckets. */
  buckets: Partial<Record<RoleBucket, [min: number, max: number]>>;

  /** [min, max] count of nonland cards in each CMC bin. */
  curve: Record<CurveBin, [min: number, max: number]>;

  /** Suggested land count range. */
  lands: [min: number, max: number];
}

// ── Profile definitions ───────────────────────────────────────────────────
//
// These are tuned for 60-card constructed decks.  Commander variants should
// scale counts by ~1.67× (100 / 60) when the profile is applied.

const AGGR0_PROFILE: RoleProfile = {
  buckets: {
    threat:          [16, 24],
    earlyThreat:     [12, 18],
    removal:         [6, 10],
    sweeper:         [0, 0],
    counterspell:    [0, 2],
    discard:         [0, 3],
    bounce:          [0, 2],
    cardDraw:        [2, 6],
    ramp:            [0, 2],
    finisher:        [0, 3],
    protection:      [0, 4],
    graveyardHate:   [0, 2],
    synergyEngine:   [4, 14],
  },
  curve: {
    0: [0, 2],
    1: [8, 14],
    2: [8, 14],
    3: [4, 8],
    4: [0, 4],
    5: [0, 2],
    6: [0, 1],
    7: [0, 1],
  },
  lands: [18, 22],
};

const TEMPO_PROFILE: RoleProfile = {
  buckets: {
    threat:          [12, 18],
    earlyThreat:     [8, 14],
    removal:         [6, 10],
    sweeper:         [0, 1],
    counterspell:    [4, 8],
    discard:         [2, 6],
    bounce:          [2, 6],
    cardDraw:        [4, 8],
    ramp:            [0, 2],
    finisher:        [0, 3],
    protection:      [0, 4],
    graveyardHate:   [0, 2],
    synergyEngine:   [6, 16],
  },
  curve: {
    0: [0, 2],
    1: [6, 12],
    2: [8, 14],
    3: [4, 10],
    4: [2, 6],
    5: [0, 3],
    6: [0, 2],
    7: [0, 1],
  },
  lands: [20, 24],
};

const MIDRANGE_PROFILE: RoleProfile = {
  buckets: {
    threat:          [10, 16],
    earlyThreat:     [4, 10],
    removal:         [8, 14],
    sweeper:         [0, 3],
    counterspell:    [0, 4],
    discard:         [2, 6],
    bounce:          [0, 3],
    cardDraw:        [4, 10],
    ramp:            [0, 4],
    finisher:        [2, 6],
    lifegain:        [0, 4],
    protection:      [0, 4],
    graveyardHate:   [0, 3],
    synergyEngine:   [6, 18],
  },
  curve: {
    0: [0, 2],
    1: [4, 10],
    2: [6, 12],
    3: [6, 12],
    4: [4, 8],
    5: [2, 6],
    6: [0, 4],
    7: [0, 2],
  },
  lands: [24, 27],
};

const CONTROL_PROFILE: RoleProfile = {
  buckets: {
    threat:          [2, 8],
    earlyThreat:     [0, 4],
    removal:         [8, 16],
    sweeper:         [3, 7],
    counterspell:    [4, 10],
    discard:         [2, 6],
    bounce:          [0, 4],
    cardDraw:        [6, 14],
    ramp:            [2, 6],
    finisher:        [2, 6],
    lifegain:        [0, 4],
    protection:      [0, 4],
    graveyardHate:   [0, 4],
    synergyEngine:   [4, 12],
  },
  curve: {
    0: [0, 2],
    1: [2, 6],
    2: [4, 10],
    3: [4, 10],
    4: [4, 8],
    5: [2, 6],
    6: [0, 4],
    7: [0, 2],
  },
  lands: [26, 28],
};

const COMBO_PROFILE: RoleProfile = {
  buckets: {
    threat:          [4, 10],
    earlyThreat:     [0, 4],
    removal:         [6, 12],
    sweeper:         [1, 4],
    counterspell:    [2, 8],
    discard:         [2, 6],
    bounce:          [0, 3],
    cardDraw:        [6, 14],
    ramp:            [2, 8],
    tutor:           [2, 8],
    finisher:        [2, 6],
    protection:      [0, 4],
    graveyardHate:   [0, 3],
    synergyEngine:   [8, 22],
  },
  curve: {
    0: [0, 3],
    1: [2, 8],
    2: [4, 12],
    3: [4, 12],
    4: [2, 8],
    5: [0, 6],
    6: [0, 4],
    7: [0, 3],
  },
  lands: [22, 26],
};

const RAMP_PROFILE: RoleProfile = {
  buckets: {
    threat:          [4, 12],
    earlyThreat:     [0, 4],
    removal:         [6, 12],
    sweeper:         [1, 4],
    counterspell:    [0, 3],
    discard:         [0, 3],
    bounce:          [0, 2],
    cardDraw:        [4, 10],
    ramp:            [8, 16],
    finisher:        [4, 10],
    protection:      [0, 3],
    graveyardHate:   [0, 3],
    synergyEngine:   [4, 14],
  },
  curve: {
    0: [0, 2],
    1: [0, 4],
    2: [4, 10],
    3: [4, 10],
    4: [4, 8],
    5: [2, 8],
    6: [2, 8],
    7: [0, 6],
  },
  lands: [25, 29],
};

const PRISON_PROFILE: RoleProfile = {
  buckets: {
    threat:          [1, 6],
    earlyThreat:     [0, 2],
    removal:         [6, 14],
    sweeper:         [3, 8],
    counterspell:    [4, 10],
    discard:         [2, 8],
    bounce:          [0, 4],
    cardDraw:        [6, 14],
    ramp:            [2, 6],
    finisher:        [1, 4],
    protection:      [0, 4],
    graveyardHate:   [0, 4],
    synergyEngine:   [2, 10],
  },
  curve: {
    0: [0, 2],
    1: [1, 4],
    2: [4, 10],
    3: [4, 12],
    4: [4, 10],
    5: [2, 6],
    6: [0, 4],
    7: [0, 2],
  },
  lands: [25, 28],
};

const UNKNOWN_PROFILE: RoleProfile = {
  buckets: {
    threat:          [6, 16],
    earlyThreat:     [2, 10],
    removal:         [6, 12],
    sweeper:         [0, 4],
    counterspell:    [0, 4],
    discard:         [0, 4],
    bounce:          [0, 3],
    cardDraw:        [4, 10],
    ramp:            [0, 4],
    finisher:        [1, 6],
    protection:      [0, 4],
    graveyardHate:   [0, 3],
    synergyEngine:   [4, 16],
  },
  curve: {
    0: [0, 2],
    1: [4, 12],
    2: [6, 14],
    3: [4, 10],
    4: [2, 8],
    5: [0, 6],
    6: [0, 4],
    7: [0, 3],
  },
  lands: [22, 26],
};

// ── Master map ────────────────────────────────────────────────────────────

export const ARCHETYPE_PROFILES: Record<Archetype, RoleProfile> = {
  Aggro: AGGR0_PROFILE,
  Tempo: TEMPO_PROFILE,
  Midrange: MIDRANGE_PROFILE,
  Control: CONTROL_PROFILE,
  Combo: COMBO_PROFILE,
  Ramp: RAMP_PROFILE,
  Prison: PRISON_PROFILE,
  Unknown: UNKNOWN_PROFILE,
};

// ── Role-bucket mapping for assignRoles output ────────────────────────────

/**
 * Maps a CardRole (from assignRoles) to one (or more) RoleBucket(s).
 * A single role may contribute to multiple buckets (e.g. "Beater" is both
 * "threat" and "earlyThreat" for low-CMC cards).
 */
export function rolesToBuckets(
  roles: CardRole[],
  cmc: number,
): RoleBucket[] {
  const buckets = new Set<RoleBucket>();

  for (const role of roles) {
    switch (role) {
      case "Beater":
      case "EvasiveThreat":
      case "ValueEngine":
        buckets.add("threat");
        if (cmc <= 2) buckets.add("earlyThreat");
        break;
      case "Finisher":
        buckets.add("finisher");
        buckets.add("threat");
        break;
      case "Removal":
        buckets.add("removal");
        break;
      case "BoardWipe":
        buckets.add("sweeper");
        break;
      case "Counterspell":
        buckets.add("counterspell");
        break;
      case "Discard":
        buckets.add("discard");
        break;
      case "Bounce":
        buckets.add("bounce");
        break;
      case "CardDraw":
        buckets.add("cardDraw");
        break;
      case "Ramp":
      case "LandFetch":
        buckets.add("ramp");
        break;
      case "Tutor":
        buckets.add("tutor");
        break;
      case "Lifegain":
        buckets.add("lifegain");
        break;
      case "Protection":
        buckets.add("protection");
        break;
      case "GraveyardHate":
        buckets.add("graveyardHate");
        break;
    }
  }
  return Array.from(buckets);
}

// ── Curve bin helper ──────────────────────────────────────────────────────

export function cmcToCurveBin(cmc: number): CurveBin {
  return Math.min(7, Math.max(0, Math.floor(cmc))) as CurveBin;
}

// ── Profile loss computation ──────────────────────────────────────────────

/**
 * Compute a role-profile loss score for a deck relative to its archetype's
 * ideal profile.  Lower is better; zero means the deck fits all bucket and
 * curve ranges exactly.
 *
 * The loss is a sum of per-bucket squared overshoot / undershoot weighted by
 * how far outside the range the deck falls.  Curve deviation uses the
 * per-bin counts against the profile's [min, max] ranges.
 */
export function computeProfileLoss(
  actualBuckets: Partial<Record<RoleBucket, number>>,
  actualCurve: Record<CurveBin, number>,
  landCount: number,
  profile: RoleProfile,
  deckSize = 60,
): number {
  let loss = 0;

  // Scale profile to deck size (for Commander etc.)
  const scale = deckSize / 60;

  // Bucket loss
  for (const bucketKey of Object.keys(profile.buckets) as RoleBucket[]) {
    const range = profile.buckets[bucketKey];
    if (!range) continue;
    const [low, high] = [range[0] * scale, range[1] * scale];
    const actual = actualBuckets[bucketKey] ?? 0;
    if (actual < low) {
      const deficit = low - actual;
      loss += deficit * deficit;
    } else if (actual > high) {
      const excess = actual - high;
      loss += 0.5 * excess * excess; // overshoot penalized less than undershoot
    }
  }

  // Curve loss
  for (let bin = 0; bin <= 7; bin++) {
    const [low, high] = [
      profile.curve[bin as CurveBin][0] * scale,
      profile.curve[bin as CurveBin][1] * scale,
    ];
    const actual = actualCurve[bin as CurveBin] ?? 0;
    if (actual < low) {
      loss += (low - actual) * (low - actual);
    } else if (actual > high) {
      loss += 0.5 * (actual - high) * (actual - high);
    }
  }

  // Land count loss
  const [landLow, landHigh] = [profile.lands[0] * scale, profile.lands[1] * scale];
  if (landCount < landLow) {
    loss += Math.pow(landLow - landCount, 2);
  } else if (landCount > landHigh) {
    loss += 0.5 * Math.pow(landCount - landHigh, 2);
  }

  return loss;
}

// ── Redundancy scoring ────────────────────────────────────────────────────

export interface RedundancyMetrics {
  /** Number of primary synergy axes with both sources ≥ minSources and payoffs ≥ minPayoffs. */
  robustAxes: number;

  /** Total sources across all primary axes. */
  totalSources: number;

  /** Total payoffs across all primary axes. */
  totalPayoffs: number;

  /** Total engines / enablers across all primary axes. */
  totalEngines: number;

  /** Raw redundancy score (0–20), higher = more robust engine structure. */
  score: number;
}

export function computeRedundancyScore(
  axisProfiles: Array<{
    sources: number;
    payoffs: number;
    engines: number;
    isPrimary: boolean;
  }>,
): RedundancyMetrics {
  const primary = axisProfiles.filter((a) => a.isPrimary);
  const robustAxes = primary.filter(
    (a) => a.sources >= 3 && a.payoffs >= 2,
  ).length;

  const totalSources = primary.reduce((s, a) => s + a.sources, 0);
  const totalPayoffs = primary.reduce((s, a) => s + a.payoffs, 0);
  const totalEngines = primary.reduce((s, a) => s + a.engines, 0);

  // Score: robust axes contribute base points, then bonuses for depth.
  let score = robustAxes * 4;
  if (totalSources >= 12) score += 3;
  if (totalPayoffs >= 6) score += 3;
  if (totalEngines >= 4) score += 2;
  if (totalSources >= 18) score += 2;
  if (totalPayoffs >= 10) score += 2;
  score = Math.min(20, score);

  return { robustAxes, totalSources, totalPayoffs, totalEngines, score };
}