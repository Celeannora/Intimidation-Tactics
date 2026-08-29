import { useDeckStore } from "../store/deckStore";
import { getFormatRules } from "../lib/formats";

/**
 * Full violation list rendered in the right panel's Validate tab.
 * Also shows mainCount / sideCount readout.
 */
export function ValidationPanel() {
  const { legal, mainCount, sideCount, violations } = useDeckStore(s => s.validation);
  const rules = getFormatRules(useDeckStore(s => s.activeFormat));

  return (
    <div className="space-y-3 text-sm">
      {/* Counts */}
      <div className="flex items-center gap-4 text-zinc-400">
        <span>
          Mainboard{" "}
          <strong
            className={
              mainCount < rules.minMainboardSize
                ? "text-red-400"
                : mainCount > rules.defaultMainboardSize
                  ? "text-yellow-400"
                  : "text-emerald-400"
            }
          >
            {mainCount}
          </strong>
          {" "}/ {rules.defaultMainboardSize}
        </span>
        <span>
          Sideboard{" "}
          <strong
            className={
              sideCount === 0 || sideCount === rules.sideboardSize
                ? "text-emerald-400"
                : "text-red-400"
            }
          >
            {sideCount}
          </strong>
          {" "}/ {rules.sideboardSize ?? "—"}
        </span>
      </div>

      {/* Overall status */}
      {legal ? (
        <p className="rounded-lg border border-emerald-800 bg-emerald-950/40 px-3 py-2 text-emerald-300">
          ✓ Deck is legal
        </p>
      ) : (
        <div className="space-y-2">
          {violations.map((v, i) => (
            <div
              key={i}
              className="rounded-lg border border-red-800 bg-red-950/40 px-3 py-2 text-red-200"
            >
              <span className="mr-2 font-mono text-xs text-red-400">[{v.rule}]</span>
              {v.message}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
