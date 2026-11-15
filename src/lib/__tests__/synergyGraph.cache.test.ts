import { beforeEach, describe, expect, it } from "vitest";
import { buildSeedSynergyGraph, clearSynergyGraphCache } from "../analysis/synergyGraph";
import type { CardRecord } from "../types";

const card = (overrides: Partial<CardRecord> = {}): CardRecord => ({
  oracleId: "same-id", name: "Original", oracleText: "", typeLine: "Creature — Bear",
  keywordsJson: "[]", power: "2", cmc: 2, ...overrides,
} as CardRecord);

beforeEach(clearSynergyGraphCache);

describe("synergy graph profile-aware cache", () => {
  it("bounds retained graphs while preserving hits for unchanged inputs", () => {
    const firstCard = card();
    const first = buildSeedSynergyGraph([firstCard]);
    expect(buildSeedSynergyGraph([{ ...firstCard }])).toBe(first);
    for (let i = 0; i < 128; i++) buildSeedSynergyGraph([card({ oracleId: `other-${i}` })]);
    expect(buildSeedSynergyGraph([firstCard])).not.toBe(first);
    expect(buildSeedSynergyGraph([firstCard])).toEqual(first);
  });
  it.each([
    { oracleText: "You gain 2 life." },
    { typeLine: "Enchantment" },
    { keywordsJson: '["Lifelink"]' },
    { name: "Updated name" },
    { power: "4" },
    { cmc: 5 },
  ])("invalidates same IDs when profile inputs change: %j", (change) => {
    const original = card();
    const first = buildSeedSynergyGraph([original]);
    Object.assign(original, change);
    const updated = buildSeedSynergyGraph([original]);
    expect(updated).not.toBe(first);
    clearSynergyGraphCache();
    expect(updated).toEqual(buildSeedSynergyGraph([original]));
  });
});
