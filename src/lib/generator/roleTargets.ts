import type { Archetype } from "../archetype";

export interface RoleTarget {
  threats: number;
  removal: number;
  boardWipes: number;
  counterspells: number;
  cardDraw: number;
  ramp: number;
  lands: number;
  /** Soft cap on average mana value of nonland cards. Picks above this are penalized. */
  maxAvgCmc: number;
}

/**
 * Per-archetype non-AI generation targets. Numbers are intentionally sized so the
 * non-land slot total is roughly 36–40 (so lands fill the rest of 60).
 */
export const ROLE_TARGETS: Record<Archetype, RoleTarget> = {
  Aggro:     { threats: 24, removal: 8,  boardWipes: 0, counterspells: 0, cardDraw: 2, ramp: 0,  lands: 22, maxAvgCmc: 2.2 },
  Midrange:  { threats: 18, removal: 12, boardWipes: 2, counterspells: 2, cardDraw: 5, ramp: 2,  lands: 24, maxAvgCmc: 3.1 },
  Control:   { threats: 5,  removal: 14, boardWipes: 4, counterspells: 10, cardDraw: 8, ramp: 0,  lands: 26, maxAvgCmc: 3.4 },
  Tempo:     { threats: 16, removal: 8,  boardWipes: 0, counterspells: 8, cardDraw: 4, ramp: 0,  lands: 22, maxAvgCmc: 2.4 },
  Combo:     { threats: 8,  removal: 6,  boardWipes: 0, counterspells: 6, cardDraw: 8, ramp: 4,  lands: 24, maxAvgCmc: 3.0 },
  Ramp:      { threats: 10, removal: 6,  boardWipes: 3, counterspells: 0, cardDraw: 6, ramp: 12, lands: 26, maxAvgCmc: 3.7 },
  Prison:    { threats: 6,  removal: 10, boardWipes: 4, counterspells: 4, cardDraw: 8, ramp: 2,  lands: 24, maxAvgCmc: 3.2 },
  Unknown:   { threats: 18, removal: 10, boardWipes: 2, counterspells: 3, cardDraw: 5, ramp: 2,  lands: 24, maxAvgCmc: 2.9 },
};

const ROLE_KEYS: Array<keyof Omit<RoleTarget, "maxAvgCmc">> = [
  "threats",
  "removal",
  "boardWipes",
  "counterspells",
  "cardDraw",
  "ramp",
  "lands",
];

/**
 * Blend primary + secondary archetypes into one role target.
 * Primary keeps 60% weight; secondaries share the remaining 40%.
 */
export function blendRoleTargets(primary: Archetype, secondary: Archetype[] = []): RoleTarget {
  const filtered = secondary.filter((a) => a !== primary && a !== "Unknown");
  if (filtered.length === 0) return ROLE_TARGETS[primary];

  const primaryTarget = ROLE_TARGETS[primary];
  const secondaryTargets = filtered.map((a) => ROLE_TARGETS[a]);
  const primaryWeight = 0.6;
  const secondaryWeight = 0.4 / secondaryTargets.length;

  const blended: RoleTarget = { ...primaryTarget };
  for (const key of ROLE_KEYS) {
    blended[key] = Math.round(
      primaryTarget[key] * primaryWeight +
      secondaryTargets.reduce((sum, t) => sum + t[key] * secondaryWeight, 0)
    );
  }
  blended.maxAvgCmc = Number((
    primaryTarget.maxAvgCmc * primaryWeight +
    secondaryTargets.reduce((sum, t) => sum + t.maxAvgCmc * secondaryWeight, 0)
  ).toFixed(2));
  return blended;
}