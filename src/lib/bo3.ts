import { db } from "./db";

export type MatchResult = "win" | "loss" | "draw";

export interface GameRecord {
  game: 1 | 2 | 3;
  result: MatchResult;
  onPlay: boolean;
  notes?: string;
}

export interface MatchRecord {
  id: string;
  deckId: string;
  opponentArchetype: string;
  date: string;
  games: GameRecord[];
  matchResult: MatchResult;
  sideboardPlanUsed?: string;
}

export function calcMatchResult(games: GameRecord[]): MatchResult {
  const wins = games.filter((g) => g.result === "win").length;
  const losses = games.filter((g) => g.result === "loss").length;
  if (wins > losses) return "win";
  if (losses > wins) return "loss";
  return "draw";
}

export interface MatchStats {
  total: number;
  wins: number;
  losses: number;
  draws: number;
  winRate: number;
  gameWinRate: number;
  onPlayWinRate: number;
  onDrawWinRate: number;
}

export function calcStats(records: MatchRecord[]): MatchStats {
  const total = records.length;
  const wins = records.filter((r) => r.matchResult === "win").length;
  const losses = records.filter((r) => r.matchResult === "loss").length;
  const draws = total - wins - losses;

  const allGames = records.flatMap((r) => r.games);
  const gameWins = allGames.filter((g) => g.result === "win").length;
  const onPlayGames = allGames.filter((g) => g.onPlay);
  const onPlayWins = onPlayGames.filter((g) => g.result === "win").length;
  const onDrawGames = allGames.filter((g) => !g.onPlay);
  const onDrawWins = onDrawGames.filter((g) => g.result === "win").length;

  return {
    total,
    wins,
    losses,
    draws,
    winRate: total ? wins / total : 0,
    gameWinRate: allGames.length ? gameWins / allGames.length : 0,
    onPlayWinRate: onPlayGames.length ? onPlayWins / onPlayGames.length : 0,
    onDrawWinRate: onDrawGames.length ? onDrawWins / onDrawGames.length : 0,
  };
}

// In-memory match store (persisted via Dexie `meta` table as JSON)
const STORAGE_KEY = "bo3_matches";

async function loadMatches(): Promise<MatchRecord[]> {
  const row = await db.meta.get(STORAGE_KEY);
  if (!row) return [];
  try { return JSON.parse(row.value) as MatchRecord[]; } catch { return []; }
}

async function saveMatches(records: MatchRecord[]): Promise<void> {
  await db.meta.put({ key: STORAGE_KEY, value: JSON.stringify(records) });
}

export async function addMatchRecord(record: Omit<MatchRecord, "id">): Promise<MatchRecord> {
  const all = await loadMatches();
  const full: MatchRecord = { ...record, id: `match_${Date.now()}` };
  all.push(full);
  await saveMatches(all);
  return full;
}

export async function getMatchRecords(deckId: string): Promise<MatchRecord[]> {
  const all = await loadMatches();
  return all.filter((r) => r.deckId === deckId);
}

export async function deleteMatchRecord(id: string): Promise<void> {
  const all = await loadMatches();
  await saveMatches(all.filter((r) => r.id !== id));
}

export async function getWinRateStats(deckId: string): Promise<MatchStats> {
  const records = await getMatchRecords(deckId);
  return calcStats(records);
}
