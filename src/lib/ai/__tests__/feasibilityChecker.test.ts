import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import { checkFeasibility, type ProposedEntry } from "../feasibilityChecker";

function makeCard(name: string, overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "",
    cmc: 0,
    colorsJson: JSON.stringify([]),
    colorIdentityJson: JSON.stringify([]),
    typeLine: "Instant",
    oracleText: "",
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: "legal" }),
    setCode: "TST",
    setName: "Test",
    setType: null,
    collectorNumber: null,
    rarity: null,
    imageNormal: null,
    priceUsd: null,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: null,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "",
    importedAt: "",
    ...overrides,
  } as CardRecord;
}

const basicLand = (name: string, produces: string[]): CardRecord =>
  makeCard(name, {
    typeLine: "Basic Land",
    producedManaJson: JSON.stringify(produces),
    colorIdentityJson: JSON.stringify([]),
  });

describe("Rule 4 — mana base must PRODUCE seed colours (Fix 2)", () => {
  it("flags a seed colour the mana base cannot produce", () => {
    // 24 Forests produce only G, but the seed needs R.
    const entries: ProposedEntry[] = [
      { card: basicLand("Forest", ["G"]), quantity: 24 },
    ];
    const seed = makeCard("Lightning Bolt", { colorIdentityJson: JSON.stringify(["R"]) });
    const result = checkFeasibility(entries, [seed], "standard");

    const v = result.violations.find((x) => x.rule === "seed-color-identity");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("hard");
    expect(v?.detail).toMatch(/Lightning Bolt/);
    expect(v?.detail).toMatch(/\bR\b/);
    expect(result.isAcceptable).toBe(false);
  });

  it("does not flag when the mana base actually produces the seed colour", () => {
    const entries: ProposedEntry[] = [
      { card: basicLand("Mountain", ["R"]), quantity: 24 },
    ];
    const seed = makeCard("Lightning Bolt", { colorIdentityJson: JSON.stringify(["R"]) });
    const result = checkFeasibility(entries, [seed], "standard");

    expect(result.violations.some((x) => x.rule === "seed-color-identity")).toBe(false);
  });

  it("is not self-satisfied by the seed merely being in the list", () => {
    // The seed (R) is present as a non-land entry, but no land produces R.
    const seed = makeCard("Lightning Bolt", { colorIdentityJson: JSON.stringify(["R"]) });
    const entries: ProposedEntry[] = [
      { card: basicLand("Forest", ["G"]), quantity: 24 },
      { card: seed, quantity: 4 },
    ];
    const result = checkFeasibility(entries, [seed], "standard");
    expect(result.violations.some((x) => x.rule === "seed-color-identity")).toBe(true);
  });
});

describe("Rule 6 — legality uses the session's selected format, not hardcoded Standard (Fix 2)", () => {
  const modernOnly = makeCard("Ancient Tomb", {
    typeLine: "Land",
    producedManaJson: JSON.stringify([]),
    legalitiesJson: JSON.stringify({ standard: "not_legal", modern: "not_legal", legacy: "legal" }),
  });

  it("flags a card illegal in the selected format", () => {
    const entries: ProposedEntry[] = [{ card: modernOnly, quantity: 1 }];
    const result = checkFeasibility(entries, [], "modern");
    const v = result.violations.find((x) => x.rule === "format-legality");
    expect(v).toBeDefined();
    expect(v?.severity).toBe("hard");
    expect(v?.detail).toMatch(/Modern/);
    expect(v?.detail).toMatch(/Ancient Tomb/);
  });

  it("does not flag the same card when it is legal in the selected format", () => {
    const entries: ProposedEntry[] = [{ card: modernOnly, quantity: 1 }];
    const result = checkFeasibility(entries, [], "legacy");
    expect(result.violations.some((x) => x.rule === "format-legality")).toBe(false);
  });

  it("evaluates legality per-format rather than always against Standard", () => {
    // Legal in Standard, illegal in Modern — the format argument must decide.
    const stdLegalModernIllegal = makeCard("New Set Card", {
      legalitiesJson: JSON.stringify({ standard: "legal", modern: "not_legal" }),
    });
    const entries: ProposedEntry[] = [{ card: stdLegalModernIllegal, quantity: 1 }];

    expect(
      checkFeasibility(entries, [], "standard").violations.some((x) => x.rule === "format-legality"),
    ).toBe(false);
    expect(
      checkFeasibility(entries, [], "modern").violations.some((x) => x.rule === "format-legality"),
    ).toBe(true);
  });
});
