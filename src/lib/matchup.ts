import { getMatchRecords } from "./bo3";
import type { CardRecord } from "./types";
import type { DeckEntry } from "./legality";
import type { Archetype } from "./archetype";
import { computeSynergyScoreV2, buildSynergyProfile } from "./generator/synergyModel";
import { roleMultiplier } from "./generator/weights";
import { computePowerScore } from "./powerScore";

export interface MatchupRecord {
  opponentArchetype: string;
  wins: number;
  losses: number;
  draws: number;
}

export interface MatchupStats extends MatchupRecord {
  total: number;
  winRate: number;
}

export async function getMatchupStats(deckId: string): Promise<MatchupStats[]> {
  const records = await getMatchRecords(deckId);
  const map = new Map<string, MatchupRecord>();

  for (const r of records) {
    const arch = r.opponentArchetype || "Unknown";
    const existing = map.get(arch) ?? { opponentArchetype: arch, wins: 0, losses: 0, draws: 0 };
    if (r.matchResult === "win") existing.wins++;
    else if (r.matchResult === "loss") existing.losses++;
    else existing.draws++;
    map.set(arch, existing);
  }

  return [...map.values()].map((m) => ({
    ...m,
    total: m.wins + m.losses + m.draws,
    winRate: m.wins + m.losses + m.draws > 0 ? m.wins / (m.wins + m.losses + m.draws) : 0,
  })).sort((a, b) => b.total - a.total);
}

/**
 * Suggest tech cards against a specific meta archetype using V2 synergy scoring.
 * Ranks all available cards by their combined power score, role relevance,
 * and synergy with the current deck, returning the top candidates.
 */
export function suggestTechCardsV2(
  deckEntries: DeckEntry[],
  allCards: CardRecord[],
  metaArchetype: Archetype
): CardRecord[] {
  const deckProfiles = deckEntries
    .filter((e) => !e.card.typeLine.includes("Land"))
    .map((e) => buildSynergyProfile(e.card));

  const scored = allCards
    .filter((c) => !c.typeLine.includes("Land"))
    .map((card) => {
      const powerScore = computePowerScore(card);
      const role = roleMultiplier(card, metaArchetype);
      const synergy = computeSynergyScoreV2(card, deckEntries);
      // Total: base power * role relevance + synergy bonus
      const total = powerScore * role + synergy * 1.5;
      return { card, total };
    })
    .sort((a, b) => b.total - a.total);

  // Return top 15 unique cards
  const seen = new Set<string>();
  return scored
    .filter((s) => {
      if (seen.has(s.card.oracleId)) return false;
      seen.add(s.card.oracleId);
      return true;
    })
    .slice(0, 15)
    .map((s) => s.card);
}

/** Legacy wrapper — uses V2 engine instead of hardcoded strings. */
export async function suggestTechCards(
  deckId: string,
  worstArchetype: string
): Promise<string[]> {
  // Deprecated: callers should migrate to suggestTechCardsV2().
  // Returns hardcoded fallback cards since the async store access is unreliable.
  const tips: Record<string, string[]> = {
    aggro:   ["Flame-Blessed Bolt", "Sheoldred, the Apocalypse", "Temporary Lockdown"],
    control: ["Duress", "Veil of Summer", "Urabrask, Heretic Praetor"],
    midrange:["Go for the Throat", "Sunfall", "Reckoner Bankbuster"],
    combo:   ["Haywire Mite", "Grafdigger's Cage", "Graveyard Trespasser"],
    ramp:    ["Breach the Multiverse", "Invasion of Zendikar", "Nissa, Resurgent Animist"],
  };
  const arch = worstArchetype.toLowerCase();
  for (const [key, cards] of Object.entries(tips)) {
    if (arch.includes(key)) return cards;
  }
  return ["Duress", "Negate", "Cut Down"];
}
