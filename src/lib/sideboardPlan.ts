import type { CardRecord } from "./types";

export interface SideboardPlanCard {
  oracleId: string;
  name: string;
  quantity: number;
  rationale: string;
}

export interface SideboardPlan {
  opponentArchetype: string;
  bringIn: SideboardPlanCard[];
  takeOut: SideboardPlanCard[];
  notes: string;
}

// Archetype keywords for heuristic matching
const ARCHETYPE_PATTERNS: Record<string, { hatecards: string[]; removeAgainst: string[] }> = {
  aggro:   { hatecards: ["life gain", "fog", "sweeper", "wrath", "destroy all"], removeAgainst: ["slow", "ramp", "enters"] },
  control: { hatecards: ["discard", "counter", "can't counter", "uncounterable", "hexproof"], removeAgainst: ["single target removal"] },
  midrange:{ hatecards: ["exile", "edict", "sacrifice"], removeAgainst: ["cheap interaction"] },
  tempo:   { hatecards: ["can't be countered", "flash", "haste", "uncounterable", "hexproof"], removeAgainst: ["slow removal", "sorcery speed"] },
  combo:   { hatecards: ["disrupt", "counter", "exile", "graveyard hate", "remove from game"], removeAgainst: ["slow removal"] },
  ramp:    { hatecards: ["fast aggression", "discard", "hand disruption"], removeAgainst: ["late game"] },
  prison:  { hatecards: ["destroy target artifact", "destroy target enchantment", "disenchant", "can't be countered", "uncounterable"], removeAgainst: ["reactive removal"] },
};

export function generateSideboardPlan(
  opponentArchetype: string,
  mainboard: CardRecord[],
  sideboard: CardRecord[]
): SideboardPlan {
  const arch = opponentArchetype.toLowerCase();
  const pattern = Object.entries(ARCHETYPE_PATTERNS).find(([key]) => arch.includes(key))?.[1];

  const bringIn: SideboardPlanCard[] = [];
  const takeOut: SideboardPlanCard[] = [];

  for (const card of sideboard) {
    const text = (card.oracleText ?? "").toLowerCase();
    const matchScore = (pattern?.hatecards ?? []).filter((k) => text.includes(k)).length;
    if (matchScore > 0) {
      bringIn.push({ oracleId: card.oracleId, name: card.name, quantity: 1, rationale: `Matches: ${(pattern?.hatecards ?? []).filter((k) => text.includes(k)).join(", ")}` });
    }
  }

  for (const card of mainboard) {
    const text = (card.oracleText ?? "").toLowerCase();
    const removeScore = (pattern?.removeAgainst ?? []).filter((k) => text.includes(k)).length;
    if (removeScore > 0) {
      takeOut.push({ oracleId: card.oracleId, name: card.name, quantity: 1, rationale: `Less useful vs ${opponentArchetype}` });
    }
  }

  return { opponentArchetype, bringIn, takeOut, notes: `Heuristic plan for ${opponentArchetype} matchup` };
}

export function rateSideboardCard(card: CardRecord, opponentArchetype: string): number {
  const arch = opponentArchetype.toLowerCase();
  const pattern = Object.entries(ARCHETYPE_PATTERNS).find(([key]) => arch.includes(key))?.[1];
  if (!pattern) return 0;
  const text = (card.oracleText ?? "").toLowerCase();
  return pattern.hatecards.filter((k) => text.includes(k)).length;
}
