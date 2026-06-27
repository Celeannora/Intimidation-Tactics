/**
 * MythicViabilityPanel.tsx — Detailed sonar.md viability breakdown panel.
 *
 * Renders:
 *   - Label badge (tier-1 / mythic-viable / fringe / not-viable)
 *   - Estimated win rate
 *   - Three pillar progress bars: Consistency, Redundancy, Meta Positioning
 *   - Two secondary stats: Tempo Score and Card Advantage Score
 *   - Notes list from report.notes
 *
 * Designed to slot in below the inline viability badge in GeneratorPanel.
 */

import type { MythicViabilityReport } from "../lib/generator/types";

interface Props {
  report: MythicViabilityReport;
  tempoScore?: number;
  cardAdvantageScore?: number;
}

/** Color-code a 0–100 pillar value: red < 45, yellow 45–65, green > 65 */
function pillarColor(value: number): string {
  if (value >= 65) return "bg-green-500";
  if (value >= 45) return "bg-yellow-400";
  return "bg-red-500";
}

function pillarTextColor(value: number): string {
  if (value >= 65) return "text-green-400";
  if (value >= 45) return "text-yellow-300";
  return "text-red-400";
}

interface PillarBarProps {
  label: string;
  value: number;
  weight: string;
}

function PillarBar({ label, value, weight }: PillarBarProps) {
  const clamped = Math.max(0, Math.min(100, value));
  return (
    <div className="flex flex-col gap-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="text-zinc-400">
          {label}
          <span className="ml-1 text-zinc-600 text-[10px]">({weight})</span>
        </span>
        <span className={`font-bold tabular-nums ${pillarTextColor(clamped)}`}>
          {clamped.toFixed(0)}
        </span>
      </div>
      <div className="h-1.5 w-full rounded-full bg-zinc-700 overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-300 ${pillarColor(clamped)}`}
          style={{ width: `${clamped}%` }}
        />
      </div>
    </div>
  );
}

export function MythicViabilityPanel({ report, tempoScore, cardAdvantageScore }: Props) {
  const badgeClasses = [
    "rounded-full px-3 py-0.5 text-xs font-bold uppercase tracking-wide",
    report.label === "tier-1"        ? "bg-yellow-500 text-black" :
    report.label === "mythic-viable" ? "bg-purple-600 text-white" :
    report.label === "fringe"        ? "bg-blue-600 text-white" :
                                       "bg-zinc-700 text-zinc-300",
  ].join(" ");

  const badgeText =
    report.label === "tier-1"        ? "🏆 Tier 1" :
    report.label === "mythic-viable" ? "💎 Mythic Viable" :
    report.label === "fringe"        ? "⚡ Fringe" :
                                       "🔧 Not Viable";

  return (
    <div className="rounded-lg border border-zinc-700 bg-zinc-800/60 p-3 text-sm space-y-3">

      {/* ── Header row: badge + score + win rate ─────────────────────── */}
      <div className="flex flex-wrap items-center gap-2">
        <span className={badgeClasses}>{badgeText}</span>
        <span className="text-zinc-400 text-xs">
          Viability:{" "}
          <strong className="text-zinc-200">{report.score.toFixed(0)}</strong>
          <span className="text-zinc-500">/100</span>
        </span>
        <span className="text-zinc-500 text-xs">
          ~{(report.winRateEstimate * 100).toFixed(1)}% WR (est.)
        </span>
      </div>

      {/* ── Three pillar bars ─────────────────────────────────────────── */}
      <div className="space-y-2">
        <PillarBar label="Consistency"      value={report.pillars.consistency}     weight="45%" />
        <PillarBar label="Redundancy"       value={report.pillars.redundancy}      weight="30%" />
        <PillarBar label="Meta Positioning" value={report.pillars.metaPositioning} weight="25%" />
      </div>

      {/* ── Secondary stats: Tempo + Card Advantage ──────────────────── */}
      {(tempoScore !== undefined || cardAdvantageScore !== undefined) && (
        <div className="flex flex-wrap gap-x-4 gap-y-1 pt-1 border-t border-zinc-700">
          {tempoScore !== undefined && (
            <span className="text-xs text-zinc-400">
              Tempo:{" "}
              <strong className={pillarTextColor(tempoScore)}>
                {tempoScore.toFixed(0)}
              </strong>
              <span className="text-zinc-600">/100</span>
            </span>
          )}
          {cardAdvantageScore !== undefined && (
            <span className="text-xs text-zinc-400">
              Card Adv:{" "}
              <strong className={pillarTextColor(cardAdvantageScore)}>
                {cardAdvantageScore.toFixed(0)}
              </strong>
              <span className="text-zinc-600">/100</span>
            </span>
          )}
        </div>
      )}

      {/* ── Notes list ───────────────────────────────────────────────── */}
      {report.notes && report.notes.length > 0 && (
        <ul className="space-y-0.5 pt-1 border-t border-zinc-700">
          {report.notes.map((note, i) => (
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
