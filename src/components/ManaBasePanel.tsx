import { useMemo } from "react";
import { useLiveQuery } from "dexie-react-hooks";
import { db } from "../lib/db";
import {
  recommendLandCount,
  recommendColorSources,
  recommendDualLands,
  buildManaCurve,
  computeCastabilityWarnings,
} from "../lib/manaBase";
import { useDeckStore } from "../store/deckStore";
import type { DeckEntry } from "../lib/legality";

type Color = "W" | "U" | "B" | "R" | "G";

const COLOR_LABELS: Record<string, string> = {
  W: "White", U: "Blue", B: "Black", R: "Red", G: "Green",
};
const COLOR_BG: Record<string, string> = {
  W: "bg-yellow-100 text-yellow-900",
  U: "bg-blue-100 text-blue-900",
  B: "bg-zinc-800 text-zinc-100",
  R: "bg-red-100 text-red-900",
  G: "bg-green-100 text-green-900",
};

export function ManaBasePanel() {
  const entries = useDeckStore(s => s.entries) as DeckEntry[];

  const mainboard = useMemo(
    () => entries.filter(e => e.board === "main"),
    [entries]
  );

  const landRec = useMemo(() => recommendLandCount(mainboard), [mainboard]);

  const colorSources = useMemo(
    () => recommendColorSources(mainboard, landRec.recommended),
    [mainboard, landRec.recommended]
  );

  const activeColors = useMemo<Color[]>(
    () => colorSources.map(c => c.color as Color),
    [colorSources]
  );

  // Only pull land cards from the DB; full-collection scan is the bottleneck
  // we're avoiding. Dexie indexes can't do "contains", so we filter in JS but
  // never materialize the non-land slice into the React tree.
  const lands = useLiveQuery(
    () => db.cards.filter(c => c.typeLine.includes("Land")).toArray(),
    []
  ) ?? [];

  const duals = useMemo(
    () => recommendDualLands(lands, activeColors, landRec.recommended),
    [lands, activeColors, landRec.recommended]
  );

  const curve = useMemo(() => buildManaCurve(mainboard), [mainboard]);
  const maxCurve = Math.max(...curve.map(s => s.total), 1);

  const deckSize = mainboard.reduce((s, e) => s + e.quantity, 0);
  const castabilityWarnings = useMemo(
    () => computeCastabilityWarnings(mainboard, deckSize),
    [mainboard, deckSize]
  );

  const currentLands = mainboard
    .filter(e => e.card.typeLine.includes("Land"))
    .reduce((s, e) => s + e.quantity, 0);

  if (mainboard.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500 text-sm">
        <p>Add cards to see mana base analysis.</p>
      </div>
    );
  }

  return (
    <div className="space-y-6 text-sm">

      {/* Land count */}
      <section>
        <h3 className="font-semibold text-zinc-200 mb-2">Land Count</h3>
        <div className="flex items-center gap-4">
          <div className="text-3xl font-bold text-teal-400">{currentLands}</div>
          <div className="text-zinc-400">
            <span className="text-zinc-200">Recommended: {landRec.recommended}</span>
            <span className="ml-2 text-zinc-500">(range {landRec.rangeMin}–{landRec.rangeMax})</span>
          </div>
        </div>
        <p className="text-zinc-500 mt-1">Avg MV: {landRec.avgManaValue.toFixed(2)}</p>
        {currentLands !== landRec.recommended && (
          <p className={`mt-1 font-medium ${
            currentLands < landRec.rangeMin ? "text-red-400" :
            currentLands > landRec.rangeMax ? "text-amber-400" : "text-teal-400"
          }`}>
            {currentLands < landRec.rangeMin
              ? `⚠ ${landRec.recommended - currentLands} lands short`
              : currentLands > landRec.rangeMax
              ? `Consider cutting ${currentLands - landRec.recommended} land${currentLands - landRec.recommended > 1 ? "s" : ""}`
              : "✓ In range"}
          </p>
        )}
        {landRec.adjustments.length > 0 && (
          <ul className="mt-2 space-y-0.5 text-zinc-500">
            {landRec.adjustments.map((adj, i) => (
              <li key={i}>{adj}</li>
            ))}
          </ul>
        )}
      </section>

      {/* Color sources */}
      {colorSources.length > 0 && (
        <section>
          <h3 className="font-semibold text-zinc-200 mb-2">Color Sources</h3>
          <div className="space-y-2">
            {colorSources.map(cs => (
              <div key={cs.color} className="flex items-center gap-3">
                <span className={`rounded px-1.5 py-0.5 text-xs font-bold ${
                  COLOR_BG[cs.color] ?? "bg-zinc-700 text-zinc-100"
                }`}>
                  {cs.color}
                </span>
                <span className="text-zinc-300 w-16">{COLOR_LABELS[cs.color]}</span>
                <div className="flex-1 h-2 bg-zinc-800 rounded-full overflow-hidden">
                  <div
                    className="h-full bg-teal-500 rounded-full transition-all"
                    style={{ width: `${Math.round(cs.ratio * 100)}%` }}
                  />
                </div>
                <span className="text-zinc-400 w-28 text-right">
                  {cs.recommendedSources} sources
                  {cs.criticallyUndersourced && (
                    <span className="ml-1 text-red-400">⚠</span>
                  )}
                </span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Mana curve */}
      <section>
        <h3 className="font-semibold text-zinc-200 mb-2">Mana Curve</h3>
        <div className="flex items-end gap-1.5 h-24">
          {curve.map(slot => (
            <div key={slot.mv} className="flex flex-col items-center flex-1">
              <div
                className="w-full bg-teal-600 rounded-t transition-all"
                style={{ height: `${Math.round((slot.total / maxCurve) * 88)}px` }}
                title={`${slot.total} card${slot.total !== 1 ? "s" : ""} at MV ${slot.mv}`}
              />
              <span className="text-zinc-500 text-xs mt-1">{slot.mv === 7 ? "7+" : slot.mv}</span>
            </div>
          ))}
        </div>
        <div className="flex gap-1.5 mt-1">
          {curve.map(slot => (
            <div key={slot.mv} className="flex-1 text-center text-zinc-400 text-xs">
              {slot.total || ""}
            </div>
          ))}
        </div>
      </section>

      {/* Dual land suggestions */}
      {duals.length > 0 && (
        <section>
          <h3 className="font-semibold text-zinc-200 mb-2">Suggested Dual Lands</h3>
          <div className="space-y-1.5">
            {duals.slice(0, 8).map(d => (
              <div
                key={d.card.id}
                className="flex items-center justify-between rounded-md bg-zinc-800 px-3 py-1.5"
              >
                <div>
                  <span className="text-zinc-100">{d.card.name}</span>
                  <span className={`ml-2 text-xs ${
                    d.tier === 1 ? "text-teal-400" :
                    d.tier === 2 ? "text-amber-400" : "text-zinc-500"
                  }`}>
                    T{d.tier}
                  </span>
                </div>
                <span className="text-zinc-500 text-xs">{d.tierLabel}</span>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Castability warnings */}
      {castabilityWarnings.length > 0 && (
        <section>
          <h3 className="font-semibold text-zinc-200 mb-2">Castability Warnings</h3>
          <div className="space-y-1.5">
            {castabilityWarnings.map(w => (
              <div
                key={w.cardName}
                className="flex items-center justify-between rounded-md bg-red-950/40 border border-red-900/40 px-3 py-1.5"
              >
                <div>
                  <span className="text-zinc-200">{w.cardName}</span>
                  <span className="ml-2 text-zinc-500 text-xs">MV {w.cmc} · {w.copiesInDeck}×</span>
                </div>
                <span className="text-red-400 text-xs">
                  {Math.round(w.probByNaturalTurn * 100)}% by T{w.naturalTurn}
                </span>
              </div>
            ))}
          </div>
          <p className="text-zinc-600 text-xs mt-2">
            Cards below 60% probability of appearing by their natural turn.
          </p>
        </section>
      )}
    </div>
  );
}
