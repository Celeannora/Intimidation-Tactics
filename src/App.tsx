import { useCallback, useEffect, useRef, useState } from "react";
import { BulkImporter } from "./components/BulkImporter";
import { SynergyPreAnalysisPanel } from "./components/SynergyPreAnalysisPanel";
import { CardSearchPanel } from "./components/CardSearchPanel";
import { DeckPanel } from "./components/DeckPanel";
import { RightPanel } from "./components/RightPanel";
import { CardDetailDrawer } from "./components/CardDetailDrawer";
import { Header } from "./components/Header";
import { DatabaseStatusBar } from "./components/DatabaseStatusBar";
import { DeckImportPanel } from "./components/DeckImportPanel";
import { DeckComparePanel } from "./components/DeckComparePanel";
import { DeckListPanel } from "./components/DeckListPanel";
import { useDBStatus } from "./hooks/useDBStatus";
import { useKeyboardShortcuts } from "./hooks/useKeyboardShortcuts";
import { usePWAInstall } from "./hooks/usePWAInstall";
import { useDeckStore } from "./store/deckStore";
import { decodeShareableLink } from "./lib/deckExporter";
import type { CardRecord } from "./lib/types";
import type { DeckImportResult } from "./lib/deckParser";

export type AppView = "builder" | "compare" | "import";
export type ImportMode = "db" | "deck";

const MOBILE_PANELS = ["Search", "Deck", "Analysis"] as const;

// ── Keyboard cheatsheet modal ──────────────────────────────────────────────────

const SHORTCUTS = [
  { key: "?",       desc: "Show / hide this cheatsheet" },
  { key: "S",       desc: "Focus card search" },
  { key: "N",       desc: "New deck" },
  { key: "Ctrl+S",  desc: "Save current deck" },
  { key: "B",       desc: "Builder view" },
  { key: "C",       desc: "Compare view" },
  { key: "I",       desc: "Import view" },
  { key: "[ / ]",   desc: "Prev / next mobile panel" },
  { key: "Esc",     desc: "Close overlays" },
] as const;

function ShortcutModal({ onClose }: { onClose: () => void }) {
  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 backdrop-blur-sm"
      onClick={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Keyboard shortcuts"
    >
      <div
        className="w-80 rounded-xl border border-zinc-700 bg-zinc-900 p-5 shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="mb-4 flex items-center justify-between">
          <h2 className="text-sm font-semibold text-zinc-100">Keyboard Shortcuts</h2>
          <button onClick={onClose} className="text-zinc-500 hover:text-zinc-200" aria-label="Close">
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>
        <ul className="space-y-2">
          {SHORTCUTS.map(s => (
            <li key={s.key} className="flex items-center justify-between gap-4">
              <kbd className="rounded bg-zinc-800 px-2 py-0.5 font-mono text-xs text-zinc-300 border border-zinc-700">
                {s.key}
              </kbd>
              <span className="text-xs text-zinc-400 text-right">{s.desc}</span>
            </li>
          ))}
        </ul>
        <p className="mt-4 text-xs text-zinc-600">Double-click a deck name to rename it inline.</p>
      </div>
    </div>
  );
}

// ── PWA install banner ────────────────────────────────────────────────────────

function InstallBanner({
  isIOS,
  onInstall,
  onDismiss,
}: {
  isIOS: boolean;
  onInstall: () => void;
  onDismiss: () => void;
}) {
  return (
    <div
      className="shrink-0 flex items-center justify-between gap-3 border-b border-zinc-800 bg-zinc-900 px-4 py-2 text-xs"
      role="region"
      aria-label="Install app"
    >
      <div className="flex items-center gap-2 text-zinc-400">
        <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4 shrink-0 text-teal-400" aria-hidden="true">
          {isIOS
            ? <path d="M12 2v13m0 0-3-3m3 3 3-3M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
            : <><path d="M12 16V4" /><path d="m8 12 4 4 4-4" /><path d="M2 20h20" /></>}
        </svg>
        {isIOS ? (
          <span>
            Install: tap{" "}
            <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="inline h-3.5 w-3.5 align-text-bottom" aria-hidden="true">
              <path d="M12 2v13m0 0-3-3m3 3 3-3M5 17v2a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2v-2" />
            </svg>
            {" "}then <strong className="text-zinc-200">Add to Home Screen</strong>
          </span>
        ) : (
          <span>Install app for offline use</span>
        )}
      </div>
      <div className="flex shrink-0 items-center gap-2">
        {!isIOS && (
          <button
            onClick={onInstall}
            className="rounded bg-teal-700 px-2.5 py-1 text-xs font-medium text-white hover:bg-teal-600 transition-colors"
          >
            Install
          </button>
        )}
        <button
          onClick={onDismiss}
          className="text-zinc-600 hover:text-zinc-300 transition-colors"
          aria-label="Dismiss install prompt"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
            <path d="M18 6 6 18M6 6l12 12" />
          </svg>
        </button>
      </div>
    </div>
  );
}

// ── App ───────────────────────────────────────────────────────────────────────

export default function App() {
  const [view, setView]               = useState<AppView>("builder");
  const [importMode, setImportMode]   = useState<ImportMode>("db");
  const [detailCard, setDetailCard]   = useState<CardRecord | null>(null);
  const [swUpdateReady, setSwUpdateReady] = useState(false);
  const [mobilePanelIdx, setMobilePanelIdx] = useState(0);
  const [deckListOpen, setDeckListOpen]     = useState(false);
  const [cheatsheetOpen, setCheatsheetOpen] = useState(false);
  const [leftTab, setLeftTab]               = useState<"search" | "synergy">("search");

  const { isReady, refresh } = useDBStatus();
  const activeDeckId         = useDeckStore(s => s.activeDeckId);
  const loadFromSnapshot     = useDeckStore(s => s.loadFromSnapshot);
  const addCard              = useDeckStore(s => s.addCard);
  const newDeck              = useDeckStore(s => s.newDeck);
  const saveCurrentDeck      = useDeckStore(s => s.saveCurrentDeck);

  const { isInstallable, isIOS, installPrompt, dismiss: dismissInstall } = usePWAInstall();
  const showInstallBanner = isInstallable || isIOS;

  const handlersRef = useRef({
    onToggleCheatsheet: () => setCheatsheetOpen(o => !o),
    onViewChange: (v: AppView) => { setView(v); setMobilePanelIdx(0); },
    onNewDeck: () => newDeck(),
    onSaveDeck: () => saveCurrentDeck(),
    onEscape: () => {
      if (cheatsheetOpen) { setCheatsheetOpen(false); return; }
      if (detailCard)     { setDetailCard(null); return; }
      if (deckListOpen)   { setDeckListOpen(false); return; }
    },
    onPrevPanel: () => setMobilePanelIdx(i => (i - 1 + MOBILE_PANELS.length) % MOBILE_PANELS.length),
    onNextPanel: () => setMobilePanelIdx(i => (i + 1) % MOBILE_PANELS.length),
    mobilePanelCount: MOBILE_PANELS.length,
  });

  useEffect(() => {
    handlersRef.current.onEscape = () => {
      if (cheatsheetOpen) { setCheatsheetOpen(false); return; }
      if (detailCard)     { setDetailCard(null); return; }
      if (deckListOpen)   { setDeckListOpen(false); return; }
    };
  }, [cheatsheetOpen, detailCard, deckListOpen]);

  const stableHandlers = useCallback(() => handlersRef.current, [])();
  useKeyboardShortcuts(stableHandlers);

  useEffect(() => {
    const decoded = decodeShareableLink(window.location.hash);
    if (decoded) loadFromSnapshot(decoded);
  }, []);

  useEffect(() => {
    const handler = () => setSwUpdateReady(true);
    window.addEventListener("sw-update-ready", handler);
    return () => window.removeEventListener("sw-update-ready", handler);
  }, []);

  const handleDeckImported = (result: DeckImportResult) => {
    useDeckStore.getState().clearDeck();
    for (const { card, quantity, board } of result.resolved) {
      for (let i = 0; i < quantity; i++) addCard(card, board);
    }
    setView("builder");
  };

  return (
    <div className="flex h-[100dvh] flex-col overflow-hidden bg-zinc-950 text-zinc-100">
      {/* Skip to main content — first focusable element */}
      <a
        href="#main-content"
        className="sr-only focus:not-sr-only focus:absolute focus:top-2 focus:left-2 focus:z-[100] focus:rounded focus:bg-teal-600 focus:px-3 focus:py-1.5 focus:text-xs focus:text-white"
      >
        Skip to main content
      </a>

      <Header view={view} onViewChange={v => { setView(v); setMobilePanelIdx(0); }} />
      <DatabaseStatusBar onRequestImport={() => { setView("import"); setImportMode("db"); }} />

      {showInstallBanner && (
        <InstallBanner
          isIOS={isIOS}
          onInstall={installPrompt}
          onDismiss={dismissInstall}
        />
      )}

      {swUpdateReady && (
        <div
          className="shrink-0 flex items-center justify-between gap-3 bg-teal-900/60 border-b border-teal-700 px-4 py-2 text-sm"
          role="alert"
        >
          <span className="text-teal-200">A new version is available.</span>
          <button onClick={() => window.location.reload()} className="rounded-md bg-teal-600 px-3 py-1 text-xs font-medium hover:bg-teal-500">
            Reload
          </button>
        </div>
      )}

      {view === "import" ? (
        <main id="main-content" className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="w-full max-w-2xl space-y-4">
            <div className="flex gap-2" role="group" aria-label="Import mode">
              {(["db", "deck"] as ImportMode[]).map((m) => (
                <button key={m} onClick={() => setImportMode(m)}
                  aria-pressed={importMode === m}
                  className={`rounded-lg px-4 py-2 text-sm font-medium transition-colors ${
                    importMode === m ? "bg-teal-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
                  }`}
                >
                  {m === "db" ? "Load Card Database" : "Import Deck"}
                </button>
              ))}
            </div>
            {importMode === "db"
              ? <BulkImporter onImportDone={() => { refresh(); setView("builder"); }} />
              : <DeckImportPanel onImported={handleDeckImported} />}
          </div>
        </main>

      ) : view === "compare" ? (
        <main id="main-content" className="flex flex-1 overflow-hidden">
          <DeckComparePanel />
        </main>

      ) : !isReady ? (
        <main id="main-content" className="flex flex-1 items-start justify-center overflow-y-auto p-4 sm:p-8">
          <div className="w-full max-w-2xl space-y-4">
            <div className="rounded-xl border border-zinc-800 bg-zinc-900/60 p-4 text-sm text-zinc-300">
              No card database found. Click <strong className="text-teal-300">Download from Scryfall</strong> to fetch <code>oracle_cards.json</code> directly, or choose a local copy you've already downloaded.
            </div>
            <BulkImporter onImportDone={() => { refresh(); }} />
          </div>
        </main>

      ) : (
        <>
          {/* Mobile panel switcher */}
          <div className="flex shrink-0 border-b border-zinc-800 md:hidden">
            <button
              onClick={() => setDeckListOpen(o => !o)}
              className="px-3 py-2 text-xs text-zinc-500 hover:text-zinc-200 border-r border-zinc-800"
              aria-label="My decks"
              aria-expanded={deckListOpen}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-4 w-4" aria-hidden="true">
                <path d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10" />
              </svg>
            </button>
            <div role="tablist" aria-label="Mobile panels" className="flex flex-1">
              {MOBILE_PANELS.map((label, i) => (
                <button
                  key={label}
                  role="tab"
                  aria-selected={mobilePanelIdx === i}
                  aria-controls={`mobile-panel-${i}`}
                  onClick={() => setMobilePanelIdx(i)}
                  className={`flex-1 py-2 text-xs font-medium transition-colors ${
                    mobilePanelIdx === i
                      ? "border-b-2 border-teal-500 text-teal-300"
                      : "text-zinc-500 hover:text-zinc-300"
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>

          <main id="main-content" className="flex flex-1 overflow-hidden">
            {deckListOpen && (
              <DeckListPanel onClose={() => setDeckListOpen(false)} />
            )}

            {/* Desktop 3-column */}
            <div
              className={`hidden md:grid h-full flex-1 ${ deckListOpen ? "" : "w-full" }`}
              style={{ gridTemplateColumns: "35% 40% 25%" }}
            >
              <section aria-label="Card search" className="flex flex-col overflow-hidden border-r border-zinc-800">
                <div className="flex shrink-0 items-center gap-2 border-b border-zinc-800 px-3 py-2">
                  <button
                    onClick={() => setDeckListOpen(o => !o)}
                    aria-expanded={deckListOpen}
                    aria-label="Toggle deck list"
                    className={`flex items-center gap-1.5 rounded px-2 py-1 text-xs transition-colors ${
                      deckListOpen ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-200"
                    }`}
                  >
                    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" className="h-3.5 w-3.5" aria-hidden="true">
                      <path d="M19 11H5m14 0a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2m14 0V9a2 2 0 0 0-2-2M5 11V9a2 2 0 0 1 2-2m0 0V5a2 2 0 0 1 2-2h6a2 2 0 0 1 2 2v2M7 7h10" />
                    </svg>
                    My Decks
                  </button>
                  {/* Search / Synergy tab toggle */}
                  <div role="tablist" aria-label="Left panel view" className="flex flex-1 justify-center">
                    <div className="flex rounded-md border border-zinc-700 overflow-hidden">
                      <button
                        role="tab"
                        aria-selected={leftTab === "search"}
                        onClick={() => setLeftTab("search")}
                        className={`px-2.5 py-0.5 text-xs font-medium transition-colors ${leftTab === "search" ? "bg-zinc-700 text-zinc-100" : "text-zinc-500 hover:text-zinc-300"}`}
                      >
                        Search
                      </button>
                      <button
                        role="tab"
                        aria-selected={leftTab === "synergy"}
                        onClick={() => setLeftTab("synergy")}
                        className={`px-2.5 py-0.5 text-xs font-medium border-l border-zinc-700 transition-colors ${leftTab === "synergy" ? "bg-teal-900/70 text-teal-200" : "text-zinc-500 hover:text-zinc-300"}`}
                      >
                        Synergy
                      </button>
                    </div>
                  </div>
                  <button
                    onClick={() => setCheatsheetOpen(o => !o)}
                    className="rounded px-1.5 py-0.5 text-xs text-zinc-600 hover:text-zinc-400 transition-colors"
                    aria-label="Keyboard shortcuts"
                    title="Keyboard shortcuts (?)"
                  >
                    ?
                  </button>
                </div>
                {leftTab === "search"
                  ? <CardSearchPanel onCardClick={setDetailCard} />
                  : <div className="flex-1 overflow-y-auto p-3"><SynergyPreAnalysisPanel onCardClick={setDetailCard} /></div>}
              </section>

              <section aria-label="Deck editor" className="flex flex-col overflow-hidden border-r border-zinc-800">
                <DeckPanel onCardClick={setDetailCard} />
              </section>

              <section aria-label="Analysis" className="flex flex-col overflow-hidden">
                <RightPanel activeDeckId={activeDeckId} />
              </section>
            </div>

            {/* Mobile single-panel */}
            <div className="flex flex-col h-full overflow-hidden md:hidden flex-1">
              {mobilePanelIdx === 0 && (
                <section id="mobile-panel-0" role="tabpanel" aria-label="Card search" className="flex flex-col h-full">
                  <div role="tablist" className="flex shrink-0 border-b border-zinc-800 bg-zinc-950">
                    <button
                      role="tab"
                      aria-selected={leftTab === "search"}
                      onClick={() => setLeftTab("search")}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${leftTab === "search" ? "border-b-2 border-teal-500 text-teal-300" : "text-zinc-500 hover:text-zinc-300"}`}
                    >
                      Search
                    </button>
                    <button
                      role="tab"
                      aria-selected={leftTab === "synergy"}
                      onClick={() => setLeftTab("synergy")}
                      className={`flex-1 py-1.5 text-xs font-medium transition-colors ${leftTab === "synergy" ? "border-b-2 border-teal-500 text-teal-300" : "text-zinc-500 hover:text-zinc-300"}`}
                    >
                      Synergy
                    </button>
                  </div>
                  {leftTab === "search"
                    ? <CardSearchPanel onCardClick={setDetailCard} />
                    : <div className="flex-1 overflow-y-auto p-3"><SynergyPreAnalysisPanel onCardClick={setDetailCard} /></div>}
                </section>
              )}
              {mobilePanelIdx === 1 && (
                <section id="mobile-panel-1" role="tabpanel" aria-label="Deck editor" className="flex flex-col h-full">
                  <DeckPanel onCardClick={setDetailCard} />
                </section>
              )}
              {mobilePanelIdx === 2 && (
                <section id="mobile-panel-2" role="tabpanel" aria-label="Analysis" className="flex flex-col h-full">
                  <RightPanel activeDeckId={activeDeckId} />
                </section>
              )}
            </div>
          </main>
        </>
      )}

      {detailCard && (
        <CardDetailDrawer card={detailCard} onClose={() => setDetailCard(null)} />
      )}

      {cheatsheetOpen && (
        <ShortcutModal onClose={() => setCheatsheetOpen(false)} />
      )}
    </div>
  );
}
