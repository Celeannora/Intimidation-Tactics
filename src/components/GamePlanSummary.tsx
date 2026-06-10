import { useMemo } from "react";
import { useDeckStore } from "../store/deckStore";
import { detectArchetype } from "../lib/archetype";
import { assignRoles } from "../lib/roles";

const COLOR_NAME: Record<string, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green"
};

const PLANS: Record<string, (opts: { color: string; threats: string[]; avg: string }) => string> = {
  Aggro:     ({ color, threats, avg }) =>
    `This ${color} Aggro deck aims to establish an overwhelming board presence in turns 1–3${
      threats[0] ? `, anchored by ${threats[0]}` : ""
    }. Avg MV ${avg} — end the game before the opponent stabilizes. Win target: turns 3–5.`,
  Midrange:  ({ color, threats, avg }) =>
    `This ${color} Midrange deck plays efficient threats and answers on every turn${
      threats[0] ? `, led by ${threats[0]}` : ""
    }. Avg MV ${avg} — out-value opponents in the mid-game and close around turns 5–6.`,
  Control:   ({ color, threats, avg }) =>
    `This ${color} Control deck counters early threats, draws cards, and closes with high-impact finishers${
      threats[0] ? ` like ${threats[0]}` : ""
    }. Avg MV ${avg} — stabilize by turn 5, win turns 7–10.`,
  Combo:     ({ color, threats, avg }) =>
    `This ${color} Combo deck assembles its win condition${
      threats[0] ? ` around ${threats[0]}` : ""
    } as quickly as possible. Avg MV ${avg} — protect the combo, draw into pieces, execute before the opponent applies lethal pressure.`,
  Tempo:     ({ color, threats, avg }) =>
    `This ${color} Tempo deck deploys cheap threats${
      threats[0] ? ` like ${threats[0]}` : ""
    } backed by cheap interaction to stay permanently ahead. Avg MV ${avg} — win turns 4–6.`,
  Ramp:      ({ color, threats, avg }) =>
    `This ${color} Ramp deck accelerates mana to cast outsized payoffs${
      threats[0] ? ` like ${threats[0]}` : ""
    } ahead of curve. Avg MV ${avg} — overwhelm opponents with threats they cannot match on rate.`,
  Prison:    ({ color, threats, avg }) =>
    `This ${color} Prison deck deploys lock pieces and sweepers to deny the opponent's game plan${
      threats[0] ? `, grinding behind ${threats[0]}` : ""
    }. Avg MV ${avg} — lock the board, then win slowly with a single resilient threat.`,
  Unknown:   ({ color, avg }) =>
    `This ${color || "colorless"} deck has an avg MV of ${avg}. Add more cards to auto-detect your game plan.`,
};

export function GamePlanSummary() {
  const { entries } = useDeckStore();

  const { archetype, confidence } = useMemo(() => detectArchetype(entries), [entries]);

  const avgCmc = useMemo(() => {
    const nonLand = entries.filter((e) => !e.card.typeLine.includes("Land"));
    const total = nonLand.reduce((s, e) => s + e.quantity, 0);
    if (total === 0) return 0;
    return nonLand.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / total;
  }, [entries]);

  const topThreats = useMemo(() =>
    entries
      .filter((e) => {
        const roles = assignRoles(e.card);
        return roles.some((r) => ["Beater", "EvasiveThreat", "Finisher", "ValueEngine"].includes(r));
      })
      .sort((a, b) => {
        const ra = a.card.edhrecRank ?? 99999;
        const rb = b.card.edhrecRank ?? 99999;
        return ra - rb;
      })
      .slice(0, 3)
      .map((e) => e.card.name),
  [entries]);

  const primaryColors = useMemo(() => {
    const counts = new Map<string, number>();
    for (const entry of entries) {
      const ci: string[] = JSON.parse(entry.card.colorIdentityJson || "[]");
      for (const c of ci) counts.set(c, (counts.get(c) ?? 0) + entry.quantity);
    }
    const total = entries.reduce((s, e) => s + e.quantity, 0);
    return [...counts.entries()]
      .filter(([, n]) => n / total >= 0.08)
      .sort((a, b) => b[1] - a[1])
      .map(([c]) => c);
  }, [entries]);

  const colorStr = primaryColors.map((c) => COLOR_NAME[c] ?? c).join("/") || "Colorless";
  const planFn = PLANS[archetype] ?? PLANS.Unknown;
  const summary = planFn({ color: colorStr, threats: topThreats, avg: avgCmc.toFixed(2) });

  const mainCount = entries.reduce((s, e) => s + (e.board === "main" ? e.quantity : 0), 0);
  const sideCount = entries.reduce((s, e) => s + (e.board === "side" ? e.quantity : 0), 0);

  if (entries.length === 0) {
    return (
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 text-sm text-zinc-400">
        Add cards to generate a game plan summary.
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4 rounded-xl border border-zinc-800 bg-zinc-950 p-4">
      <div className="flex items-center justify-between">
        <div>
          <span className="text-base font-bold text-teal-400">{archetype}</span>
          <span className="ml-2 text-xs text-zinc-500">{Math.round(confidence * 100)}% confidence</span>
        </div>
        <div className="h-1.5 w-20 rounded-full bg-zinc-800 overflow-hidden">
          <div className="h-full bg-teal-500 rounded-full" style={{ width: `${Math.round(confidence * 100)}%` }} />
        </div>
      </div>

      <p className="text-sm leading-relaxed text-zinc-300">{summary}</p>

      <div className="grid grid-cols-2 gap-2">
        <StatChip label="Avg MV"      value={avgCmc.toFixed(2)} />
        <StatChip label="Colors"      value={primaryColors.join("") || "—"} />
        <StatChip label="Mainboard"   value={`${mainCount}/60`} />
        <StatChip label="Sideboard"   value={`${sideCount}/15`} />
        {topThreats[0] && <StatChip label="Top Threat" value={topThreats[0]} />}
      </div>
    </div>
  );
}

function StatChip({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded-lg bg-zinc-900 px-3 py-2">
      <div className="text-xs text-zinc-500">{label}</div>
      <div className="truncate font-medium text-zinc-200">{value}</div>
    </div>
  );
}
