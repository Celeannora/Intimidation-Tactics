import { useMemo, useState, type ReactNode } from "react";
import { DeckStatsBar } from "./DeckStatsBar";
import { ManaCurveChart } from "./ManaCurveChart";
import { ManaBasePanel } from "./ManaBasePanel";
import { ArchetypePanel } from "./ArchetypePanel";
import { ValidationPanel } from "./ValidationPanel";
import { GamePlanSummary } from "./GamePlanSummary";
import { Bo3Panel } from "./Bo3Panel";
import { SideboardPlanPanel } from "./SideboardPlanPanel";
import { DeckExportPanel } from "./DeckExportPanel";
import { ConsistencyPanel } from "./ConsistencyPanel";
import { MatchTrackerPanel } from "./MatchTrackerPanel";
import { GeneratorPanel } from "./GeneratorPanel";
import { useDeckStore, useMainboardEntries, useSideboardEntries } from "../store/deckStore";

// Leaf panels. Each maps 1:1 to a mounted panel component.
type LeafTab =
  | "generate" | "curve" | "mana" | "consistency" | "archetype" | "validate" | "gameplan"
  | "bo3" | "sideboard" | "matches" | "export";

// Top-level groups shown in the primary tab strip.
type Group = "generate" | "analysis" | "playtest" | "export";

const GROUPS: { id: Group; label: string }[] = [
  { id: "generate", label: "Generate" },
  { id: "analysis", label: "Analysis" },
  { id: "playtest", label: "Playtest" },
  { id: "export",   label: "Export" },
];

const ANALYSIS_SUBS: { id: LeafTab; label: string }[] = [
  { id: "curve",       label: "Curve" },
  { id: "mana",        label: "Mana" },
  { id: "consistency", label: "Odds" },
  { id: "archetype",   label: "Archetype" },
  { id: "validate",    label: "Validate" },
  { id: "gameplan",    label: "Plan" },
];

const PLAYTEST_SUBS: { id: LeafTab; label: string }[] = [
  { id: "bo3",       label: "Bo3" },
  { id: "sideboard", label: "Sideboard" },
  { id: "matches",   label: "Matches" },
];

interface Props {
  activeDeckId: string;
}

export function RightPanel({ activeDeckId }: Props) {
  const [group, setGroup] = useState<Group>("generate");
  // Remember the last sub-tab per group so switching top tabs is not jarring.
  const [analysisSub, setAnalysisSub] = useState<LeafTab>("curve");
  const [playtestSub, setPlaytestSub] = useState<LeafTab>("bo3");

  const mainEntries = useMainboardEntries();
  const sideEntries = useSideboardEntries();
  const deckName    = useDeckStore(s => s.deckName);

  const mainCards = useMemo(() => mainEntries.map(e => e.card), [mainEntries]);
  const sideCards = useMemo(() => sideEntries.map(e => e.card), [sideEntries]);

  const exportDeck = useMemo(() => ({
    name:      deckName,
    mainboard: mainEntries.map(e => ({ quantity: e.quantity, card: e.card })),
    sideboard: sideEntries.map(e => ({ quantity: e.quantity, card: e.card })),
  }), [mainEntries, sideEntries, deckName]);

  // The single visible leaf panel, resolved from the active group + its sub-tab.
  const activeLeaf: LeafTab =
    group === "generate" ? "generate"
    : group === "export" ? "export"
    : group === "analysis" ? analysisSub
    : playtestSub;

  const subNav =
    group === "analysis" ? { subs: ANALYSIS_SUBS, active: analysisSub, set: setAnalysisSub, label: "Analysis panels" }
    : group === "playtest" ? { subs: PLAYTEST_SUBS, active: playtestSub, set: setPlaytestSub, label: "Playtest panels" }
    : null;

  return (
    <div className="flex flex-col h-full">
      <DeckStatsBar />

      {/* Primary group strip */}
      <div
        role="tablist"
        aria-label="Deck panels"
        className="flex shrink-0 overflow-x-auto border-b border-zinc-800 scrollbar-none"
      >
        {GROUPS.map((g) => (
          <button
            key={g.id}
            role="tab"
            id={`group-${g.id}`}
            aria-selected={group === g.id}
            onClick={() => setGroup(g.id)}
            tabIndex={group === g.id ? 0 : -1}
            className={`shrink-0 px-4 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              group === g.id
                ? "border-b-2 border-teal-400 text-teal-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {g.label}
          </button>
        ))}
      </div>

      {/* Secondary sub-nav (Analysis / Playtest only) */}
      {subNav && (
        <div
          role="tablist"
          aria-label={subNav.label}
          className="flex shrink-0 flex-wrap gap-1 border-b border-zinc-800/60 bg-zinc-950/40 px-2 py-1.5"
        >
          {subNav.subs.map((s) => (
            <button
              key={s.id}
              role="tab"
              id={`tab-${s.id}`}
              aria-selected={subNav.active === s.id}
              aria-controls={`tabpanel-${s.id}`}
              onClick={() => subNav.set(s.id)}
              tabIndex={subNav.active === s.id ? 0 : -1}
              className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
                subNav.active === s.id
                  ? "bg-teal-600 text-white"
                  : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200"
              }`}
            >
              {s.label}
            </button>
          ))}
        </div>
      )}

      {/* Tab panels stay mounted so form/chart state survives tab changes. */}
      <div className="flex-1 overflow-hidden">
        <PersistentTabPanel tab="generate" activeTab={activeLeaf}><GeneratorPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="curve" activeTab={activeLeaf}><ManaCurveChart /></PersistentTabPanel>
        <PersistentTabPanel tab="mana" activeTab={activeLeaf}><ManaBasePanel /></PersistentTabPanel>
        <PersistentTabPanel tab="consistency" activeTab={activeLeaf}><ConsistencyPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="archetype" activeTab={activeLeaf}><ArchetypePanel /></PersistentTabPanel>
        <PersistentTabPanel tab="validate" activeTab={activeLeaf}><ValidationPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="gameplan" activeTab={activeLeaf}><GamePlanSummary /></PersistentTabPanel>
        <PersistentTabPanel tab="bo3" activeTab={activeLeaf}><Bo3Panel deckId={activeDeckId} /></PersistentTabPanel>
        <PersistentTabPanel tab="sideboard" activeTab={activeLeaf}><SideboardPlanPanel mainboard={mainCards} sideboard={sideCards} /></PersistentTabPanel>
        <PersistentTabPanel tab="matches" activeTab={activeLeaf}><MatchTrackerPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="export" activeTab={activeLeaf}><DeckExportPanel deck={exportDeck} /></PersistentTabPanel>
      </div>
    </div>
  );
}

function PersistentTabPanel({ tab, activeTab, children }: { tab: LeafTab; activeTab: LeafTab; children: ReactNode }) {
  const active = tab === activeTab;
  // Generate/Export are labelled by their primary-strip button; the rest by their sub-nav button.
  const labelledBy = tab === "generate" || tab === "export" ? `group-${tab}` : `tab-${tab}`;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tab}`}
      aria-labelledby={labelledBy}
      hidden={!active}
      className="h-full overflow-y-auto p-3"
    >
      {children}
    </div>
  );
}
