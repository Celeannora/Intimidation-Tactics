import { useEffect, useState } from "react";
import { addMatchRecord, calcMatchResult, deleteMatchRecord, getMatchRecords, getWinRateStats } from "../lib/bo3";
import { getMatchupStats } from "../lib/matchup";
import type { GameRecord, MatchRecord, MatchStats } from "../lib/bo3";
import type { MatchupStats } from "../lib/matchup";

interface Props { deckId: string; }

const COMMON_ARCHETYPES = ["Aggro", "Control", "Midrange", "Combo", "Ramp", "Other"];

export function Bo3Panel({ deckId }: Props) {
  const [records, setRecords] = useState<MatchRecord[]>([]);
  const [stats, setStats] = useState<MatchStats | null>(null);
  const [matchupStats, setMatchupStats] = useState<MatchupStats[]>([]);

  // New match form
  const [opponent, setOpponent] = useState(COMMON_ARCHETYPES[0]);
  const [games, setGames] = useState<GameRecord[]>([
    { game: 1, result: "win", onPlay: true },
  ]);

  const reload = async () => {
    const [r, s, m] = await Promise.all([
      getMatchRecords(deckId),
      getWinRateStats(deckId),
      getMatchupStats(deckId),
    ]);
    setRecords(r);
    setStats(s);
    setMatchupStats(m);
  };

  useEffect(() => { reload(); }, [deckId]);

  const addGame = () => {
    if (games.length >= 3) return;
    setGames([...games, { game: (games.length + 1) as 1 | 2 | 3, result: "win", onPlay: true }]);
  };

  const updateGame = (idx: number, patch: Partial<GameRecord>) => {
    setGames(games.map((g, i) => i === idx ? { ...g, ...patch } : g));
  };

  const submitMatch = async () => {
    await addMatchRecord({
      deckId,
      opponentArchetype: opponent,
      date: new Date().toISOString(),
      games,
      matchResult: calcMatchResult(games),
    });
    setGames([{ game: 1, result: "win", onPlay: true }]);
    await reload();
  };

  const pct = (n: number) => `${(n * 100).toFixed(0)}%`;

  return (
    <div className="space-y-6 text-zinc-100">
      <h2 className="text-lg font-semibold">Bo3 Match Tracker</h2>

      {/* Stats strip */}
      {stats && stats.total > 0 && (
        <div className="grid grid-cols-4 gap-2">
          {[
            ["Matches", `${stats.wins}W / ${stats.losses}L / ${stats.draws}D`],
            ["Match WR", pct(stats.winRate)],
            ["Game WR", pct(stats.gameWinRate)],
            ["On Play WR", pct(stats.onPlayWinRate)],
          ].map(([label, value]) => (
            <div key={label} className="rounded-lg bg-zinc-900 p-3 text-center">
              <p className="text-xs text-zinc-500">{label}</p>
              <p className="text-lg font-semibold tabular-nums">{value}</p>
            </div>
          ))}
        </div>
      )}

      {/* Log new match */}
      <div className="rounded-xl border border-zinc-800 bg-zinc-950 p-4 space-y-3">
        <p className="text-sm font-medium">Log Match</p>

        <div className="flex items-center gap-2">
          <label className="text-xs text-zinc-400 w-24">Opponent</label>
          <select value={opponent} onChange={(e) => setOpponent(e.target.value)}
            className="flex-1 rounded-md bg-zinc-800 px-2 py-1.5 text-sm focus:outline-none focus:ring-1 focus:ring-teal-500">
            {COMMON_ARCHETYPES.map((a) => <option key={a}>{a}</option>)}
          </select>
          <input placeholder="Custom"
            className="w-28 rounded-md bg-zinc-800 px-2 py-1.5 text-sm placeholder-zinc-600 focus:outline-none"
            onBlur={(e) => { if (e.target.value) setOpponent(e.target.value); }}
          />
        </div>

        {games.map((g, i) => (
          <div key={i} className="flex items-center gap-2">
            <span className="text-xs text-zinc-500 w-14">Game {g.game}</span>
            <select value={g.result} onChange={(e) => updateGame(i, { result: e.target.value as "win" | "loss" | "draw" })}
              className="rounded-md bg-zinc-800 px-2 py-1.5 text-sm focus:outline-none">
              <option value="win">Win</option>
              <option value="loss">Loss</option>
              <option value="draw">Draw</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs text-zinc-400">
              <input type="checkbox" checked={g.onPlay} onChange={(e) => updateGame(i, { onPlay: e.target.checked })} />
              On Play
            </label>
          </div>
        ))}

        <div className="flex gap-2">
          {games.length < 3 && (
            <button onClick={addGame} className="rounded-md bg-zinc-700 px-3 py-1.5 text-xs hover:bg-zinc-600">+ Game</button>
          )}
          <button onClick={submitMatch} className="rounded-md bg-teal-600 px-3 py-1.5 text-xs hover:bg-teal-500">Save Match</button>
        </div>
      </div>

      {/* Matchup table */}
      {matchupStats.length > 0 && (
        <div className="rounded-xl border border-zinc-800 overflow-hidden">
          <table className="w-full text-sm">
            <thead className="bg-zinc-900 text-zinc-400">
              <tr>
                {["Archetype", "W", "L", "D", "WR"].map((h) => (
                  <th key={h} className="px-3 py-2 text-left font-medium">{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {matchupStats.map((m) => (
                <tr key={m.opponentArchetype} className="border-t border-zinc-800 hover:bg-zinc-900">
                  <td className="px-3 py-2">{m.opponentArchetype}</td>
                  <td className="px-3 py-2 tabular-nums text-emerald-400">{m.wins}</td>
                  <td className="px-3 py-2 tabular-nums text-red-400">{m.losses}</td>
                  <td className="px-3 py-2 tabular-nums text-zinc-400">{m.draws}</td>
                  <td className="px-3 py-2 tabular-nums font-semibold">{pct(m.winRate)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {/* Recent matches */}
      {records.length > 0 && (
        <div className="space-y-1">
          <p className="text-xs font-semibold text-zinc-400 uppercase tracking-wide">Recent Matches</p>
          {records.slice(0, 10).map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-lg bg-zinc-900 px-3 py-2">
              <div>
                <span className={`text-sm font-medium ${
                  r.matchResult === "win" ? "text-emerald-400" : r.matchResult === "loss" ? "text-red-400" : "text-zinc-400"
                }`}>{r.matchResult.toUpperCase()}</span>
                <span className="text-xs text-zinc-500 ml-2">vs {r.opponentArchetype}</span>
              </div>
              <div className="flex items-center gap-2">
                <span className="text-xs text-zinc-500">{new Date(r.date).toLocaleDateString()}</span>
                <button onClick={async () => { await deleteMatchRecord(r.id); reload(); }}
                  className="text-xs text-red-500 hover:text-red-400">&times;</button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
