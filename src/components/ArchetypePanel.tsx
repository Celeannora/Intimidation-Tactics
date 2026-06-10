import { useMemo } from "react";
import { useDeckStore } from "../store/deckStore";
import {
  detectArchetype,
  getRoleComposition,
  ARCHETYPE_BENCHMARKS,
  type RoleComposition,
} from "../lib/archetype";
import { scoreDeck } from "../lib/scoring";
import { inferPrimaryAxes, buildSynergyProfile } from "../lib/generator/synergyModel";
import type { DeckEntry } from "../lib/legality";

const ARCHETYPE_COLOR: Record<string, string> = {
  Aggro:     "text-red-400",
  Burn:      "text-orange-400",
  Midrange:  "text-amber-400",
  Control:   "text-blue-400",
  Combo:     "text-purple-400",
  Tempo:     "text-cyan-400",
  Ramp:      "text-green-400",
  Tokens:    "text-yellow-400",
  Graveyard: "text-zinc-400",
  Sacrifice: "text-rose-400",
  Unknown:   "text-zinc-500",
};

const ROLE_LABELS: Array<{ key: keyof RoleComposition; label: string }> = [
  { key: "threats",       label: "Threats" },
  { key: "removal",       label: "Removal" },
  { key: "boardWipes",    label: "Board Wipes" },
  { key: "counterspells", label: "Counterspells" },
  { key: "cardDraw",      label: "Card Draw" },
  { key: "ramp",          label: "Ramp" },
  { key: "lands",         label: "Lands" },
];

function confidenceBar(pct: number) {
  return (
    <div className="h-1.5 w-full bg-zinc-800 rounded-full overflow-hidden">
      <div
        className="h-full bg-teal-500 rounded-full transition-all"
        style={{ width: `${Math.round(pct * 100)}%` }}
      />
    </div>
  );
}

export function ArchetypePanel() {
  const entries = useDeckStore(s => s.entries) as DeckEntry[];
  const mainboard = useMemo(() => entries.filter(e => e.board === "main"), [entries]);

  const detection = useMemo(() => detectArchetype(mainboard), [mainboard]);
  const comp = useMemo(() => getRoleComposition(mainboard), [mainboard]);
  const mechanics = useMemo(() => {
    const profiles = mainboard.map((e) => buildSynergyProfile(e.card));
    return inferPrimaryAxes(profiles);
  }, [mainboard]);
  const scores = useMemo(() => scoreDeck(mainboard).slice(0, 5), [mainboard]);

  const benchmark = ARCHETYPE_BENCHMARKS[detection.archetype] ?? {};

  if (mainboard.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500 text-sm">
        <p>Add cards to detect archetype.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">

      {/* Archetype detection */}
      <section>
        <div className="flex items-center justify-between mb-1">
          <h3 className="font-semibold text-zinc-200">Detected Archetype</h3>
          <span className={`text-lg font-bold ${ARCHETYPE_COLOR[detection.archetype]}`}>
            {detection.archetype}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {confidenceBar(detection.confidence)}
          <span className="text-zinc-500 whitespace-nowrap">
            {Math.round(detection.confidence * 100)}% confidence
          </span>
        </div>
        {detection.signals.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-zinc-500">
            {detection.signals.map((s, i) => <li key={i}>· {s}</li>)}
          </ul>
        )}
      </section>

      {/* Role composition vs benchmark */}
      <section>
        <h3 className="font-semibold text-zinc-200 mb-2">Role Composition</h3>
        <div className="space-y-2">
          {ROLE_LABELS.map(({ key, label }) => {
            const actual = comp[key] ?? 0;
            const target = benchmark[key] ?? 0;
            const pct = target > 0 ? Math.min(actual / target, 1) : actual > 0 ? 1 : 0;
            const ok = target === 0 || (actual >= target * 0.75);

            return (
              <div key={key} className="flex items-center gap-3">
                <span className="w-28 text-zinc-400 shrink-0">{label}</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className={`h-full rounded-full transition-all ${
                      ok ? "bg-teal-500" : "bg-amber-500"
                    }`}
                    style={{ width: `${Math.round(pct * 100)}%` }}
                  />
                </div>
                <span className="text-zinc-400 w-24 text-right">
                  {actual}
                  {target > 0 && (
                    <span className="text-zinc-600"> / {target}</span>
                  )}
                </span>
              </div>
            );
          })}
        </div>
      </section>

      {/* Mechanics fingerprint */}
      {mechanics.length > 0 && (
        <section>
          <h3 className="font-semibold text-zinc-200 mb-2">Mechanics</h3>
          <div className="flex flex-wrap gap-1.5">
            {mechanics.map(m => (
              <span
                key={m}
                className="rounded-full bg-zinc-800 px-2.5 py-0.5 text-xs capitalize text-zinc-300"
              >
                {m}
              </span>
            ))}
          </div>
        </section>
      )}

      {/* Top card scores */}
      {scores.length > 0 && (
        <section>
          <h3 className="font-semibold text-zinc-200 mb-2">Top Cards by Score</h3>
          <div className="space-y-1.5">
            {scores.map(s => (
              <div
                key={s.card.id}
                className="flex items-center justify-between rounded-md bg-zinc-800 px-3 py-1.5"
              >
                <span className="text-zinc-100">{s.card.name}</span>
                <div className="flex items-center gap-2">
                  <span className={`text-xs font-bold ${
                    s.grade === "S" ? "text-yellow-400" :
                    s.grade === "A" ? "text-teal-400" :
                    s.grade === "B" ? "text-blue-400" :
                    s.grade === "C" ? "text-zinc-400" : "text-red-400"
                  }`}>{s.grade}</span>
                  <span className="text-zinc-500">{s.composite}</span>
                </div>
              </div>
            ))}
          </div>
        </section>
      )}
    </div>
  );
}
