import { describe, it, expect } from "vitest";
import {
  parseManaPips,
  recommendedLandCount,
  colorSourceDistribution,
  type PipCount,
} from "../mana";

describe("Mana System — Edge Cases", () => {

  // ── 21. Standard pip parsing ──────────────────────────────────────────────
  it("EC-21: {2}{W}{U} gives 1W and 1U pip", () => {
    const pips = parseManaPips("{2}{W}{U}");
    expect(pips.W).toBe(1);
    expect(pips.U).toBe(1);
    expect(pips.generic).toBe(2);
  });

  // ── 22. Hybrid mana splits 0.5 each ──────────────────────────────────────
  it("EC-22: {W/U} hybrid counts 0.5W and 0.5U", () => {
    const pips = parseManaPips("{W/U}");
    expect(pips.W).toBeCloseTo(0.5);
    expect(pips.U).toBeCloseTo(0.5);
  });

  // ── 23. Phyrexian mana counts 0.5 of that colour ─────────────────────────
  it("EC-23: {W/P} Phyrexian counts 0.5W", () => {
    const pips = parseManaPips("{W/P}");
    expect(pips.W).toBeCloseTo(0.5);
  });

  // ── 24. X cost is generic, not a colour ──────────────────────────────────
  it("EC-24: {X}{R}{R} gives 2R, generic includes X placeholder", () => {
    const pips = parseManaPips("{X}{R}{R}");
    expect(pips.R).toBe(2);
    // X should not contribute to any colour
    expect(pips.W ?? 0).toBe(0);
    expect(pips.U ?? 0).toBe(0);
  });

  // ── 25. Empty/missing mana cost returns all-zero pips ────────────────────
  it("EC-25: null mana cost returns zero pips", () => {
    const pips = parseManaPips(null);
    expect(Object.values(pips).every(v => v === 0 || v === undefined)).toBe(true);
  });

  // ── 26. Colourless {C} symbol does not count as any WUBRG colour ─────────
  it("EC-26: {C} colourless symbol adds no colour pip", () => {
    const pips = parseManaPips("{C}{C}");
    expect(pips.W ?? 0).toBe(0);
    expect(pips.U ?? 0).toBe(0);
    expect(pips.B ?? 0).toBe(0);
    expect(pips.R ?? 0).toBe(0);
    expect(pips.G ?? 0).toBe(0);
  });

  // ── 27. recommendedLandCount clamps at minimum 18 for aggro ──────────────
  it("EC-27: very low AMV (0.8) clamps to 18 lands", () => {
    expect(recommendedLandCount(0.8, 0, 0)).toBe(18);
  });

  // ── 28. recommendedLandCount clamps at maximum 27 for control ────────────
  it("EC-28: very high AMV (5.0) clamps to 27 lands", () => {
    expect(recommendedLandCount(5.0, 0, 0)).toBe(27);
  });

  // ── 29. Each mana dork reduces recommendation by 0.5 ─────────────────────
  it("EC-29: 4 mana dorks reduce land recommendation by 2", () => {
    const base = recommendedLandCount(2.5, 0, 0);
    const withDorks = recommendedLandCount(2.5, 4, 0);
    expect(base - withDorks).toBeCloseTo(2);
  });

  // ── 30. colour source distribution sums to totalLands ────────────────────
  it("EC-30: colorSourceDistribution sums exactly to totalLands", () => {
    const pips: PipCount = { W: 8, U: 4 };
    const dist = colorSourceDistribution(pips, 24);
    const total = Object.values(dist).reduce((a, b) => a + b, 0);
    expect(total).toBe(24);
  });

  // ── 31. mono-colour deck allocates all lands to that colour ──────────────
  it("EC-31: mono-red pip map allocates 100% to R", () => {
    const pips: PipCount = { R: 12 };
    const dist = colorSourceDistribution(pips, 22);
    expect(dist.R).toBe(22);
  });

  // ── 32. zero-pip (all generic) deck allocates 0 coloured sources ─────────
  it("EC-32: generic-only mana cost produces no coloured source requirement", () => {
    const pips: PipCount = {};
    const dist = colorSourceDistribution(pips, 24);
    expect(Object.keys(dist).length).toBe(0);
  });

  // ── 33. three-colour deck distributes proportionally ─────────────────────
  it("EC-33: W4 U4 B4 three-colour allocates equal sources", () => {
    const pips: PipCount = { W: 4, U: 4, B: 4 };
    const dist = colorSourceDistribution(pips, 24);
    expect(dist.W).toBe(8);
    expect(dist.U).toBe(8);
    expect(dist.B).toBe(8);
  });

  // ── 34. half-pip (hybrid) still contributes to colour source need ─────────
  it("EC-34: 0.5 hybrid pip contributes to source count for both colours", () => {
    const pips: PipCount = { W: 0.5, U: 0.5 };
    const dist = colorSourceDistribution(pips, 4);
    expect(dist.W).toBe(2);
    expect(dist.U).toBe(2);
  });
});
