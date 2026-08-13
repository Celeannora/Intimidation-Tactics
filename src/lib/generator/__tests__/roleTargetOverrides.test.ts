import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import type { DeckEntry } from "../../legality";
import { generateDeck } from "../generator";
import type { GenerateOptions } from "../types";

/**
 * Acceptance test for GenerateOptions.roleTargetOverrides.
 *
 * The override must be a generic per-generation knob -- usable for ANY role
 * and ANY archetype -- not something wired up only for board wipes or only
 * for Control. This test exercises two different roles across two
 * different archetypes to prove that.
 */

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  colors: ManaColor[] = [],
  cmc = 2
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: colors.length ? "{1}{U}" : "{1}",
    cmc,
    colorsJson: JSON.stringify(colors),
    colorIdentityJson: JSON.stringify(colors),
    typeLine,
    oracleText,
    keywordsJson: "[]",
    power: typeLine.includes("Creature") ? "2" : null,
    toughness: typeLine.includes("Creature") ? "2" : null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
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
    searchText: `${name} ${oracleText} ${typeLine}`,
    importedAt: "",
  } as CardRecord;
}

function makeBasic(name: string): CardRecord {
  return { ...makeCard(name, "", "Basic Land", [], 0) } as CardRecord;
}

function mainQty(entries: DeckEntry[], oracleId: string): number {
  return entries
    .filter((e) => e.board === "main" && e.card.oracleId === oracleId)
    .reduce((s, e) => s + e.quantity, 0);
}

describe("roleTargetOverrides is a generic per-generation knob", () => {
  it("raises board wipe count above the Control archetype default when overridden", () => {
    const wipes = Array.from({ length: 12 }, (_, i) =>
      makeCard(`Wipe ${i + 1}`, "Destroy all creatures.", "Sorcery", ["W"], 4)
    );
    const filler = Array.from({ length: 40 }, (_, i) =>
      makeCard(`Filler ${i + 1}`, "Draw a card.", "Creature — Elite", ["U"], 3)
    );

    const baseline: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Control",
      colors: ["W", "U"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };
    const baselineResult = generateDeck(baseline, [...wipes, ...filler, makeBasic("Wastes")]);
    const baselineWipeCount = wipes.reduce(
      (s, c) => s + mainQty(baselineResult.entries, c.oracleId),
      0
    );

    const overridden: GenerateOptions = {
      ...baseline,
      roleTargetOverrides: { boardWipes: 9 },
    };
    const overriddenResult = generateDeck(overridden, [...wipes, ...filler, makeBasic("Wastes")]);
    const overriddenWipeCount = wipes.reduce(
      (s, c) => s + mainQty(overriddenResult.entries, c.oracleId),
      0
    );

    expect(overriddenWipeCount).toBeGreaterThan(baselineWipeCount);
    expect(overriddenWipeCount).toBeGreaterThanOrEqual(9);
    expect(
      overriddenResult.diagnostics.reasoning.some((r) => r.includes("Role target overrides applied"))
    ).toBe(true);
  });

  it("works for a different role on a different archetype (not board-wipe- or Control-specific)", () => {
    const ramp = Array.from({ length: 14 }, (_, i) =>
      makeCard(`Ramp ${i + 1}`, "Add {G}.", "Artifact — Test", ["G"], 2)
    );
    const filler = Array.from({ length: 30 }, (_, i) =>
      makeCard(`Filler ${i + 1}`, "Draw a card.", "Creature — Elite", ["G"], 3)
    );

    const baseline: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: ["G"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };
    const baselineResult = generateDeck(baseline, [...ramp, ...filler, makeBasic("Forest")]);
    const baselineRampCount = ramp.reduce((s, c) => s + mainQty(baselineResult.entries, c.oracleId), 0);

    const overridden: GenerateOptions = {
      ...baseline,
      roleTargetOverrides: { ramp: 10 },
    };
    const overriddenResult = generateDeck(overridden, [...ramp, ...filler, makeBasic("Forest")]);
    const overriddenRampCount = ramp.reduce(
      (s, c) => s + mainQty(overriddenResult.entries, c.oracleId),
      0
    );

    expect(overriddenRampCount).toBeGreaterThan(baselineRampCount);
    expect(overriddenRampCount).toBeGreaterThanOrEqual(10);
  });

  it("survives the optimizer -- role counts never regress below what Phase 1 placed", () => {
    // The optimizer (Phase 3) swaps cards purely on deckScore and has no
    // awareness of role targets. This reproduces the shape that triggered
    // the real bug on the Hope Estheim deck: a role-constrained Control
    // build (locked seed cards eating slots, several role targets active
    // at once, 200 optimizer iterations, dual-role cards in the pool)
    // where the optimizer's swap walk can trade away role-fulfilling cards
    // for higher-deckScore alternatives. Generic -- it doesn't matter which
    // role, archetype, or seed; only that the post-optimizer guard in
    // generator.ts catches ANY role regressing below its pre-optimizer
    // (Phase 1) count and reverts to it.
    const seedCards = Array.from({ length: 3 }, (_, i) =>
      makeCard(`Seed ${i + 1}`, "Gain 3 life. Draw a card.", "Legendary Creature — Test", ["W"], 2)
    );
    const wipes = Array.from({ length: 10 }, (_, i) =>
      makeCard(`Wipe ${i + 1}`, "Destroy all creatures.", "Sorcery", ["W"], 4)
    );
    const dualRoleWipes = Array.from({ length: 4 }, (_, i) =>
      makeCard(`DualWipe ${i + 1}`, "Destroy all creatures. Exile all cards from graveyards.", "Sorcery", ["W"], 3)
    );
    const removal = Array.from({ length: 10 }, (_, i) =>
      makeCard(`Removal ${i + 1}`, "Destroy target creature.", "Instant", ["U"], 2)
    );
    const highScoreFiller = Array.from({ length: 80 }, (_, i) =>
      makeCard(`Value ${i + 1}`, "Draw two cards. Gain 4 life. Scry 2.", "Creature — Elite", ["U"], 3)
    );

    const pool = [...seedCards, ...wipes, ...dualRoleWipes, ...removal, ...highScoreFiller, makeBasic("Wastes")];
    const seedEntries: DeckEntry[] = seedCards.map((c) => ({
      board: "main",
      card: c,
      quantity: 4,
    }));

    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Control",
      colors: ["W", "U"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 200,
      seedEntries,
      roleTargetOverrides: { boardWipes: 9 },
    };
    const result = generateDeck(options, pool);
    const allWipes = [...wipes, ...dualRoleWipes];
    const finalWipeCount = allWipes.reduce((s, c) => s + mainQty(result.entries, c.oracleId), 0);
    const removalCount = removal.reduce((s, c) => s + mainQty(result.entries, c.oracleId), 0);

    // Re-derive the "Phase 1 achieved" count independently from the
    // reasoning log's own "boardWipes: placed X / Y" line so this assertion
    // doesn't just restate the guard's own bookkeeping.
    const placedLine = result.diagnostics.reasoning.find((r) => r.startsWith("boardWipes: placed"));
    const phase1Placed = placedLine ? Number(placedLine.match(/placed (\d+)/)?.[1] ?? 0) : 0;

    expect(finalWipeCount).toBeGreaterThanOrEqual(phase1Placed);
    expect(removalCount).toBeGreaterThan(0);
  }, 20000);

  it("is a no-op when omitted (unchanged legacy behaviour)", () => {
    const filler = Array.from({ length: 30 }, (_, i) => makeCard(`F${i}`, "Draw a card.", "Creature — Elite", []));
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };
    const result = generateDeck(options, [...filler, makeBasic("Wastes")]);
    expect(result.diagnostics.reasoning.some((r) => r.includes("Role target overrides applied"))).toBe(
      false
    );
  });
});
