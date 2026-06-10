import { useState } from "react";
import { exportArena, exportCSV, exportJSON, exportMTGO, exportShareableLink } from "../lib/deckExporter";
import type { ExportDeck } from "../lib/deckExporter";

interface Props {
  deck: ExportDeck;
}

export function DeckExportPanel({ deck }: Props) {
  const [copied, setCopied] = useState<string | null>(null);

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

  const safeName = deck.name.replace(/[^a-z0-9]/gi, "_").toLowerCase();

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 space-y-3">
      <h2 className="text-lg font-semibold">Export Deck</h2>

      <div className="grid grid-cols-2 gap-2">
        <button onClick={() => download(`${safeName}.txt`, exportMTGO(deck))}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">MTGO Text</span>
          <span className="text-xs text-zinc-500">.txt download</span>
        </button>

        <button onClick={() => copy("arena", exportArena(deck))}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">{copied === "arena" ? "Copied!" : "Arena Format"}</span>
          <span className="text-xs text-zinc-500">Copy to clipboard</span>
        </button>

        <button onClick={() => download(`${safeName}.json`, exportJSON(deck), "application/json")}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">JSON Export</span>
          <span className="text-xs text-zinc-500">.json download</span>
        </button>

        <button onClick={() => download(`${safeName}.csv`, exportCSV(deck), "text/csv")}
          className="rounded-lg bg-zinc-800 px-3 py-2 text-sm hover:bg-zinc-700 text-left">
          <span className="block font-medium">CSV Export</span>
          <span className="text-xs text-zinc-500">.csv download</span>
        </button>

        <button onClick={() => copy("link", exportShareableLink(deck))}
          className="col-span-2 rounded-lg bg-teal-800/50 border border-teal-700 px-3 py-2 text-sm hover:bg-teal-700/50 text-left">
          <span className="block font-medium">{copied === "link" ? "Link copied!" : "Share Link"}</span>
          <span className="text-xs text-teal-400">Base64-encoded URL, no server needed</span>
        </button>
      </div>
    </div>
  );
}
