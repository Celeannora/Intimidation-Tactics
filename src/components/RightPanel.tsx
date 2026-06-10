import { useMemo, useState } from "react";
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

type Tab =
  | "generate" | "curve" | "mana" | "consistency" | "archetype" | "validate" | "gameplan"
  | "bo3" | "sideboard" | "matches" | "export";

const TABS: { id: Tab; label: string }[] = [
  { id: "generate",    label: "Generate" },
  { id: "curve",       label: "Curve" },
  { id: "mana",        label: "Mana" },
  { id: "consistency", label: "Odds" },
  { id: "archetype",   label: "Archetype" },
  { id: "validate",    label: "Validate" },
  { id: "gameplan",    label: "Plan" },
  { id: "bo3",         label: "Bo3" },
  { id: "sideboard",   label: "Side" },
  { id: "matches",     label: "Matches" },
  { id: "export",      label: "Export" },
];

interface Props {
  activeDeckId: string;
}

export function RightPanel({ activeDeckId }: Props) {
  const [tab, setTab] = useState<Tab>("generate");

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

  return (
    <div className="flex flex-col h-full">
      <DeckStatsBar />

      {/* Tab strip */}
      <div
        role="tablist"
        aria-label="Analysis panels"
        className="flex shrink-0 overflow-x-auto border-b border-zinc-800 scrollbar-none"
      >
        {TABS.map((t) => (
          <button
            key={t.id}
            role="tab"
            id={`tab-${t.id}`}
            aria-selected={tab === t.id}
            aria-controls={`tabpanel-${t.id}`}
            onClick={() => setTab(t.id)}
            tabIndex={tab === t.id ? 0 : -1}
            className={`shrink-0 px-3 py-2 text-xs font-medium whitespace-nowrap transition-colors ${
              tab === t.id
                ? "border-b-2 border-teal-400 text-teal-300"
                : "text-zinc-500 hover:text-zinc-300"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {/* Tab panels stay mounted so form/chart state survives tab changes. */}
      <div className="flex-1 overflow-hidden">
        <PersistentTabPanel tab="generate" activeTab={tab}><GeneratorPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="curve" activeTab={tab}><ManaCurveChart /></PersistentTabPanel>
        <PersistentTabPanel tab="mana" activeTab={tab}><ManaBasePanel /></PersistentTabPanel>
        <PersistentTabPanel tab="consistency" activeTab={tab}><ConsistencyPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="archetype" activeTab={tab}><ArchetypePanel /></PersistentTabPanel>
        <PersistentTabPanel tab="validate" activeTab={tab}><ValidationPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="gameplan" activeTab={tab}><GamePlanSummary /></PersistentTabPanel>
        <PersistentTabPanel tab="bo3" activeTab={tab}><Bo3Panel deckId={activeDeckId} /></PersistentTabPanel>
        <PersistentTabPanel tab="sideboard" activeTab={tab}><SideboardPlanPanel mainboard={mainCards} sideboard={sideCards} /></PersistentTabPanel>
        <PersistentTabPanel tab="matches" activeTab={tab}><MatchTrackerPanel /></PersistentTabPanel>
        <PersistentTabPanel tab="export" activeTab={tab}><DeckExportPanel deck={exportDeck} /></PersistentTabPanel>
      </div>
    </div>
  );
}

function PersistentTabPanel({ tab, activeTab, children }: { tab: Tab; activeTab: Tab; children: React.ReactNode }) {
  const active = tab === activeTab;
  return (
    <div
      role="tabpanel"
      id={`tabpanel-${tab}`}
      aria-labelledby={`tab-${tab}`}
      hidden={!active}
      className="h-full overflow-y-auto p-3"
    >
      {children}
    </div>
  );
}
