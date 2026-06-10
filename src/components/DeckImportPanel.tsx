import { useState } from "react";
import { parseDecklistText, resolveDeckEntries } from "../lib/deckParser";
import { importFromMTGGoldfish, importFromMoxfield } from "../lib/deckImportSources";
import type { DeckImportResult } from "../lib/deckParser";

interface Props {
  onImported: (result: DeckImportResult) => void;
}

type ImportTab = "text" | "url" | "json";

export function DeckImportPanel({ onImported }: Props) {
  const [tab, setTab] = useState<ImportTab>("text");
  const [value, setValue] = useState("");
  const [result, setResult] = useState<DeckImportResult | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  const handleText = async () => {
    setError(null); setLoading(true);
    try {
      const parsed = parseDecklistText(value);
      const res = await resolveDeckEntries([...parsed.mainboard, ...parsed.sideboard]);
      setResult(res);
      onImported(res);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleURL = async () => {
    setError(null); setLoading(true);
    try {
      let res: DeckImportResult;
      if (value.includes("mtggoldfish")) res = await importFromMTGGoldfish(value);
      else if (value.includes("moxfield")) res = await importFromMoxfield(value);
      else throw new Error("Unsupported URL. Use MTGGoldfish or Moxfield.");
      setResult(res);
      onImported(res);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleJSON = async () => {
    setError(null); setLoading(true);
    try {
      const data = JSON.parse(value);
      const allEntries = [
        ...(data.mainboard ?? []).map((c: { quantity: number; name: string }) => ({ quantity: c.quantity, cardName: c.name, board: "main" as const })),
        ...(data.sideboard ?? []).map((c: { quantity: number; name: string }) => ({ quantity: c.quantity, cardName: c.name, board: "side" as const })),
      ];
      const res = await resolveDeckEntries(allEntries);
      setResult(res);
      onImported(res);
    } catch (e) { setError((e as Error).message); }
    finally { setLoading(false); }
  };

  const handleImport = () => {
    if (tab === "text") handleText();
    else if (tab === "url") handleURL();
    else handleJSON();
  };

  const tabs: ImportTab[] = ["text", "url", "json"];

  return (
    <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-5 text-zinc-100 space-y-4">
      <h2 className="text-lg font-semibold">Import Deck</h2>

      <div className="flex gap-2">
        {tabs.map((t) => (
          <button key={t} onClick={() => setTab(t)}
            className={`rounded-md px-3 py-1 text-sm font-medium transition-colors ${
              tab === t ? "bg-teal-600 text-white" : "bg-zinc-800 text-zinc-300 hover:bg-zinc-700"
            }`}>
            {t === "text" ? "Paste Text" : t === "url" ? "URL" : "JSON"}
          </button>
        ))}
      </div>

      <textarea
        className="w-full h-40 rounded-lg bg-zinc-900 p-3 text-sm font-mono text-zinc-200 placeholder-zinc-600 focus:outline-none focus:ring-1 focus:ring-teal-500"
        placeholder={
          tab === "text" ? "4 Lightning Bolt\n4 Monastery Swiftspear\n\nSideboard\n3 Rending Volley" :
          tab === "url" ? "https://www.mtggoldfish.com/deck/123456" :
          '{"mainboard":[{"quantity":4,"name":"Lightning Bolt"}]}'
        }
        value={value}
        onChange={(e) => setValue(e.target.value)}
      />

      <button onClick={handleImport} disabled={loading || !value.trim()}
        className="rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium hover:bg-teal-500 disabled:opacity-40">
        {loading ? "Importing…" : "Import"}
      </button>

      {error && <p className="text-sm text-red-400">{error}</p>}

      {result && (
        <div className="space-y-2">
          <p className="text-sm text-emerald-400">
            Resolved {result.resolved.length} card entries.
          </p>
          {result.unmatched.length > 0 && (
            <div className="rounded-lg border border-yellow-700 bg-yellow-950/30 p-3">
              <p className="text-xs font-semibold text-yellow-400 mb-1">Unmatched ({result.unmatched.length})</p>
              <ul className="text-xs text-yellow-300 space-y-0.5">
                {result.unmatched.map((u, i) => <li key={i}>{u}</li>)}
              </ul>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
