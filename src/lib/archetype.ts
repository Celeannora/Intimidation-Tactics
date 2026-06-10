import type { DeckEntry } from "./legality";
import { assignRoles, isThreat } from "./roles";

export type Archetype =
  | "Aggro"
  | "Burn"
  | "Midrange"
  | "Control"
  | "Combo"
  | "Tempo"
  | "Ramp"
  | "Tokens"
  | "Graveyard"
  | "Sacrifice"
  | "Unknown";

export interface ArchetypeDetectionResult {
  archetype: Archetype;
  confidence: number; // 0-1
  signals: string[];
}

export interface RoleComposition {
  threats: number;
  removal: number;
  boardWipes: number;
  counterspells: number;
  cardDraw: number;
  ramp: number;
  lands: number;
  total: number;
}

export const ARCHETYPE_BENCHMARKS: Record<Archetype, Partial<RoleComposition>> = {
  Aggro:     { threats: 26, removal: 6,  boardWipes: 0,  counterspells: 1,  cardDraw: 2,  ramp: 0,  lands: 21 },
  Burn:      { threats: 12, removal: 16, boardWipes: 0,  counterspells: 0,  cardDraw: 4,  ramp: 0,  lands: 20 },
  Midrange:  { threats: 18, removal: 10, boardWipes: 2,  counterspells: 2,  cardDraw: 6,  ramp: 2,  lands: 23 },
  Control:   { threats: 8,  removal: 14, boardWipes: 4,  counterspells: 10, cardDraw: 12, ramp: 0,  lands: 25 },
  Combo:     { threats: 10, removal: 6,  boardWipes: 0,  counterspells: 2,  cardDraw: 8,  ramp: 4,  lands: 23 },
  Tempo:     { threats: 16, removal: 8,  boardWipes: 0,  counterspells: 6,  cardDraw: 6,  ramp: 0,  lands: 22 },
  Ramp:      { threats: 10, removal: 6,  boardWipes: 2,  counterspells: 0,  cardDraw: 6,  ramp: 10, lands: 24 },
  Tokens:    { threats: 20, removal: 6,  boardWipes: 4,  counterspells: 0,  cardDraw: 6,  ramp: 2,  lands: 22 },
  Graveyard: { threats: 14, removal: 8,  boardWipes: 2,  counterspells: 2,  cardDraw: 8,  ramp: 4,  lands: 23 },
  Sacrifice:{ threats: 16, removal: 10, boardWipes: 2,  counterspells: 0,  cardDraw: 8,  ramp: 2,  lands: 22 },
  Unknown:   {}
};

export function getRoleComposition(entries: DeckEntry[]): RoleComposition {
  let threats = 0, removal = 0, boardWipes = 0, counterspells = 0, cardDraw = 0, ramp = 0, lands = 0;

  for (const entry of entries) {
    const qty = entry.quantity;
    const tl = entry.card.typeLine;
    if (tl.includes("Land")) { lands += qty; continue; }

    const roles = assignRoles(entry.card);
    if (isThreat(roles)) threats += qty;
    if (roles.includes("Removal")) removal += qty;
    if (roles.includes("BoardWipe")) boardWipes += qty;
    if (roles.includes("Counterspell")) counterspells += qty;
    if (roles.includes("CardDraw")) cardDraw += qty;
    if (roles.includes("Ramp")) ramp += qty;
  }

  const total = entries.reduce((s, e) => s + e.quantity, 0);
  return { threats, removal, boardWipes, counterspells, cardDraw, ramp, lands, total };
}

function score(
  comp: RoleComposition,
  archetype: Archetype
): number {
  const bench = ARCHETYPE_BENCHMARKS[archetype];
  if (!bench || archetype === "Unknown") return 0;

  let s = 0;
  const keys: Array<keyof RoleComposition> = ["threats", "removal", "boardWipes", "counterspells", "cardDraw", "ramp", "lands"];
  for (const k of keys) {
    const target = bench[k] ?? 0;
    const actual = comp[k] ?? 0;
    if (target === 0) continue;
    const ratio = actual / target;
    s += ratio >= 0.8 && ratio <= 1.4 ? 2 : ratio >= 0.6 ? 1 : 0;
  }
  return s;
}

export function detectArchetype(entries: DeckEntry[]): ArchetypeDetectionResult {
  const comp = getRoleComposition(entries);
  const text = entries
    .map(e => (e.card.oracleText ?? "").toLowerCase())
    .join(" ");

  const signals: string[] = [];

  // Special pattern signals
  const hasTokenMakers = text.includes("create") && text.includes("token");
  const hasSacrificeOutlets = text.includes("sacrifice a creature");
  const hasGraveyardRecur = text.includes("return") && text.includes("from your graveyard");
  const hasDirectDamage = (text.match(/damage to (any target|target player|each opponent)/g) ?? []).length >= 6;
  const avgCmc = comp.total > 0
    ? entries.filter(e => !e.card.typeLine.includes("Land")).reduce((s, e) => s + e.card.cmc * e.quantity, 0)
      / entries.filter(e => !e.card.typeLine.includes("Land")).reduce((s, e) => s + e.quantity, 1)
    : 0;

  if (hasTokenMakers) signals.push("Token creators detected");
  if (hasSacrificeOutlets) signals.push("Sacrifice outlets detected");
  if (hasGraveyardRecur) signals.push("Graveyard recursion detected");
  if (hasDirectDamage) signals.push("Heavy direct damage package");
  if (avgCmc < 2.2) signals.push(`Low avg MV (${avgCmc.toFixed(1)}) — aggressive curve`);
  if (avgCmc > 3.5) signals.push(`High avg MV (${avgCmc.toFixed(1)}) — late game curve`);
  if (comp.counterspells >= 8) signals.push("Heavy counterspell suite");
  if (comp.ramp >= 8) signals.push("Heavy ramp suite");

  // Override detections
  if (hasSacrificeOutlets && hasTokenMakers) {
    return { archetype: "Sacrifice", confidence: 0.75, signals };
  }
  if (hasTokenMakers && comp.threats >= 18) {
    return { archetype: "Tokens", confidence: 0.75, signals };
  }
  if (hasGraveyardRecur && comp.ramp >= 4) {
    return { archetype: "Graveyard", confidence: 0.70, signals };
  }
  if (hasDirectDamage) {
    return { archetype: "Burn", confidence: 0.80, signals };
  }

  // Score-based detection
  const archetypes: Archetype[] = ["Aggro", "Midrange", "Control", "Combo", "Tempo", "Ramp"];
  let bestArchetype: Archetype = "Unknown";
  let bestScore = 0;

  for (const arch of archetypes) {
    const s = score(comp, arch);
    if (s > bestScore) { bestScore = s; bestArchetype = arch; }
  }

  const maxPossible = 14;
  const confidence = Math.min(bestScore / maxPossible, 1);

  return { archetype: bestArchetype, confidence, signals };
}
