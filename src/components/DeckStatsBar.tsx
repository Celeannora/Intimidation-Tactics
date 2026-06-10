import { useMemo } from "react";
import { useDeckStore } from "../store/deckStore";
import { detectArchetype } from "../lib/archetype";

const COLOR_SYMBOLS: Record<string, string> = {
  W: "☀", U: "💧", B: "💀", R: "🔥", G: "🌿",
};

export function DeckStatsBar() {
  const entries = useDeckStore((s) => s.entries);
  const validation = useDeckStore((s) => s.validation);

  const mainCount = validation.mainCount;
  const sideCount = validation.sideCount;
  const isLegal = validation.legal;

  const detection = useMemo(() => detectArchetype(entries), [entries]);

  // Inline avg MV (replaces former manaBaseStore.analysis.avgMV)
  const avgMV = useMemo(() => {
    const nonlands = entries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"));
    const total = nonlands.reduce((s, e) => s + e.quantity, 0);
    if (total === 0) return null;
    return Math.round(
      (nonlands.reduce((s, e) => s + e.card.cmc * e.quantity, 0) / total) * 100
    ) / 100;
  }, [entries]);

  const colorCounts = useMemo(() => {
    const counts: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
    for (const entry of entries.filter((e) => e.board === "main")) {
      const colors: string[] = JSON.parse(entry.card.colorIdentityJson || "[]");
      for (const c of colors) {
        if (c in counts) counts[c] += entry.quantity;
      }
    }
    return counts;
  }, [entries]);

  const totalPips = Object.values(colorCounts).reduce((s, n) => s + n, 0);

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center py-3 text-xs text-zinc-600 border-b border-zinc-800">
        Add cards to see stats
      </div>
    );
  }

  return (
    <div className="flex items-center gap-4 border-b border-zinc-800 bg-zinc-950 px-3 py-2 text-xs">
      {/* Deck size + legality */}
      <div className="flex items-center gap-1.5">
        <span
          className={`font-mono font-semibold ${
            mainCount === 60 ? "text-emerald-400" : mainCount < 60 ? "text-red-400" : "text-yellow-400"
          }`}
        >
          {mainCount}/60
        </span>
        {sideCount > 0 && (
          <span className={`font-mono ${sideCount === 15 ? "text-zinc-400" : "text-red-400"}`}>
            +{sideCount}
          </span>
        )}
        <span className={isLegal ? "text-emerald-500" : "text-red-500"}>
          {isLegal ? "✓" : "✗"}
        </span>
      </div>

      {/* Archetype */}
      <div className="flex items-center gap-1">
        <span className="text-zinc-400">Arch:</span>
        <span className="text-teal-300 font-medium">{detection.archetype}</span>
        <span className="text-zinc-600">{Math.round(detection.confidence * 100)}%</span>
      </div>

      {/* Avg MV */}
      {avgMV !== null && (
        <div className="flex items-center gap-1">
          <span className="text-zinc-400">Avg MV:</span>
          <span className="text-zinc-200 font-mono">{avgMV}</span>
        </div>
      )}

      {/* Color pips */}
      {totalPips > 0 && (
        <div className="flex items-center gap-1">
          {Object.entries(colorCounts)
            .filter(([, n]) => n > 0)
            .sort((a, b) => b[1] - a[1])
            .map(([c]) => (
              <span key={c} title={c}>{COLOR_SYMBOLS[c] ?? c}</span>
            ))}
        </div>
      )}

      {/* Violation count badge */}
      {validation.violations.length > 0 && (
        <div className="ml-auto flex items-center gap-1 rounded bg-red-950/60 px-1.5 py-0.5 text-red-300">
          <span>⚠</span>
          <span>{validation.violations.length} issue{validation.violations.length > 1 ? "s" : ""}</span>
        </div>
      )}
    </div>
  );
}
