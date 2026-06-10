import { describe, expect, it } from "vitest";
import { calcMatchResult, calcStats } from "../bo3";
import type { GameRecord, MatchRecord } from "../bo3";

const W: GameRecord = { game: 1, result: "win", onPlay: true };
const L: GameRecord = { game: 2, result: "loss", onPlay: false };

describe("calcMatchResult", () => {
  it("win when majority games won", () => expect(calcMatchResult([W, W])).toBe("win"));
  it("loss when majority games lost", () => expect(calcMatchResult([L, L])).toBe("loss"));
  it("draw on a split", () => expect(calcMatchResult([W, L])).toBe("draw"));
});

describe("calcStats", () => {
  const match = (result: "win" | "loss" | "draw", games: GameRecord[]): MatchRecord => ({
    id: "", deckId: "", opponentArchetype: "test", date: "", games, matchResult: result,
  });

  it("calculates winRate correctly", () => {
    const stats = calcStats([match("win", [W]), match("loss", [L]), match("win", [W])]);
    expect(stats.wins).toBe(2);
    expect(stats.losses).toBe(1);
    expect(stats.winRate).toBeCloseTo(2 / 3);
  });

  it("returns zero winRate for empty records", () => {
    expect(calcStats([]).winRate).toBe(0);
  });
});
