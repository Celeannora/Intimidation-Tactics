/**
 * ConsistencyPanel
 *
 * Displays the full consistency report for the active deck:
 *  - Opening hand stats (keep rate, screw/flood rates, avg lands)
 *  - Consistency grade
 *  - Mana source warnings
 *  - Per-card castability table with on-curve probability and flag badges
 *  - Turn-by-turn castability rows (expandable)
 */
import { useState } from "react";
import { useConsistencyReport } from "../hooks/useConsistencyReport";
import type { CastabilityRow } from "../lib/consistencyReport";

// ─── helpers ────────────────────────────────────────────────────────────────

function pct(n: number) {
  return `${Math.round(n * 100)}%`;
}

function gradeColor(grade: string) {
  switch (grade) {
    case "A": return "text-teal-300";
    case "B": return "text-green-400";
    case "C": return "text-yellow-400";
    case "D": return "text-orange-400";
    default:  return "text-red-400";
  }
}

function probColor(p: number) {
  if (p >= 0.75) return "text-teal-300";
  if (p >= 0.60) return "text-yellow-400";
  return "text-red-400";
}

function StatPill({ label, value, danger }: { label: string; value: string; danger?: boolean }) {
  return (
    <div className="flex flex-col items-center rounded-lg bg-zinc-900 px-3 py-2 min-w-[70px]">
      <span className={`text-base font-semibold tabular-nums ${danger ? "text-red-400" : "text-zinc-100"}`}>
        {value}
      </span>
      <span className="mt-0.5 text-[10px] text-zinc-500 text-center leading-tight">{label}</span>
    </div>
  );
}

// ─── Expandable card row ─────────────────────────────────────────────────────

function CardRow({ row }: { row: CastabilityRow }) {
  const [open, setOpen] = useState(false);
  const naturalTurn = Math.max(1, row.cmc);

  return (
    <>
      <tr
        className={`border-b border-zinc-800/60 cursor-pointer hover:bg-zinc-800/30 transition-colors ${
          row.flagged ? "bg-red-950/10" : ""
        }`}
        onClick={() => setOpen(o => !o)}
        aria-expanded={open}
      >
        {/* Expand toggle */}
        <td className="py-1.5 pl-2 pr-1 text-zinc-500 text-xs w-4">
          <span aria-hidden>{open ? "▾" : "▸"}</span>
        </td>
        {/* Name */}
        <td className="py-1.5 pr-2 text-xs text-zinc-200 max-w-[120px] truncate">
          {row.cardName}
        </td>
        {/* CMC */}
        <td className="py-1.5 pr-2 text-xs text-zinc-400 tabular-nums text-right">
          {row.cmc}
        </td>
        {/* Copies */}
        <td className="py-1.5 pr-2 text-xs text-zinc-400 tabular-nums text-right">
          {row.copies}
        </td>
        {/* On-curve % */}
        <td className={`py-1.5 pr-2 text-xs tabular-nums text-right font-medium ${
          probColor(row.probOnNaturalTurn)
        }`}>
          {pct(row.probOnNaturalTurn)}
        </td>
        {/* Flag */}
        <td className="py-1.5 pr-2 text-right">
          {row.flagged && (
            <span className="rounded-sm bg-red-900/60 px-1 py-0.5 text-[9px] font-medium text-red-300 uppercase tracking-wide">
              !
            </span>
          )}
        </td>
      </tr>

      {/* Expanded turn-by-turn breakdown */}
      {open && (
        <tr className="bg-zinc-900/60">
          <td colSpan={6} className="py-2 px-4">
            <p className="text-[10px] text-zinc-500 mb-1">
              Turn-by-turn castability (natural turn = {naturalTurn})
            </p>
            <div className="overflow-x-auto">
              <table className="w-full text-[10px] tabular-nums">
                <thead>
                  <tr className="text-zinc-600">
                    <th className="text-right pr-3 font-normal">Turn</th>
                    <th className="text-right pr-3 font-normal">Drawn</th>
                    <th className="text-right pr-3 font-normal">Mana</th>
                    <th className="text-right pr-3 font-normal">Castable</th>
                  </tr>
                </thead>
                <tbody>
                  {row.byTurn.map(r => (
                    <tr
                      key={r.turn}
                      className={r.turn === naturalTurn ? "text-teal-400" : "text-zinc-400"}
                    >
                      <td className="text-right pr-3">{r.turn}</td>
                      <td className="text-right pr-3">{pct(r.probDrawn)}</td>
                      <td className="text-right pr-3">{pct(r.probMana)}</td>
                      <td className={`text-right pr-3 font-semibold ${probColor(r.probCastable)}`}>
                        {pct(r.probCastable)}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </td>
        </tr>
      )}
    </>
  );
}

// ─── Main panel ──────────────────────────────────────────────────────────────

export function ConsistencyPanel() {
  const state = useConsistencyReport();

  if (state.status === "idle") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-500 gap-3">
        <svg className="w-8 h-8 text-zinc-700" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden>
          <path d="M9 17H7A5 5 0 0 1 7 7h2" />
          <path d="M15 7h2a5 5 0 0 1 0 10h-2" />
          <line x1="8" y1="12" x2="16" y2="12" />
        </svg>
        <p className="text-sm">Add cards to compute consistency.</p>
      </div>
    );
  }

  if (state.status === "computing") {
    return (
      <div className="flex flex-col items-center justify-center py-16 text-zinc-400 gap-3">
        <svg className="w-6 h-6 animate-spin text-teal-500" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" aria-label="Computing">
          <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
        </svg>
        <p className="text-sm">Running 10 000 simulations…</p>
      </div>
    );
  }

  if (state.status === "error") {
    return (
      <div className="rounded-lg border border-red-800 bg-red-950/30 p-4 text-sm text-red-300">
        <p className="font-medium mb-1">Analysis failed</p>
        <p className="text-xs text-red-400">{state.message}</p>
      </div>
    );
  }

  const { report } = state;
  const { handStats } = report;

  return (
    <div className="space-y-4">

      {/* ── Summary header ── */}
      <div className="flex items-start justify-between gap-2">
        <div>
          <h2 className="text-xs font-semibold uppercase tracking-widest text-zinc-500 mb-1">
            Consistency
          </h2>
          <p className="text-[11px] text-zinc-500 leading-relaxed max-w-[200px]">
            {report.summary}
          </p>
        </div>
        <div className={`text-5xl font-bold tabular-nums leading-none ${gradeColor(report.grade)}`}>
          {report.grade}
        </div>
      </div>

      {/* ── Hand stats ── */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">Opening Hand Stats</p>
        <div className="flex gap-2 flex-wrap">
          <StatPill label="Keep rate"   value={pct(handStats.keepRate)} />
          <StatPill label="Avg lands"   value={handStats.avgLandsInHand.toString()} />
          <StatPill label="Screw"       value={pct(handStats.screwRate)} danger={handStats.screwRate > 0.15} />
          <StatPill label="Flood"       value={pct(handStats.floodRate)} danger={handStats.floodRate > 0.20} />
        </div>
      </div>

      {/* ── Mana source warnings ── */}
      {report.manaWarnings.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">Mana Source Warnings</p>
          {report.manaWarnings.map(w => (
            <div
              key={w.color}
              className="rounded-md border border-orange-800/50 bg-orange-950/20 px-3 py-2 text-[11px] text-orange-300"
            >
              {w.message}
            </div>
          ))}
        </div>
      )}

      {/* ── Flagged cards ── */}
      {report.flaggedCards.length > 0 && (
        <div className="space-y-1.5">
          <p className="text-[10px] uppercase tracking-widest text-zinc-600">
            Low Castability ({report.flaggedCards.length})
          </p>
          {report.flaggedCards.map(r => (
            <div
              key={r.cardName}
              className="rounded-md border border-red-800/40 bg-red-950/20 px-3 py-2 text-[11px] text-red-300"
            >
              {r.warning}
            </div>
          ))}
        </div>
      )}

      {/* ── Per-card castability table ── */}
      <div>
        <p className="text-[10px] uppercase tracking-widest text-zinc-600 mb-2">
          Castability (click to expand turns)
        </p>
        <div className="overflow-x-auto rounded-lg border border-zinc-800">
          <table className="w-full text-xs">
            <thead>
              <tr className="border-b border-zinc-800 text-zinc-600">
                <th className="py-1.5 pl-2 pr-1 w-4" />
                <th className="py-1.5 pr-2 text-left font-medium">Card</th>
                <th className="py-1.5 pr-2 text-right font-medium">MV</th>
                <th className="py-1.5 pr-2 text-right font-medium">×</th>
                <th className="py-1.5 pr-2 text-right font-medium">On curve</th>
                <th className="py-1.5 pr-2 w-6" />
              </tr>
            </thead>
            <tbody>
              {report.castabilityRows.map(row => (
                <CardRow key={row.cardName} row={row} />
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* ── Deck composition summary ── */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 px-4 py-3 text-[11px] text-zinc-400 flex gap-4 flex-wrap">
        <span><span className="text-zinc-200 font-medium">{report.deckSize}</span> cards</span>
        <span><span className="text-zinc-200 font-medium">{report.landCount}</span> lands</span>
        <span><span className="text-zinc-200 font-medium">{report.avgManaValue}</span> avg MV</span>
      </div>

    </div>
  );
}
