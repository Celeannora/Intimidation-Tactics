import { useEffect, useState } from "react";
import { exportArena, exportCSV, exportJSON, exportMTGO, exportShareableLink } from "../lib/deckExporter";
import type { ExportDeck } from "../lib/deckExporter";

interface Props {
  deck: ExportDeck;
}

/** Derive a reasonable fallback name from deck entries when the stored name is blank. */
function autoName(deck: ExportDeck): string {
  if (deck.name && deck.name.trim()) return deck.name.trim();
  // Gather color identity from mainboard cards
  const main = deck.mainboard;
  const colorSymbols = new Set<string>();
  for (const { card } of main) {
    const ci: string[] = card.colorIdentityJson ? JSON.parse(card.colorIdentityJson) : [];
    for (const c of ci) colorSymbols.add(c);
  }
  const colors = ["W", "U", "B", "R", "G"].filter((c) => colorSymbols.has(c)).join("") || "C";
  // Rough archetype hint from creature ratio
  const creatures = main.filter(({ card }) => card.typeLine?.includes("Creature")).reduce((s, e) => s + e.quantity, 0);
  const total = main.reduce((s, e) => s + e.quantity, 0);
  const hint = total === 0 ? "Deck" : creatures / total >= 0.5 ? "Aggro" : "Control";
  return `${colors} ${hint}`;
}

export function DeckExportPanel({ deck }: Props) {
  const [copied, setCopied] = useState<string | null>(null);
  const [deckName, setDeckName] = useState(() => autoName(deck));

  // Re-sync when the deck prop changes (e.g. after a new generation)
  useEffect(() => { setDeckName(autoName(deck)); }, [deck]);

  const copy = async (label: string, text: string) => {
    await navigator.clipboard.writeText(text);
    setCopied(label);
    setTimeout(() => setCopied(null), 2000);
  };

  const download = (filename: string, content: string, mime = "text/plain") => {
    const blob = new Blob([content], { type: mime });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = filename;
    a.click();
    URL.revokeObjectURL(a.href);
  };

  // Use the (possibly user-edited) local name for filenames
  const safeName = (deckName || "deck").replace(/[^a-z0-9]/gi, "_").toLowerCase();
  // Provide a named copy of the deck for export functions
  const namedDeck: ExportDeck = { ...deck, name: deckName || "Deck" };

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 space-y-3">
      <h2 className="text-lg font-semibold">Export Deck</h2>

      {/* Editable deck name */}
      <div>
        <label className="mb-1 block text-xs font-medium text-zinc-400">Deck name</label>
        <input
          type="text"
          value={deckName}
          onChange={(e) => setDeckName(e.target.value)}
          placeholder="My Deck"
          className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs text-zinc-100 placeholder:text-zinc-600 focus:border-teal-500 focus:outline-none"
        />
        <p className="mt-0.5 text-[11px] text-zinc-600">Used as the filename for downloads.</p>
      </div>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => download(`${safeName}.txt`, exportMTGO(namedDeck))}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">MTGO Text</span>
          <span className="text-xs text-zinc-500">.txt download</span>
        </button>

        <button onClick={() => copy("arena", exportArena(namedDeck))}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">{copied === "arena" ? "Copied!" : "Arena Format"}</span>
          <span className="text-xs text-zinc-500">Copy to clipboard</span>
        </button>

        <button onClick={() => download(`${safeName}.json`, exportJSON(namedDeck), "application/json")}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">JSON Export</span>
          <span className="text-xs text-zinc-500">.json download</span>
        </button>

        <button onClick={() => download(`${safeName}.csv`, exportCSV(namedDeck), "text/csv")}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">CSV Export</span>
          <span className="text-xs text-zinc-500">.csv download</span>
        </button>

        <button onClick={() => copy("link", exportShareableLink(namedDeck))}
          className="col-span-2 rounded-lg bg-teal-800/50 border border-teal-700 px-3 py-2 text-sm hover:bg-teal-700/50 text-left">
          <span className="block font-medium">{copied === "link" ? "Link copied!" : "Share Link"}</span>
          <span className="text-xs text-teal-400">Base64-encoded URL, no server needed</span>
        </button>
      </div>
    </div>
  );
}
