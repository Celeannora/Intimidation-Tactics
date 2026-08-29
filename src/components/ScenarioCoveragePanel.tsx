import type { DeckScenarioCoverage } from "../lib/generator/types";

interface Props {
  coverage: DeckScenarioCoverage;
}

/** Color-code a 0–100 value: red < 45, yellow 45–65, green >= 65. */
function textColor(value: number): string {
  if (value >= 65) return "text-green-400";
  if (value >= 45) return "text-yellow-300";
  return "text-red-400";
}

export function ScenarioCoveragePanel({ coverage }: Props) {
  return (
    <div className="rounded-md border border-zinc-700 bg-zinc-900/60 p-2 text-xs space-y-2" data-testid="panel-scenario-coverage">
      <div className="flex items-center justify-between">
        <span className="font-semibold uppercase tracking-wide text-zinc-300">Scenario coverage</span>
        <span className={`text-sm font-bold tabular-nums ${textColor(coverage.consistencyScore)}`}>
          {coverage.consistencyScore}
          <span className="text-xs text-zinc-600">/100</span>
        </span>
      </div>

      <p className="text-zinc-400" data-testid="text-scenario-coverage-summary">
        {coverage.coveredCount}/{coverage.totalScenarios} opponent scenarios covered
      </p>

      <div className="space-y-1">
        {coverage.scenarios.map((scenario) => (
          <div key={scenario.scenarioId} className="rounded border border-zinc-800 bg-zinc-950/30 px-2 py-1">
            <div className="flex flex-wrap items-center gap-x-1.5 gap-y-1">
              <span className="font-medium text-zinc-200">{scenario.scenarioName}</span>
              <span
                className={[
                  "rounded-full px-2 py-0.5 text-[10px] font-bold uppercase tracking-wide",
                  scenario.covered
                    ? "bg-green-900/60 text-green-300"
                    : "bg-red-950/60 text-red-300",
                ].join(" ")}
              >
                {scenario.covered ? "✓ Covered" : "⚠ Gap"}
              </span>
              {scenario.sourceArchetypeNames.length > 0 && (
                <span className="text-[11px] text-zinc-500">
                  vs {scenario.sourceArchetypeNames.join(", ")}
                </span>
              )}
            </div>
            {scenario.covered && scenario.answeringCards.length > 0 && (
              <p className="mt-0.5 text-[11px] text-zinc-500">
                Answered by: {scenario.answeringCards.slice(0, 3).join(", ")}
              </p>
            )}
          </div>
        ))}
      </div>
    </div>
  );
}
