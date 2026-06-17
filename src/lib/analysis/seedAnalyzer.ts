/**
 * seedAnalyzer.ts — Seed card intent inference.
 *
 * This module is the deterministic first stage of the “Analyze” workflow.
 * Given a small set of user-provided seed cards, it infers the likely macro
 * archetype, color identity, synergy axes, role composition, speed profile,
 * spell ratio, and confidence before the LLM is asked to continue the deck.
 */

import type { Archetype } from "../archetype";
import { assignRoles, isThreat, type CardRole } from "../roles";
import type { CardRecord, ManaColor } from "../types";
import { buildSynergyProfile, type MechanicAxis } from "../generator/synergyModel";
import type { SpeedProfile, SpellRatio } from "../generator/types";

export type SeedRoleCounts = Partial<Record<CardRole | "Threat", number>>;
export type SeedAxisCounts = Partial<Record<MechanicAxis, number>>;

export interface SeedArchetypeCandidate {
  archetype: Archetype;
  score: number;
  probability: number;
}

export interface SeedSummary {
  seedCount: number;
  colorIdentity: ManaColor[];
  colorConfidence: number;
  archetypeScores: Partial<Record<Archetype, number>>;
  topArchetypes: SeedArchetypeCandidate[];
  synergyAxes: SeedAxisCounts;
  primaryAxes: MechanicAxis[];
  roleCounts: SeedRoleCounts;
  avgCmc: number;
  speed: SpeedProfile;
  spellRatio: SpellRatio;
  confidence: number;
  signals: string[];
  narrative: string;
}

const ARCHETYPES: Archetype[] = ["Aggro", "Tempo", "Midrange", "Control", "Combo", "Ramp", "Prison", "Unknown"];

/** Analyze seed cards as intent evidence, not as mandatory final deck slots. */
export function analyzeSeeds(seeds: CardRecord[]): SeedSummary {
  if (seeds.length === 0) return emptySeedSummary();

  const colorCounts: Partial<Record<ManaColor, number>> = {};
  const roleCounts: SeedRoleCounts = {};
  const synergyAxes: SeedAxisCounts = {};
  const archetypeScores: Partial<Record<Archetype, number>> = {};
  const signals: string[] = [];

  for (const archetype of ARCHETYPES) archetypeScores[archetype] = 0.1;

  let nonlandCount = 0;
  let cmcSum = 0;
  let creatureCount = 0;

  for (const card of seeds) {
    const colors = parseColorIdentity(card);
    for (const color of colors) colorCounts[color] = (colorCounts[color] ?? 0) + 1;

    if (!card.typeLine.includes("Land")) {
      nonlandCount += 1;
      cmcSum += card.cmc;
      if (card.typeLine.includes("Creature")) creatureCount += 1;
    }

    const roles = assignRoles(card);
    const uniqueRoles = new Set<CardRole | "Threat">(roles);
    if (isThreat(roles)) uniqueRoles.add("Threat");
    for (const role of uniqueRoles) roleCounts[role] = (roleCounts[role] ?? 0) + 1;

    const profile = buildSynergyProfile(card);
    for (const axis of new Set<MechanicAxis>([...profile.sourceTags, ...profile.payoffTags])) {
      synergyAxes[axis] = (synergyAxes[axis] ?? 0) + 1;
    }

    const cardScores = scoreCardForArchetypes(card, roles);
    for (const [archetype, score] of Object.entries(cardScores) as [Archetype, number][]) {
      archetypeScores[archetype] = (archetypeScores[archetype] ?? 0) + score;
    }
  }

  applyAxisArchetypeSignals(synergyAxes, archetypeScores, signals);

  const topArchetypes = normalizeAndRank(archetypeScores);
  const primaryAxes = Object.entries(synergyAxes)
    .filter(([, count]) => (count ?? 0) >= Math.min(2, seeds.length))
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([axis]) => axis as MechanicAxis);

  const colorIdentity = (Object.entries(colorCounts) as [ManaColor, number][])
    .sort(([, a], [, b]) => b - a)
    .map(([color]) => color);
  const maxColorCount = Math.max(0, ...Object.values(colorCounts).map((v) => v ?? 0));
  const colorConfidence = round2(maxColorCount / Math.max(1, seeds.length));
  const avgCmc = round2(cmcSum / Math.max(1, nonlandCount));
  const speed = inferSpeed(avgCmc, roleCounts, topArchetypes[0]?.archetype);
  const spellRatio = inferSpellRatio(creatureCount, nonlandCount);
  const confidence = inferConfidence(topArchetypes, primaryAxes, colorConfidence, seeds.length);
  const narrative = buildSeedNarrative(topArchetypes, primaryAxes, roleCounts, colorIdentity, speed, confidence);

  if (primaryAxes.length > 0) signals.push(`Primary seed axes: ${primaryAxes.join(", ")}.`);
  if (topArchetypes[0]) signals.push(`Top macro guess: ${topArchetypes[0].archetype} (${Math.round(topArchetypes[0].probability * 100)}%).`);

  return {
    seedCount: seeds.length,
    colorIdentity,
    colorConfidence,
    archetypeScores,
    topArchetypes,
    synergyAxes,
    primaryAxes,
    roleCounts,
    avgCmc,
    speed,
    spellRatio,
    confidence,
    signals,
    narrative,
  };
}

export function formatSeedSummaryForPrompt(summary: SeedSummary): string {
  const archetypes = summary.topArchetypes
    .map((a) => `${a.archetype}:${Math.round(a.probability * 100)}%`)
    .join(", ");
  const axes = summary.primaryAxes.length > 0 ? summary.primaryAxes.join(", ") : "none detected";
  const roles = Object.entries(summary.roleCounts)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .slice(0, 8)
    .map(([role, count]) => `${role}:${count}`)
    .join(", ") || "none";

  return [
    "Seed intent analysis:",
    `- Inferred colors: ${summary.colorIdentity.join("") || "colorless"} (confidence ${pct(summary.colorConfidence)})`,
    `- Archetype candidates: ${archetypes || "unknown"}`,
    `- Primary synergy axes: ${axes}`,
    `- Seed roles: ${roles}`,
    `- Avg seed MV: ${summary.avgCmc}; speed: ${summary.speed}; spell ratio: ${summary.spellRatio}`,
    `- Overall intent confidence: ${pct(summary.confidence)}`,
    `- Narrative: ${summary.narrative}`,
  ].join("\n");
}

function scoreCardForArchetypes(card: CardRecord, roles: CardRole[]): Partial<Record<Archetype, number>> {
  const scores: Partial<Record<Archetype, number>> = {};
  const text = (card.oracleText ?? "").toLowerCase();
  const cmc = card.cmc;

  if (isThreat(roles) && cmc <= 2) add(scores, "Aggro", 3.2);
  if (isThreat(roles) && cmc <= 3 && /flying|menace|can't be blocked|haste/.test(text)) add(scores, "Tempo", 2.6);
  if (roles.includes("Removal") && cmc <= 2) { add(scores, "Aggro", 1.1); add(scores, "Tempo", 1.3); add(scores, "Midrange", 1.6); }
  if (roles.includes("Counterspell")) { add(scores, "Tempo", 2.4); add(scores, "Control", 2.6); add(scores, "Combo", 1.2); }
  if (roles.includes("BoardWipe")) { add(scores, "Control", 4.2); add(scores, "Prison", 2.3); }
  if (roles.includes("CardDraw")) { add(scores, "Control", cmc >= 3 ? 2.2 : 1.2); add(scores, "Combo", cmc <= 2 ? 1.8 : 0.8); add(scores, "Midrange", 1.2); }
  if (roles.includes("Tutor")) add(scores, "Combo", 4.0);
  if (roles.includes("Ramp") || roles.includes("LandFetch")) add(scores, "Ramp", 4.0);
  if (roles.includes("Discard")) { add(scores, "Midrange", 2.0); add(scores, "Control", 1.5); add(scores, "Tempo", 1.0); }
  if (roles.includes("ValueEngine")) { add(scores, "Midrange", 3.0); add(scores, "Control", 1.2); }
  if (roles.includes("Finisher") && cmc >= 5) { add(scores, "Control", 1.8); add(scores, "Ramp", 2.2); }
  if (/costs? .* more|can't attack|can't block|skip .* step|doesn't untap/.test(text)) add(scores, "Prison", 3.0);
  if (/whenever you cast|storm|copy target instant|copy target sorcery|search your library/.test(text)) add(scores, "Combo", 1.8);

  return scores;
}

function applyAxisArchetypeSignals(
  axes: SeedAxisCounts,
  scores: Partial<Record<Archetype, number>>,
  signals: string[],
): void {
  const has = (axis: MechanicAxis) => (axes[axis] ?? 0) > 0;
  const count = (axis: MechanicAxis) => axes[axis] ?? 0;

  if (has("burn")) { add(scores, "Aggro", 2 + count("burn")); add(scores, "Tempo", 0.8); signals.push("Burn axis suggests proactive pressure."); }
  if (has("spellslinger") || has("storm")) { add(scores, "Tempo", 1.6); add(scores, "Combo", 2.4); signals.push("Spellslinger/storm axis suggests spell-dense planning."); }
  if (has("tokens")) { add(scores, "Aggro", 1.4); add(scores, "Midrange", 1.8); signals.push("Token axis suggests go-wide role requirements."); }
  if (has("sacrifice")) { add(scores, "Midrange", 2.2); add(scores, "Combo", 1.0); signals.push("Sacrifice axis suggests source/payoff redundancy needs."); }
  if (has("reanimator") || has("graveyard")) { add(scores, "Midrange", 1.5); add(scores, "Combo", 2.0); signals.push("Graveyard axis suggests enabler/payoff/target mapping."); }
  if (has("lifegain") || has("counters")) { add(scores, "Midrange", 1.8); add(scores, "Aggro", 0.8); }
  if (has("artifacts") || has("enchantress")) { add(scores, "Midrange", 1.7); add(scores, "Combo", 1.2); }
  if (has("stax")) { add(scores, "Prison", 3.2); add(scores, "Control", 1.2); }
  if (has("landfall")) { add(scores, "Ramp", 2.8); add(scores, "Midrange", 1.0); }
}

function inferSpeed(avgCmc: number, roles: SeedRoleCounts, archetype?: Archetype): SpeedProfile {
  if (archetype === "Aggro" || archetype === "Tempo") return "fast";
  if (archetype === "Control" || archetype === "Ramp" || archetype === "Prison") return "slow";
  if (avgCmc <= 2.2 && (roles.Threat ?? 0) >= 2) return "fast";
  if (avgCmc >= 3.4 || (roles.BoardWipe ?? 0) >= 1) return "slow";
  return "midrange";
}

function inferSpellRatio(creatureCount: number, nonlandCount: number): SpellRatio {
  const frac = nonlandCount > 0 ? creatureCount / nonlandCount : 0.5;
  if (frac >= 0.68) return "creature-heavy";
  if (frac <= 0.32) return "spell-heavy";
  return "balanced";
}

function inferConfidence(
  top: SeedArchetypeCandidate[],
  axes: MechanicAxis[],
  colorConfidence: number,
  seedCount: number,
): number {
  const first = top[0]?.probability ?? 0;
  const second = top[1]?.probability ?? 0;
  const gap = Math.max(0, first - second);
  let confidence = 0.2 + gap * 1.8 + Math.min(0.3, axes.length * 0.12) + colorConfidence * 0.15;
  if (seedCount < 3) confidence *= 0.65;
  if (seedCount >= 5) confidence *= 1.12;
  return round2(Math.max(0, Math.min(1, confidence)));
}

function normalizeAndRank(scores: Partial<Record<Archetype, number>>): SeedArchetypeCandidate[] {
  const total = Object.values(scores).reduce((sum, value) => sum + (value ?? 0), 0);
  return (Object.entries(scores) as [Archetype, number][])
    .map(([archetype, score]) => ({ archetype, score: round2(score), probability: total > 0 ? round2(score / total) : 0 }))
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

function parseColorIdentity(card: CardRecord): ManaColor[] {
  try {
    return JSON.parse(card.colorIdentityJson || "[]") as ManaColor[];
  } catch {
    return [];
  }
}

function buildSeedNarrative(
  top: SeedArchetypeCandidate[],
  axes: MechanicAxis[],
  roles: SeedRoleCounts,
  colors: ManaColor[],
  speed: SpeedProfile,
  confidence: number,
): string {
  const arch = top[0]?.archetype ?? "Unknown";
  const axisText = axes.length > 0 ? ` around ${axes.join("/")}` : " with mostly role-based signals";
  const roleText = Object.entries(roles)
    .filter(([, count]) => (count ?? 0) >= 2)
    .map(([role]) => role)
    .join(", ");
  const confidenceText = confidence < 0.45 ? "low-confidence" : confidence < 0.7 ? "medium-confidence" : "high-confidence";
  return `${confidenceText} inference: ${colors.join("") || "colorless"} ${speed} ${arch}${axisText}.${roleText ? ` Recurring roles: ${roleText}.` : ""}`;
}

function add(scores: Partial<Record<Archetype, number>>, archetype: Archetype, amount: number): void {
  scores[archetype] = (scores[archetype] ?? 0) + amount;
}

function pct(value: number): string {
  return `${Math.round(value * 100)}%`;
}

function round2(value: number): number {
  return Math.round(value * 100) / 100;
}

function emptySeedSummary(): SeedSummary {
  return {
    seedCount: 0,
    colorIdentity: [],
    colorConfidence: 0,
    archetypeScores: {},
    topArchetypes: [],
    synergyAxes: {},
    primaryAxes: [],
    roleCounts: {},
    avgCmc: 0,
    speed: "midrange",
    spellRatio: "balanced",
    confidence: 0,
    signals: ["No seed cards provided."],
    narrative: "No seed cards provided; default to a balanced midrange interpretation unless the user specifies otherwise.",
  };
}
