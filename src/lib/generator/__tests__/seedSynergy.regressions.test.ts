import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import {
  classifySeedRoles,
  dominantColor,
  inferResourceSpec,
  inferSeedAnthemSynergy,
  reanalyzeDeck,
  type SeedPackage,
} from "../seedSynergy";

function card(overrides: Partial<CardRecord>): CardRecord {
  return {
    id: "test-id",
    oracleId: "test-oracle",
    name: "Test Card",
    manaCost: "{1}",
    cmc: 2,
    typeLine: "Creature — Test",
    oracleText: "",
    keywordsJson: "[]",
    producedManaJson: "[]",
    colorIdentityJson: "[]",
    power: "2",
    toughness: "2",
    ...overrides,
  } as CardRecord;
}

describe("seedSynergy regressions", () => {
  it.each([
    ["Faeries", "Faerie"],
    ["Mercenaries", "Mercenary"],
    ["Allies", "Ally"],
    ["Angel", "Angel"],
  ])("recognizes %s anthem text as subtype %s", (plural, subtype) => {
    const anthem = card({
      oracleText: `Other ${plural} you control get +1/+1.`,
    });

    expect(inferSeedAnthemSynergy([anthem])).toMatchObject({ subtype });
  });

  it("classifies a seeded mana Enabler from its function without blocking other Enablers", () => {
    const manaSeed = card({
      name: "Mana Seed",
      oracleText: "{T}: Add {G}.",
      producedManaJson: '["G"]',
    });
    const payoffSeed = card({
      name: "Treasure Payoff",
      oracleText: "Treasure Payoff gets +1/+1 for each Treasure you control.",
    });
    const treasureProducer = card({
      name: "Treasure Producer",
      oracleText: "When this creature enters the battlefield, create a Treasure token.",
    });
    const seedPackage: SeedPackage = [
      { name: manaSeed.name, quantity: 4 },
      { name: payoffSeed.name, quantity: 4 },
    ];
    const resourceSpec = inferResourceSpec([payoffSeed]);

    expect(classifySeedRoles(manaSeed, seedPackage, resourceSpec)).toContain("Enabler");
    expect(classifySeedRoles(manaSeed, seedPackage, resourceSpec)).not.toContain("Payoff");
    expect(classifySeedRoles(treasureProducer, seedPackage, resourceSpec)).toContain("Enabler");
  });

  it("applies pip-balance handling consistently to every WUBRG color", () => {
    const redSpell = card({ manaCost: "{R}{R}", cmc: 2 });
    const adjustments = reanalyzeDeck([{ card: redSpell, quantity: 6 }]);

    expect(dominantColor(redSpell)).toBe("R");
    expect(adjustments.colorMultiplier.R).toBeLessThan(1);
    expect(adjustments.colorMultiplier.W).toBe(1);
    expect(adjustments.colorMultiplier.U).toBe(1);
    expect(adjustments.colorMultiplier.B).toBe(1);
    expect(adjustments.colorMultiplier.G).toBe(1);
  });
});
