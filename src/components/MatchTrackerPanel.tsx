import { useEffect, useState } from "react";
import { useDeckStore } from "../store/deckStore";
import { db } from "../lib/db";
import type { MatchResult } from "../lib/db";

const RESULT_STYLES: Record<MatchResult["result"], string> = {
  win:  "bg-teal-900/50 text-teal-300 border-teal-800",
  loss: "bg-red-900/40  text-red-300  border-red-900",
  draw: "bg-zinc-800    text-zinc-300 border-zinc-700",
};

const RESULT_LABELS: Record<MatchResult["result"], string> = {
  win: "Win", loss: "Loss", draw: "Draw",
};

export function MatchTrackerPanel() {
  const activeDeckId    = useDeckStore(s => s.activeDeckId);
  const saveCurrentDeck = useDeckStore(s => s.saveCurrentDeck);
  const loadSavedDecks  = useDeckStore(s => s.loadSavedDecks);

  const [matches, setMatches]       = useState<MatchResult[]>([]);
  const [opponent, setOpponent]     = useState("");
  const [notes, setNotes]           = useState("");
  const [submitting, setSubmitting] = useState(false);

  const load = async () => {
    const rows = await db.matchResults
      .where("deckId").equals(activeDeckId)
      .reverse()
      .toArray();
    setMatches(rows);
  };

  useEffect(() => { load(); }, [activeDeckId]);

  const logMatch = async (result: MatchResult["result"]) => {
    if (submitting) return;
    setSubmitting(true);

    // Ensure deck exists in savedDecks before updating W/L/D.
    // If it was never saved, auto-save it now so the win-rate badge
    // in DeckListPanel is always kept in sync.
    let saved = await db.savedDecks.get(activeDeckId);
    if (!saved) {
      await saveCurrentDeck();
      saved = await db.savedDecks.get(activeDeckId);
    }

    await db.matchResults.add({
      deckId:   activeDeckId,
      opponent: opponent.trim() || "Unknown",
      result,
      notes:    notes.trim(),
      playedAt: Date.now(),
    });

    if (saved) {
      await db.savedDecks.update(activeDeckId, {
        wins:   saved.wins   + (result === "win"  ? 1 : 0),
        losses: saved.losses + (result === "loss" ? 1 : 0),
        draws:  saved.draws  + (result === "draw" ? 1 : 0),
      });
      // Refresh the savedDecks list in the store so DeckListPanel badges update
      await loadSavedDecks();
    }

    setOpponent("");
    setNotes("");
    setSubmitting(false);
    await load();
  };

  const handleDelete = async (id: number) => {
    await db.matchResults.delete(id);
    await load();
  };

  const wins   = matches.filter(m => m.result === "win").length;
  const losses = matches.filter(m => m.result === "loss").length;
  const draws  = matches.filter(m => m.result === "draw").length;
  const total  = matches.length;
  const wr     = total > 0 ? Math.round((wins / total) * 100) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* Record summary */}
      <div className="grid grid-cols-4 gap-2 text-center">
        {([
          { label: "W",  value: wins,   cls: "text-teal-400" },
          { label: "L",  value: losses, cls: "text-red-400" },
          { label: "D",  value: draws,  cls: "text-zinc-400" },
          { label: "WR", value: wr !== null ? `${wr}%` : "—", cls: "text-zinc-200" },
        ] as const).map(({ label, value, cls }) => (
          <div key={label} className="rounded-lg border border-zinc-800 bg-zinc-900 py-2">
            <p className={`text-base font-semibold ${cls}`}>{value}</p>
            <p className="text-xs text-zinc-600">{label}</p>
          </div>
        ))}
      </div>

      {/* Log form */}
      <div className="flex flex-col gap-2 rounded-lg border border-zinc-800 bg-zinc-900 p-3">
        <p className="text-xs font-medium text-zinc-400">Log a match</p>
        <input
          value={opponent}
          onChange={e => setOpponent(e.target.value)}
          placeholder="Opponent deck (e.g. Jeskai Control)"
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500"
        />
        <input
          value={notes}
          onChange={e => setNotes(e.target.value)}
          placeholder="Notes (optional)"
          className="rounded border border-zinc-700 bg-zinc-950 px-2 py-1.5 text-xs text-zinc-200 placeholder:text-zinc-600 focus:outline-none focus:border-teal-500"
        />
        <div className="flex gap-2">
          {(["win", "loss", "draw"] as const).map(r => (
            <button
              key={r}
              onClick={() => logMatch(r)}
              disabled={submitting}
              className={`flex-1 rounded border py-1.5 text-xs font-medium capitalize transition-colors disabled:opacity-50 ${
                RESULT_STYLES[r]
              } hover:opacity-80`}
            >
              {RESULT_LABELS[r]}
            </button>
          ))}
        </div>
      </div>

      {/* Match history */}
      {matches.length === 0 && (
        <p className="text-center text-xs text-zinc-600 py-4">No matches logged yet</p>
      )}
      <div className="space-y-1.5">
        {matches.map(m => (
          <div
            key={m.id}
            className={`flex items-start justify-between gap-2 rounded border px-2 py-1.5 ${
              RESULT_STYLES[m.result]
            }`}
          >
            <div className="min-w-0">
              <p className="text-xs font-medium truncate">
                <span className="uppercase tracking-wide text-xs opacity-70 mr-1">{m.result}</span>
                {m.opponent}
              </p>
              {m.notes && <p className="text-xs opacity-60 mt-0.5 truncate">{m.notes}</p>}
              <p className="text-xs opacity-40 mt-0.5">
                {new Date(m.playedAt).toLocaleDateString()}
              </p>
            </div>
            <button
              onClick={() => m.id !== undefined && handleDelete(m.id)}
              className="shrink-0 text-xs opacity-40 hover:opacity-80"
              aria-label="Delete match"
            >
              ✕
            </button>
          </div>
        ))}
      </div>
    </div>
  );
}
