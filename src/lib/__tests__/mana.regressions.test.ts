import { describe, expect, it } from "vitest";
import { parsePips } from "../manaBase";
import { parseManaPips } from "../mana";

describe("weighted Phyrexian mana semantics", () => {
  it.each([
    ["{W/P}", 0.5, 0],
    ["{W/U/P}", 0.25, 0.25],
    ["{W}{W/P}{U/P}", 1.5, 0.5],
  ])("shares the optional colored half of %s between its colors", (cost, white, blue) => {
    for (const parsed of [parsePips(cost), parseManaPips(cost)]) {
      expect(parsed.W ?? 0).toBe(white);
      expect(parsed.U ?? 0).toBe(blue);
    }
  });

  it("preserves ordinary mono-color and hybrid pip weights", () => {
    for (const parsed of [parsePips("{2}{W}{W/U}"), parseManaPips("{2}{W}{W/U}")]) {
      expect(parsed.W).toBe(1.5);
      expect(parsed.U).toBe(0.5);
    }
  });
});
