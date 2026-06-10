import { useState } from "react";
import { generateSideboardPlan } from "../lib/sideboardPlan";
import type { SideboardPlan } from "../lib/sideboardPlan";
import type { CardRecord } from "../lib/types";

const ARCHETYPES = ["Aggro", "Control", "Midrange", "Combo", "Ramp"];

interface Props {
  mainboard: CardRecord[];
  sideboard: CardRecord[];
}

export function SideboardPlanPanel({ mainboard, sideboard }: Props) {
  const [archetype, setArchetype] = useState(ARCHETYPES[0]);
  const [plan, setPlan] = useState<SideboardPlan | null>(null);

  const generate = () => {
    setPlan(generateSideboardPlan(archetype, mainboard, sideboard));
  };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 space-y-4">
      <h2 className="text-lg font-semibold">Sideboard Plan</h2>

      <div className="flex gap-2 flex-wrap">
        {ARCHETYPES.map((a) => (
          <button key={a} onClick={() => setArchetype(a)}
            className={`rounded-full px-3 py-1 text-xs font-medium transition-colors ${
              archetype === a ? "bg-teal-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}>{a}</button>
        ))}
      </div>

      <button onClick={generate}
        className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium hover:bg-teal-500">
        Generate Plan
      </button>

      {plan && (
        <div className="space-y-4">
          <div>
            <p className="text-xs font-semibold text-emerald-400 uppercase tracking-wide mb-2">Bring In</p>
            {plan.bringIn.length === 0
              ? <p className="text-xs text-zinc-500">No specific cards identified.</p>
              : plan.bringIn.map((c) => (
                <div key={c.oracleId} className="flex items-start gap-2 py-1">
                  <span className="text-sm font-medium w-4 shrink-0">{c.quantity}</span>
                  <div>
                    <p className="text-sm">{c.name}</p>
                    <p className="text-xs text-zinc-500">{c.rationale}</p>
                  </div>
                </div>
              ))
            }
          </div>

          <div>
            <p className="text-xs font-semibold text-red-400 uppercase tracking-wide mb-2">Take Out</p>
            {plan.takeOut.length === 0
              ? <p className="text-xs text-zinc-500">No specific cards identified.</p>
              : plan.takeOut.map((c) => (
                <div key={c.oracleId} className="flex items-start gap-2 py-1">
                  <span className="text-sm font-medium w-4 shrink-0">{c.quantity}</span>
                  <div>
                    <p className="text-sm">{c.name}</p>
                    <p className="text-xs text-zinc-500">{c.rationale}</p>
                  </div>
                </div>
              ))
            }
          </div>

          {plan.notes && <p className="text-xs text-zinc-500 italic">{plan.notes}</p>}
        </div>
      )}
    </div>
  );
}
