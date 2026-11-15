import { describe, expect, it } from "vitest";
import { castabilityByTurn, hypergeometricCDF, probByTurn, probSpellAndLands } from "../hypergeometric";

describe("land-only castability timing", () => {
  it.each([0.5, 1.5, 2.5])("rounds fractional mana value %s up to whole land drops", cmc => {
    expect(castabilityByTurn(60, 4, cmc, 24, 4, false))
      .toEqual(castabilityByTurn(60, 4, Math.ceil(cmc), 24, 4, false));
  });

  it.each([-1, NaN, Infinity])("rejects unsupported mana value %s", cmc => {
    expect(() => castabilityByTurn(60, 4, cmc, 24)).toThrow(RangeError);
  });

  it.each([false, true])("does not spend three land drops before turn three (onDraw=%s)", onDraw => {
    const rows = castabilityByTurn(60, 4, 3, 24, 4, onDraw);
    for (const row of rows.slice(0, 2)) {
      expect(row.probMana).toBe(0);
      expect(row.probCastable).toBe(0);
      expect(row.probDrawn).toBeCloseTo(probByTurn(60, 4, row.turn, onDraw), 4);
    }
    const cardsSeen = onDraw ? 10 : 9;
    expect(rows[2].probMana).toBeCloseTo(hypergeometricCDF(60, 24, cardsSeen, 3), 4);
    expect(rows[2].probCastable).toBeCloseTo(probSpellAndLands(60, 4, 24, cardsSeen, 1, 3), 4);
    // The draw-occupancy primitive itself must remain valid before legal land drops.
    expect(probSpellAndLands(60, 4, 24, 7, 1, 3)).toBeGreaterThan(0);
  });
});
