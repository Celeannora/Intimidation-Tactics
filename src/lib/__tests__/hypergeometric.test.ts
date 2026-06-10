import { describe, it, expect } from "vitest";
import {
  hypergeometricPMF,
  hypergeometricCDF,
  probAtLeastOne,
  probByTurn,
  castabilityByTurn,
  probSpellAndLands,
} from "../hypergeometric";

describe("hypergeometricPMF", () => {
  it("returns 0 when k > K", () => {
    expect(hypergeometricPMF(60, 4, 7, 5)).toBe(0);
  });

  it("returns 0 when k > n", () => {
    expect(hypergeometricPMF(60, 10, 3, 4)).toBe(0);
  });

  it("probabilities across all k sum to 1", () => {
    const N = 60, K = 4, n = 7;
    let total = 0;
    for (let k = 0; k <= Math.min(K, n); k++) total += hypergeometricPMF(N, K, n, k);
    expect(total).toBeCloseTo(1, 10);
  });

  it("known value: P(k=0 | N=60,K=4,n=7) ≈ 0.6005", () => {
    // P(X=0) = C(56,7)/C(60,7) ≈ 0.6005
    expect(hypergeometricPMF(60, 4, 7, 0)).toBeCloseTo(0.6005, 2);
  });

  it("known value: P(k=1 | N=60,K=4,n=7) ≈ 0.3363", () => {
    expect(hypergeometricPMF(60, 4, 7, 1)).toBeCloseTo(0.3363, 2);
  });
});

describe("hypergeometricCDF", () => {
  it("P(X>=0) == 1", () => {
    expect(hypergeometricCDF(60, 4, 7, 0)).toBeCloseTo(1, 10);
  });

  it("P(X>=1) + P(X=0) == 1", () => {
    const p0 = hypergeometricPMF(60, 4, 7, 0);
    const pAtLeast1 = hypergeometricCDF(60, 4, 7, 1);
    expect(p0 + pAtLeast1).toBeCloseTo(1, 10);
  });

  it("clamps to 1 when minK=0", () => {
    expect(hypergeometricCDF(60, 20, 7, 0)).toBe(1);
  });
});

describe("probAtLeastOne", () => {
  it("4-of in 60-card deck, 7-card hand ≈ 39.95%", () => {
    // 1 - P(X=0) where P(X=0) ≈ 0.6005
    expect(probAtLeastOne(60, 4, 7)).toBeCloseTo(0.3995, 2);
  });

  it("increases with more copies", () => {
    const p4 = probAtLeastOne(60, 4, 7);
    const p8 = probAtLeastOne(60, 8, 7);
    expect(p8).toBeGreaterThan(p4);
  });

  it("returns 0 for 0 copies", () => {
    expect(probAtLeastOne(60, 0, 7)).toBe(0);
  });

  it("returns 1 for copies == deckSize", () => {
    expect(probAtLeastOne(60, 60, 7)).toBeCloseTo(1, 5);
  });
});

describe("probByTurn", () => {
  it("probability increases each turn", () => {
    let prev = 0;
    for (let t = 1; t <= 8; t++) {
      const p = probByTurn(60, 4, t, true);
      expect(p).toBeGreaterThanOrEqual(prev);
      prev = p;
    }
  });

  it("on the draw sees more cards than on the play", () => {
    const onDraw = probByTurn(60, 4, 3, true);
    const onPlay = probByTurn(60, 4, 3, false);
    expect(onDraw).toBeGreaterThan(onPlay);
  });

  it("0 copies gives 0 probability", () => {
    expect(probByTurn(60, 0, 5, true)).toBe(0);
  });
});

describe("castabilityByTurn", () => {
  it("returns correct number of turn entries", () => {
    const rows = castabilityByTurn(60, 4, 3, 24, 8);
    expect(rows).toHaveLength(8);
  });

  it("probDrawn and probMana are between 0 and 1", () => {
    const rows = castabilityByTurn(60, 4, 2, 24, 6);
    for (const r of rows) {
      expect(r.probDrawn).toBeGreaterThanOrEqual(0);
      expect(r.probDrawn).toBeLessThanOrEqual(1);
      expect(r.probMana).toBeGreaterThanOrEqual(0);
      expect(r.probMana).toBeLessThanOrEqual(1);
    }
  });

  it("probCastable <= min(probDrawn, probMana)", () => {
    const rows = castabilityByTurn(60, 4, 3, 24, 8);
    for (const r of rows) {
      expect(r.probCastable).toBeLessThanOrEqual(
        Math.min(r.probDrawn, r.probMana) + 0.001
      );
    }
  });

  it("cmc=0 card has probMana=1 every turn", () => {
    const rows = castabilityByTurn(60, 4, 0, 24, 4);
    for (const r of rows) {
      expect(r.probMana).toBe(1);
    }
  });

  it("turn numbers are sequential starting at 1", () => {
    const rows = castabilityByTurn(60, 4, 2, 24, 5);
    rows.forEach((r, i) => expect(r.turn).toBe(i + 1));
  });
});

describe("probSpellAndLands (joint, non-independent)", () => {
  // Hand-computed brute-force reference:
  // N=10, spell K=2, lands L=4, other=4, draws=5, want >=1 spell AND >=2 lands.
  // Enumerating all C(10,5)=252 hands gives P = 0.531746 (134/252).
  it("matches the hand-computed small-deck value", () => {
    expect(probSpellAndLands(10, 2, 4, 5, 1, 2)).toBeCloseTo(0.531746, 5);
  });

  it("is strictly less than the independence product (the bug it fixes)", () => {
    // Independence (old, wrong) form for the same case:
    // P(>=1 spell) * P(>=2 lands) = 0.574074 — overstates castability.
    const joint = probSpellAndLands(10, 2, 4, 5, 1, 2);
    expect(joint).toBeLessThan(0.574074);
  });

  it("never exceeds either marginal probability", () => {
    const N = 60, K = 4, L = 24, draws = 5, minLand = 2;
    const joint = probSpellAndLands(N, K, L, draws, 1, minLand);
    const pSpell = hypergeometricCDF(N, K, draws, 1);
    const pLand = hypergeometricCDF(N, L, draws, minLand);
    expect(joint).toBeLessThanOrEqual(Math.min(pSpell, pLand) + 1e-9);
  });

  it("returns 0 when the requirement is impossible", () => {
    expect(probSpellAndLands(60, 4, 24, 7, 5, 2)).toBe(0); // minSpell > copies
    expect(probSpellAndLands(60, 4, 24, 7, 1, 25)).toBe(0); // minLand > lands
  });
});

describe("castabilityByTurn — joint probability fix", () => {
  it("probCastable equals the joint (not the independence product)", () => {
    // deckSize 60, 4 copies, cmc 2, 24 lands, on the draw, turn 2 => 9 cards seen.
    const rows = castabilityByTurn(60, 4, 2, 24, 8, true);
    const t2 = rows.find(r => r.turn === 2)!;
    const cardsSeen = 9; // 7 + turn (on the draw)
    const expectedJoint = probSpellAndLands(60, 4, 24, cardsSeen, 1, 2);
    expect(t2.probCastable).toBeCloseTo(parseFloat(expectedJoint.toFixed(4)), 4);
    // And it must be below the old independence estimate.
    expect(t2.probCastable).toBeLessThan(t2.probDrawn * t2.probMana + 1e-9);
  });

  it("cmc=0 card is castable exactly when drawn", () => {
    const rows = castabilityByTurn(60, 4, 0, 24, 4);
    for (const r of rows) {
      expect(r.probCastable).toBeCloseTo(r.probDrawn, 4);
    }
  });
});
