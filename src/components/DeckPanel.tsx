import { useState } from "react";
import { useDeckStore } from "../store/deckStore";
import type { DeckEntry } from "../lib/legality";
import { parseDecklistText, resolveDeckEntries } from "../lib/deckParser";
import { getFormatRules } from "../lib/formats";
import { suggestCuts, type SuggestCutsResult } from "../lib/generator/suggestCuts";

type Board = "main" | "side";
type DeckSection = "Creatures" | "Planeswalkers" | "Noncreature Spells" | "Lands";

const SECTION_ORDER: Record<DeckSection, number> = {
  Creatures: 0,
  Planeswalkers: 1,
  "Noncreature Spells": 2,
  Lands: 3,
};

function deckSection(entry: DeckEntry): DeckSection {
  if (entry.card.typeLine.includes("Land")) return "Lands";
  if (entry.card.typeLine.includes("Creature")) return "Creatures";
  if (entry.card.typeLine.includes("Planeswalker")) return "Planeswalkers";
  return "Noncreature Spells";
}

function DeckEntryTile({
  entry,
  pinned,
  canPin,
  onIncrement,
  onDecrement,
  onRemove,
  onMove,
  onTogglePin,
  onCardClick,
}: {
  entry: DeckEntry;
  pinned: boolean;
  canPin: boolean;
  onIncrement: () => void;
  onDecrement: () => void;
  onRemove: () => void;
  onMove: () => void;
  onTogglePin: () => void;
  onCardClick?: (card: DeckEntry["card"]) => void;
}) {
  const manaValue = entry.card.cmc || "";

  return (
    <article className={`group relative overflow-hidden rounded-xl border bg-zinc-950 shadow-sm transition hover:shadow-teal-950/40 ${pinned ? "border-amber-500/80 ring-1 ring-amber-500/40" : "border-zinc-800 hover:border-teal-600/70"}`}>
      <button
        className="block w-full text-left"
        onClick={() => onCardClick?.(entry.card)}
        title={entry.card.name}
      >
        {entry.card.imageNormal ? (
          <img
            src={entry.card.imageNormal}
            alt={entry.card.name}
            loading="lazy"
            className="aspect-[488/680] w-full bg-zinc-900 object-cover"
          />
        ) : (
          <div className="flex aspect-[488/680] w-full flex-col justify-between bg-gradient-to-br from-zinc-800 to-zinc-950 p-2">
            <div className="text-[10px] uppercase tracking-wide text-zinc-500">
              No image
            </div>
            <div>
              <div className="line-clamp-3 text-xs font-semibold text-zinc-100">
                {entry.card.name}
              </div>
              <div className="mt-1 line-clamp-2 text-[10px] text-zinc-500">
                {entry.card.typeLine}
              </div>
            </div>
          </div>
        )}
      </button>

      <div className="pointer-events-none absolute left-1.5 top-1.5 flex items-center gap-1">
        <span className="rounded-full bg-teal-500 px-2 py-0.5 text-xs font-bold text-white shadow">
          ×{entry.quantity}
        </span>
        {pinned && (
          <span className="rounded-full bg-amber-500 px-1.5 py-0.5 text-[10px] font-bold text-amber-950 shadow" title="Pinned — locked from optimizer swaps">
            📌
          </span>
        )}
      </div>

      <div className="absolute right-1.5 top-1.5 flex gap-1 opacity-100 sm:opacity-0 sm:transition-opacity sm:group-hover:opacity-100">
        {canPin && (
          <button
            onClick={onTogglePin}
            className={`h-6 w-6 rounded-full text-xs shadow ${pinned ? "bg-amber-500 text-amber-950 hover:bg-amber-400" : "bg-zinc-950/85 text-zinc-300 hover:bg-zinc-700 hover:text-amber-300"}`}
            title={pinned ? "Unpin (allow optimizer to swap this card)" : "Pin (lock this card from optimizer swaps)"}
            aria-label={pinned ? "Unpin card" : "Pin card"}
          >
            📌
          </button>
        )}
        <button
          onClick={onDecrement}
          className="h-6 w-6 rounded-full bg-zinc-950/85 text-sm text-zinc-300 shadow hover:bg-zinc-700 hover:text-zinc-100"
          aria-label="Decrease quantity"
        >
          −
        </button>
        <button
          onClick={onIncrement}
          className="h-6 w-6 rounded-full bg-zinc-950/85 text-sm text-zinc-300 shadow hover:bg-zinc-700 hover:text-zinc-100"
          aria-label="Increase quantity"
        >
          +
        </button>
      </div>

      <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-zinc-950 via-zinc-950/85 to-transparent p-2 pt-8">
        <button
          className="line-clamp-2 w-full text-left text-[11px] font-semibold leading-tight text-zinc-100 hover:text-teal-300"
          onClick={() => onCardClick?.(entry.card)}
        >
          {entry.card.name}
        </button>
        <div className="mt-1 flex items-center justify-between gap-1 text-[10px] text-zinc-400">
          <span>{manaValue !== "" ? `MV ${manaValue}` : "Land"}</span>
          <div className="flex items-center gap-1">
            <button
              onClick={onMove}
              className="rounded bg-zinc-900/90 px-1.5 py-0.5 text-zinc-400 hover:text-teal-300"
              title={`Move to ${entry.board === "main" ? "sideboard" : "main deck"}`}
            >
              ⇄
            </button>
            <button
              onClick={onRemove}
              className="rounded bg-zinc-900/90 px-1.5 py-0.5 text-zinc-400 hover:text-red-300"
              aria-label={`Remove ${entry.card.name}`}
            >
              ✕
            </button>
          </div>
        </div>
      </div>
    </article>
  );
}

export function DeckPanel({ onCardClick }: { onCardClick?: (card: DeckEntry["card"]) => void }) {
  const { deckName, setDeckName, entries, validation, removeCard, setQuantity, moveCard, clearDeck, addCard } =
    useDeckStore();
  const pins = useDeckStore((s) => s.pins);
  const pinCard = useDeckStore((s) => s.pinCard);
  const unpinCard = useDeckStore((s) => s.unpinCard);
  const [activeBoard, setActiveBoard] = useState<Board>("main");
  const [copyStatus, setCopyStatus] = useState<"idle" | "copied" | "failed">("idle");
  const [importOpen, setImportOpen] = useState(false);
  const [importText, setImportText] = useState("");
  const [importBusy, setImportBusy] = useState(false);
  const [importStatus, setImportStatus] = useState<string | null>(null);
  const [cutsModal, setCutsModal] = useState<{ card: DeckEntry["card"]; result: SuggestCutsResult } | null>(null);

  const formatRules = getFormatRules("standard");
  const mainTotal = entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0);

  const togglePin = (entry: DeckEntry) => {
    if (entry.board !== "main") return;
    if (entry.card.oracleId in pins) {
      unpinCard(entry.card.oracleId);
      return;
    }
    // Pinning into a full (or over-target) deck: surface suggested cuts rather
    // than silently swapping. The pin itself is applied immediately; the modal
    // recommends which non-pinned cards to trim to stay at the target size.
    pinCard(entry.card.oracleId);
    if (mainTotal >= formatRules.defaultMainboardSize) {
      const newlyPinned: DeckEntry[] = [{ card: entry.card, quantity: entry.quantity, board: "main" }];
      const result = suggestCuts(entries, newlyPinned, 1, { engine: "offline", archetype: "Midrange", colors: [] });
      if (result.candidates.length > 0) setCutsModal({ card: entry.card, result });
    }
  };

  const runImport = async (replace: boolean) => {
    if (!importText.trim()) {
      setImportStatus("Paste a decklist first.");
      return;
    }
    setImportBusy(true);
    setImportStatus(null);
    try {
      const parsed = parseDecklistText(importText);
      const result = await resolveDeckEntries([...parsed.mainboard, ...parsed.sideboard]);
      if (replace) clearDeck();
      let added = 0;
      for (const entry of result.resolved) {
        for (let i = 0; i < entry.quantity; i++) {
          addCard(entry.card, entry.board);
          added++;
        }
      }
      const unmatched = [...parsed.unmatched, ...result.unmatched];
      setImportStatus(
        `Imported ${added} card${added === 1 ? "" : "s"}` +
          (unmatched.length ? ` · ${unmatched.length} unmatched: ${unmatched.slice(0, 5).join(", ")}${unmatched.length > 5 ? "…" : ""}` : "")
      );
      if (unmatched.length === 0) {
        setImportText("");
        setImportOpen(false);
      }
    } catch (e) {
      setImportStatus(`Import failed: ${e instanceof Error ? e.message : String(e)}`);
    } finally {
      setImportBusy(false);
    }
  };

  const boardEntries = entries
    .filter((e) => e.board === activeBoard)
    .sort((a, b) => {
      const sectionDiff = SECTION_ORDER[deckSection(a)] - SECTION_ORDER[deckSection(b)];
      if (sectionDiff !== 0) return sectionDiff;
      return a.card.cmc - b.card.cmc || a.card.name.localeCompare(b.card.name);
    });

  const groupedEntries = boardEntries.reduce<Record<DeckSection, DeckEntry[]>>(
    (groups, entry) => {
      groups[deckSection(entry)].push(entry);
      return groups;
    },
    { Creatures: [], Planeswalkers: [], "Noncreature Spells": [], Lands: [] }
  );

  const mainCount = entries
    .filter((e) => e.board === "main")
    .reduce((s, e) => s + e.quantity, 0);
  const sideCount = entries
    .filter((e) => e.board === "side")
    .reduce((s, e) => s + e.quantity, 0);

  // Map rule → severity for inline banners
  const errorRules = new Set(["MIN_60", "MAX_COPIES", "NOT_LEGAL", "BANNED", "SIDE_SIZE"]);
  const inlineViolations = validation.violations.slice(0, 3);

  const decklistText = () => {
    const main = entries.filter((e) => e.board === "main");
    const side = entries.filter((e) => e.board === "side");
    let text = main.map((e) => `${e.quantity} ${e.card.name}`).join("\n");
    if (side.length)
      text += "\n\n// Sideboard\n" + side.map((e) => `${e.quantity} ${e.card.name}`).join("\n");
    return text;
  };

  const exportDecklist = () => {
    const text = decklistText();
    const blob = new Blob([text], { type: "text/plain" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `${deckName.replace(/\s+/g, "-")}.txt`;
    a.click();
  };

  const copyDecklist = async () => {
    const text = decklistText();
    try {
      if (navigator.clipboard?.writeText) {
        await navigator.clipboard.writeText(text);
      } else {
        const textarea = document.createElement("textarea");
        textarea.value = text;
        textarea.style.position = "fixed";
        textarea.style.opacity = "0";
        document.body.appendChild(textarea);
        textarea.focus();
        textarea.select();
        document.execCommand("copy");
        document.body.removeChild(textarea);
      }
      setCopyStatus("copied");
      window.setTimeout(() => setCopyStatus("idle"), 1600);
    } catch {
      setCopyStatus("failed");
      window.setTimeout(() => setCopyStatus("idle"), 2200);
    }
  };

  return (
    <div className="flex h-full flex-col gap-3 p-3">
      {/* Header */}
      <div className="flex items-center gap-2">
        <input
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          className="flex-1 rounded border border-zinc-700 bg-transparent px-2 py-1 text-sm font-semibold text-zinc-100 focus:outline-none focus:border-teal-500"
          aria-label="Deck name"
        />
        <button
          onClick={() => { setImportOpen(true); setImportStatus(null); }}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          title="Import decklist (paste MTGO/Arena format)"
        >
          Import
        </button>
        <button
          onClick={exportDecklist}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          title="Export decklist"
        >
          Export
        </button>
        <button
          onClick={copyDecklist}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-700"
          title="Copy decklist to clipboard"
        >
          {copyStatus === "copied" ? "Copied" : copyStatus === "failed" ? "Copy failed" : "Copy"}
        </button>
        <button
          onClick={clearDeck}
          className="rounded bg-zinc-800 px-2 py-1 text-xs text-zinc-400 hover:bg-red-900 hover:text-red-200"
          title="Clear deck"
        >
          Clear
        </button>
      </div>

      {/* Board tabs */}
      <div className="flex gap-1">
        {(["main", "side"] as Board[]).map((b) => (
          <button
            key={b}
            onClick={() => setActiveBoard(b)}
            className={`rounded-full px-3 py-0.5 text-xs font-medium capitalize transition-colors ${
              activeBoard === b
                ? "bg-teal-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:bg-zinc-700"
            }`}
          >
            {b === "main" ? `Main (${mainCount})` : `Side (${sideCount})`}
          </button>
        ))}
      </div>

      {/* Inline validation banners (top 3) */}
      {inlineViolations.length > 0 && (
        <div className="space-y-1">
          {inlineViolations.map((v) => (
            <div
              key={v.rule}
              className={`rounded px-2 py-1 text-xs ${
                errorRules.has(v.rule)
                  ? "bg-red-950/40 text-red-300"
                  : "bg-amber-950/40 text-amber-300"
              }`}
            >
              {v.message}
            </div>
          ))}
        </div>
      )}

      {/* Card grid */}
      <div className="flex-1 overflow-y-auto space-y-4 pr-1">
        {boardEntries.length === 0 && (
          <div className="flex flex-col items-center py-10 text-zinc-600">
            <span className="text-3xl mb-2">🃏</span>
            <p className="text-xs">
              {activeBoard === "main" ? "Add cards from the search panel" : "No sideboard cards yet"}
            </p>
          </div>
        )}
        {(Object.keys(groupedEntries) as DeckSection[])
          .filter((section) => groupedEntries[section].length > 0)
          .map((section) => (
            <section key={section} className="space-y-2">
              <div className="flex items-center justify-between border-b border-zinc-800 pb-1">
                <h3 className="text-xs font-semibold uppercase tracking-wide text-zinc-400">
                  {section}
                </h3>
                <span className="text-[11px] text-zinc-600">
                  {groupedEntries[section].reduce((s, e) => s + e.quantity, 0)} cards
                </span>
              </div>
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6">
                {groupedEntries[section].map((entry) => (
                  <DeckEntryTile
                    key={`${entry.card.oracleId}-${entry.board}`}
                    entry={entry}
                    pinned={entry.card.oracleId in pins}
                    canPin={entry.board === "main" && !entry.card.typeLine.includes("Land")}
                    onCardClick={onCardClick}
                    onIncrement={() =>
                      setQuantity(entry.card.oracleId, entry.board, entry.quantity + 1)
                    }
                    onDecrement={() =>
                      setQuantity(entry.card.oracleId, entry.board, entry.quantity - 1)
                    }
                    onRemove={() => removeCard(entry.card.oracleId, entry.board)}
                    onMove={() =>
                      moveCard(
                        entry.card.oracleId,
                        entry.board,
                        entry.board === "main" ? "side" : "main"
                      )
                    }
                    onTogglePin={() => togglePin(entry)}
                  />
                ))}
              </div>
            </section>
          ))}
      </div>

      {importOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => !importBusy && setImportOpen(false)}
        >
          <div
            className="w-full max-w-2xl rounded-lg border border-zinc-700 bg-zinc-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-200">Import decklist</div>
              <button
                onClick={() => !importBusy && setImportOpen(false)}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                disabled={importBusy}
              >
                Close
              </button>
            </div>
            <p className="mb-2 text-[11px] text-zinc-500">
              Paste an MTGO or Arena decklist. Lines like <code className="text-zinc-300">4 Lightning Bolt</code> or <code className="text-zinc-300">4 Lightning Bolt (M21) 150</code> are supported. Use <code className="text-zinc-300">Sideboard</code> or <code className="text-zinc-300">// Sideboard</code> to mark the sideboard.
            </p>
            <textarea
              value={importText}
              onChange={(e) => setImportText(e.target.value)}
              spellCheck={false}
              rows={14}
              placeholder={"4 Lightning Bolt\n4 Monastery Swiftspear\n20 Mountain\n\n// Sideboard\n3 Smash to Smithereens"}
              className="w-full rounded border border-zinc-700 bg-zinc-900 p-2 font-mono text-xs text-zinc-200 focus:border-teal-500 focus:outline-none"
            />
            {importStatus && (
              <div className="mt-2 rounded border border-zinc-800 bg-zinc-900/60 p-2 text-[11px] text-zinc-300">
                {importStatus}
              </div>
            )}
            <div className="mt-3 flex justify-end gap-2">
              <button
                onClick={async () => {
                  try {
                    const text = await navigator.clipboard?.readText();
                    if (text) setImportText(text);
                  } catch {
                    setImportStatus("Clipboard read denied — paste manually.");
                  }
                }}
                disabled={importBusy}
                className="rounded border border-zinc-700 px-3 py-1.5 text-xs text-zinc-300 hover:bg-zinc-800 disabled:opacity-50"
              >
                Paste from clipboard
              </button>
              <button
                onClick={() => runImport(false)}
                disabled={importBusy}
                className="rounded border border-teal-700 bg-teal-600/10 px-3 py-1.5 text-xs text-teal-200 hover:bg-teal-600/20 disabled:opacity-50"
              >
                {importBusy ? "Importing…" : "Add to deck"}
              </button>
              <button
                onClick={() => runImport(true)}
                disabled={importBusy}
                className="rounded border border-red-800 bg-red-950/30 px-3 py-1.5 text-xs text-red-200 hover:bg-red-900/40 disabled:opacity-50"
              >
                {importBusy ? "Importing…" : "Replace deck"}
              </button>
            </div>
          </div>
        </div>
      )}

      {cutsModal && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setCutsModal(null)}
        >
          <div
            className="w-full max-w-lg rounded-lg border border-zinc-700 bg-zinc-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-2 flex items-center justify-between">
              <div className="text-sm font-medium text-amber-200">
                📌 Pinned {cutsModal.card.name}
              </div>
              <button
                onClick={() => setCutsModal(null)}
                className="rounded border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
              >
                Close
              </button>
            </div>
            <p className="mb-3 text-[11px] text-zinc-400">
              Your deck is at {mainTotal} cards. {cutsModal.card.name} is now locked from optimizer swaps.
              To stay at {formatRules.defaultMainboardSize}, consider trimming the weakest / most redundant
              non-pinned cards below. Nothing is removed automatically.
            </p>
            <div className="mb-3 space-y-1.5">
              {cutsModal.result.candidates.map((c) => (
                <div
                  key={c.card.oracleId}
                  className="flex items-center justify-between gap-2 rounded border border-zinc-800 bg-zinc-900/60 p-2"
                >
                  <div className="min-w-0">
                    <div className="truncate text-xs font-medium text-zinc-200">
                      {c.cut}× {c.card.name}
                    </div>
                    <div className="truncate text-[10px] text-zinc-500">{c.reason}</div>
                  </div>
                  <button
                    onClick={() => {
                      const remaining = entries.find(
                        (e) => e.card.oracleId === c.card.oracleId && e.board === "main"
                      );
                      if (remaining) {
                        setQuantity(c.card.oracleId, "main", Math.max(0, remaining.quantity - c.cut));
                      }
                      setCutsModal((m) =>
                        m
                          ? { ...m, result: { ...m.result, candidates: m.result.candidates.filter((x) => x.card.oracleId !== c.card.oracleId) } }
                          : null
                      );
                    }}
                    className="shrink-0 rounded border border-red-800 bg-red-950/30 px-2 py-1 text-[11px] text-red-200 hover:bg-red-900/40"
                  >
                    Cut
                  </button>
                </div>
              ))}
            </div>
            <div className="rounded border border-zinc-800 bg-zinc-900/40 p-2 text-[11px] text-zinc-400">
              Curve consistency delta if you apply these cuts:{" "}
              <span className={cutsModal.result.curveDelta <= 0 ? "text-teal-300" : "text-amber-300"}>
                {cutsModal.result.curveDelta <= 0 ? "improves" : "worsens"} by{" "}
                {Math.abs(cutsModal.result.curveDelta).toFixed(2)}
              </span>{" "}
              (curve deviation {cutsModal.result.curveBefore.toFixed(2)} →{" "}
              {cutsModal.result.curveAfter.toFixed(2)}; lower is better).
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
