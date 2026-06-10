import type { DeckEntry } from "./legality";
import { getRoleComposition, ARCHETYPE_BENCHMARKS, type Archetype } from "./archetype";

export type TrafficLight = "green" | "yellow" | "red";

export interface CompositionCheck {
  label: string;
  actual: number;
  target: number;
  status: TrafficLight;
}

export interface DeckCompositionAnalysis {
  archetype: Archetype;
  checks: CompositionCheck[];
  weakSpots: string[];
}

function trafficLight(actual: number, target: number): TrafficLight {
  if (target === 0) return "green";
  const ratio = actual / target;
  if (ratio >= 0.8 && ratio <= 1.3) return "green";
  // Fixed: was (ratio >= 0.6 || ratio <= 1.5) — || meant everything passed yellow
  if (ratio >= 0.6 && ratio <= 1.5) return "yellow";
  return "red";
}

export function analyzeDeckComposition(
  entries: DeckEntry[],
  archetype: Archetype
): DeckCompositionAnalysis {
  const comp = getRoleComposition(entries);
  const bench = ARCHETYPE_BENCHMARKS[archetype];
  const weakSpots: string[] = [];

  const LABELS: Record<string, string> = {
    threats:       "Threats",
    removal:       "Removal",
    boardWipes:    "Board Wipes",
    counterspells: "Counterspells",
    cardDraw:      "Card Draw",
    ramp:          "Ramp",
    lands:         "Lands"
  };

  const keys = Object.keys(LABELS) as Array<keyof typeof comp>;
  const checks: CompositionCheck[] = keys.map(key => {
    const actual = comp[key] ?? 0;
    const target = (bench[key] as number | undefined) ?? 0;
    const status = trafficLight(actual, target);
    return { label: LABELS[key], actual, target, status };
  });

  // Weak spot advisor
  if ((comp.removal) < (bench.removal ?? 0) * 0.6) {
    weakSpots.push(`Too few removal spells — have ${comp.removal}, recommend ${bench.removal}.`);
  }
  if ((comp.counterspells ?? 0) === 0 && archetype === "Control") {
    weakSpots.push(`No counterspells detected — ${archetype} decks should run ${bench.counterspells ?? 8}–${(bench.counterspells ?? 8) + 4}.`);
  }
  if ((comp.cardDraw ?? 0) < 4) {
    weakSpots.push("Low card draw — risk of running out of gas in long games.");
  }

  const nonlands = entries.filter(e => !e.card.typeLine.includes("Land"));
  const nonlandTotal = nonlands.reduce((s, e) => s + e.quantity, 0);
  const avgCmc = nonlandTotal > 0
    ? nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / nonlandTotal
    : 0;

  if (avgCmc > 3.5 && archetype === "Aggro") {
    weakSpots.push(`Avg MV ${avgCmc.toFixed(1)} is too high for Aggro — consider cutting spells above CMC 4.`);
  }

  // Graveyard hate in sideboard
  const sideGYHate = entries.filter(e =>
    e.board === "side" &&
    (e.card.oracleText ?? "").toLowerCase().includes("exile") &&
    (e.card.oracleText ?? "").toLowerCase().includes("graveyard")
  ).length;
  if (sideGYHate === 0) {
    weakSpots.push("No graveyard hate in sideboard — vulnerable to Graveyard strategies.");
  }

  // 2-drop gap
  const twodropCount = entries
    .filter(e => e.card.cmc === 2 && e.board === "main")
    .reduce((s, e) => s + e.quantity, 0);
  if (twodropCount < 4 && archetype !== "Control") {
    weakSpots.push(`Only ${twodropCount} two-drops — curve has a gap at MV 2.`);
  }

  return { archetype, checks, weakSpots };
}
