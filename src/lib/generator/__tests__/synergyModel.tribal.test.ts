import { describe, expect, it } from "vitest";
import { cardGrantsTribalBenefit, cardMatchesTribe, cardReferencesTribe, normalizeTribe, tribalCardBonus } from "../synergyModel";
import type { CardRecord } from "../../types";

const elf = { typeLine: "Creature — Elf Druid", oracleText: "Other Elves you control get +1/+1." } as CardRecord;

describe("conservative Elf tribal forms", () => {
  it("normalizes only known plurals without stripping arbitrary trailing s", () => {
    expect(normalizeTribe("Fungus")).toBe("fungus");
    expect(normalizeTribe("Moss")).toBe("moss");
    expect(normalizeTribe("Humans")).toBe("human");
    expect(normalizeTribe("Merfolk")).toBe("merfolk");
    expect(cardGrantsTribalBenefit({ ...elf, oracleText: "Other Elfs you control get +1/+1." }, "Elf")).toBe(false);
  });
  it("uses the same canonical Elf for singular/plural matching, references, benefits and bonuses", () => {
    expect(normalizeTribe(" Elves ")).toBe("elf");
    for (const tribe of ["Elf", "Elves"]) {
      expect(cardMatchesTribe(elf, tribe)).toBe(true);
      expect(cardReferencesTribe(elf, tribe)).toBe(true);
      expect(cardGrantsTribalBenefit(elf, tribe)).toBe(true);
      expect(tribalCardBonus(elf, { tribe, mode: "recommended" })).toBe(15);
    }
  });
});
