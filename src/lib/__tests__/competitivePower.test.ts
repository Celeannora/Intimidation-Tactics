import { describe, it, expect, afterEach } from "vitest";
import type { CardRecord } from "../types";
import {
  getCompetitivePower,
  entryToPower,
  setCompetitiveSnapshot,
  getCompetitiveSnapshotInfo,
  COMPETITIVE_POWER_MAX,
  type CompetitiveSnapshot,
} from "../competitivePower";
import { computePowerScore, computeHeuristicPowerScore } from "../powerScore";

/** Minimal CardRecord factory — only the fields the scorers read. */
function card(partial: Partial<CardRecord>): CardRecord {
  return {
    name: "Test Card",
    cmc: 2,
    typeLine: "Creature — Human",
    rarity: "common",
    edhrecRank: null,
    gameChanger: 0,
    oracleId: "test-oracle",
    ...partial,
  } as CardRecord;
}

const fixtureSnapshot: CompetitiveSnapshot = {
  schemaVersion: 1,
  format: "standard",
  updatedAt: "2099-01-01",
  source: "test fixture",
  cards: [
    { name: "Staple Removal", playRate: 0.9, copiesAvg: 4, topDeckPresence: 0.9 },
    { name: "Fringe Card", playRate: 0.05, copiesAvg: 1, topDeckPresence: 0.02 },
  ],
};

afterEach(() => {
  // Always restore the bundled snapshot so tests don't leak state.
  setCompetitiveSnapshot();
});

describe("competitivePower", () => {
  it("maps a ubiquitous 4-of staple to a high (near-cap) signal", () => {
    setCompetitiveSnapshot(fixtureSnapshot);
    const power = getCompetitivePower(card({ name: "Staple Removal" }));
    expect(power).not.toBeNull();
    expect(power!).toBeGreaterThan(30);
    expect(power!).toBeLessThanOrEqual(COMPETITIVE_POWER_MAX);
  });

  it("maps a fringe card to a low signal", () => {
    setCompetitiveSnapshot(fixtureSnapshot);
    const power = getCompetitivePower(card({ name: "Fringe Card" }))!;
    expect(power).toBeLessThan(5);
  });

  it("returns null for cards absent from the snapshot", () => {
    setCompetitiveSnapshot(fixtureSnapshot);
    expect(getCompetitivePower(card({ name: "Unknown Brew Card" }))).toBeNull();
  });

  it("matches names case-insensitively and uses the front face of DFCs", () => {
    setCompetitiveSnapshot(fixtureSnapshot);
    expect(getCompetitivePower(card({ name: "STAPLE REMOVAL" }))).not.toBeNull();
    expect(getCompetitivePower(card({ name: "Staple Removal // Back Face" }))).not.toBeNull();
  });

  it("entryToPower weights topDeckPresence/playRate over raw copies", () => {
    const winsLists = entryToPower({ name: "a", playRate: 0.8, copiesAvg: 1, topDeckPresence: 0.8 });
    const just4ofs = entryToPower({ name: "b", playRate: 0.1, copiesAvg: 4, topDeckPresence: 0.05 });
    expect(winsLists).toBeGreaterThan(just4ofs);
  });

  it("the bundled snapshot loads and is non-empty", () => {
    const info = getCompetitiveSnapshotInfo();
    expect(info.format).toBe("standard");
    expect(info.count).toBeGreaterThan(0);
  });
});

describe("computePowerScore competitive blend", () => {
  it("is backwards-compatible: one-arg call equals the pure heuristic", () => {
    const c = card({ rarity: "mythic", edhrecRank: 100 });
    expect(computePowerScore(c)).toBe(computeHeuristicPowerScore(c));
  });

  it("a real staple outscores a vanilla mythic once competitive data anchors it", () => {
    // Vanilla beater: mythic + good EDHREC rank but NO competitive data → heuristic only.
    const vanillaMythic = card({ name: "Big Dumb Mythic", rarity: "mythic", edhrecRank: 300, cmc: 6, typeLine: "Creature — Dragon" });
    const heuristicOnly = computePowerScore(vanillaMythic, null);

    // Format staple: common rarity, no EDHREC, but dominant competitive signal.
    const staple = card({ name: "Cheap Removal", rarity: "common", edhrecRank: null, cmc: 1, typeLine: "Instant" });
    const competitive = 38; // high competitive signal
    const blended = computePowerScore(staple, competitive);

    expect(blended).toBeGreaterThan(heuristicOnly);
  });

  it("competitive signal dominates the blend (80/20)", () => {
    const c = card({ rarity: "common", edhrecRank: null });
    const blended = computePowerScore(c, 40);
    // With heuristic ~ (common=1 + cmc<=2 creature=4) = 5 → 0.8*40 + 0.2*5 = 33
    expect(blended).toBeGreaterThan(30);
    expect(blended).toBeLessThanOrEqual(40);
  });
});
