/**
 * MythicViabilityPanel.tsx — Two-track viability breakdown.
 *
 * Renders the two explicit, independent tracks introduced in issue #5:
 *   - Track 1 Structural soundness: aggregate + five sub-score bars
 *     (mana base, curve, land ratio, four-of density, synergy depth).
 *   - Track 2 Competitive strength: a REAL win rate + confidence interval when
 *     the deck matched a tracked archetype, or an explicit "no market data"
 *     state otherwise. A structural number is never presented as a win rate,
 *     and no percentage is shown for unmatched decks.
 */

import type { MythicViabilityReport } from "../lib/generator/types";

interface Props {
  report: MythicViabilityReport;
  tempoScore?: number;
  cardAdvantageScore?: number;
}

/** Color-code a 0–100 value: red < 45, yellow 45–65, green > 65 */
function barColor(value: number): string {
  if (value >= 65) return "bg-green-500";
  if (value >= 45) return "bg-yellow-400";
  return "bg-red-500";
}

function textColor(value: number): string {
  if (value >= 65) return "text-green-400";
  if (value >= 45) return "text-yellow-300";
  return "text-red-400";
}

function ScoreBar({ label, value }: { label: string; value: number }) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">{label}</span>
        <span className={`font-bold tabular-nums ${textColor(clamped)}`}>{clamped.toFixed(0)}</span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${barColor(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

function formatAge(lastUpdated?: number): string | null {
  if (!lastUpdated) return null;
  const hours = Math.max(0, Math.round((Date.now() - lastUpdated) / (60 * 60 * 1000)));
  if (hours < 1) return "updated <1h ago";
  if (hours < 48) return `updated ${hours}h ago`;
  return `updated ${Math.round(hours / 24)}d ago`;
}

function CompetitiveTrack({ report }: { report: MythicViabilityReport }) {
  const c = report.competitive;

  if (c.matched && c.winRate != null) {
    const tier1 = c.winRate >= 55;
    const age = formatAge(c.lastUpdated);
    return (
      <div className="rounded-md border border-zinc-700 bg-zinc-900/60 p-2 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide ${tier1 ? "bg-yellow-500 text-black" : "bg-purple-600 text-white"}`}>
            {tier1 ? "🏆 Tier-1 win rate" : "💎 Competitive"}
          </span>
          <span className="text-sm font-bold text-zinc-100 tabular-nums">{c.winRate.toFixed(1)}% WR</span>
          {c.confidenceInterval && (
            <span className="text-[11px] text-zinc-500 tabular-nums">
              95% CI {c.confidenceInterval[0].toFixed(1)}–{c.confidenceInterval[1].toFixed(1)}%
            </span>
          )}
        </div>
        <div className="text-[11px] text-zinc-400">
          Matched <strong className="text-zinc-200">{c.sourceArchetype}</strong>
          {c.sampleSize != null && <span className="text-zinc-500"> · {c.sampleSize.toLocaleString()} games</span>}
          {c.matchConfidence != null && <span className="text-zinc-500"> · match {(c.matchConfidence * 100).toFixed(0)}%</span>}
        </div>
        <div className="text-[10px] text-zinc-600">
          Real ladder win rate{c.source ? ` · ${c.source}` : ""}{age ? ` · ${age}` : ""}
        </div>
      </div>
    );
  }

  const message =
    c.reason === "format-unsupported"
      ? "No live win-rate source exists for this format."
      : c.reason === "data-not-loaded"
        ? "Live win-rate data not loaded yet."
        : "No comparable market data — this deck doesn't match a tracked archetype.";

  return (
    <div className="rounded-md border border-dashed border-zinc-700 bg-zinc-900/40 p-2 space-y-1">
      <div className="flex items-center gap-2">
        <span className="rounded-full bg-zinc-700 px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide text-zinc-300">
          ❔ No market data
        </span>
        <span className="text-xs text-zinc-400">Structural soundness only</span>
      </div>
      <div className="text-[11px] text-zinc-500">{message}</div>
    </div>
  );
}

export function MythicViabilityPanel({ report, tempoScore, cardAdvantageScore }: Props) {
  const s = report.structural;
  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 text-sm space-y-3">

      {/* ── Track 1: Structural soundness ─────────────────────────────── */}
      <div className="space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">Structural soundness</span>
          <span className={`text-sm font-bold tabular-nums ${textColor(s.score)}`}>{s.score}<span className="text-zinc-600 text-xs">/100</span></span>
        </div>
        <ScoreBar label="Mana base (Karsten)" value={s.manaBase} />
        <ScoreBar label="Curve" value={s.curve} />
        <ScoreBar label="Land ratio" value={s.landRatio} />
        <ScoreBar label="Four-of density" value={s.fourOfDensity} />
        <ScoreBar label="Synergy depth" value={s.synergyDensity} />
      </div>

      {/* ── Track 2: Competitive strength ─────────────────────────────── */}
      <div className="space-y-1 pt-1 border-t border-zinc-700">
        <span className="text-xs font-semibold uppercase tracking-wide text-zinc-300">Competitive strength</span>
        <CompetitiveTrack report={report} />
      </div>

      {/* ── Secondary stats: Tempo + Card Advantage ──────────────────── */}
      {(tempoScore !== undefined || cardAdvantageScore !== undefined) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-zinc-700">
          {tempoScore !== undefined && (
            <span className="text-xs text-zinc-400">
              Tempo: <strong className={textColor(tempoScore)}>{tempoScore.toFixed(0)}</strong>
              <span className="text-zinc-600">/100</span>
            </span>
          )}
          {cardAdvantageScore !== undefined && (
            <span className="text-xs text-zinc-400">
              Card Adv: <strong className={textColor(cardAdvantageScore)}>{cardAdvantageScore.toFixed(0)}</strong>
              <span className="text-zinc-600">/100</span>
            </span>
          )}
        </div>
      )}

      {/* ── Structural notes ─────────────────────────────────────────── */}
      {s.notes.length > 0 && (
        <ul className="space-y-0.5 pt-1 border-t border-zinc-700">
          {s.notes.map((note, i) => (
            <li key={i} className="flex gap-1.5 text-xs text-zinc-400">
              <span className="shrink-0 text-zinc-600">•</span>
              <span>{note}</span>
            </li>
          ))}
        </ul>
      )}

    </div>
  );
}
