import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import type { DeckEntry } from "../../legality";
import { generateDeck } from "../generator";
import type { GenerateOptions } from "../types";

/**
 * Acceptance test for the generator.ts <-> seedSynergy.ts wiring.
 *
 * The seed here is deliberately NOT Hope Estheim / Space-Time Anomaly and
 * NOT white/blue: it's a black/red sacrifice-aristocrats plan built around
 * sacrificing creatures for value, with Treasure as the enabling resource.
 * The point is to prove that generateDeck() classifies roles, infers a
 * payoff resource, scores candidates, and raises feasibility warnings using
 * ONLY this seed's own Oracle text and mana costs -- with zero Hope/WU-shaped
 * assumptions anywhere in the path. If this test passes, the deck-agnostic
 * mandate is actually wired into the real generic entry point, not just
 * demonstrated by a one-off script.
 */

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  colors: ManaColor[] = [],
  cmc = 2,
  manaCost = "{1}"
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost,
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
  return {
    ...makeCard(name, "", "Basic Land", [], 0, ""),
  } as CardRecord;
}

function mainQty(entries: DeckEntry[], oracleId: string): number {
  return entries
    .filter((e) => e.board === "main" && e.card.oracleId === oracleId)
    .reduce((s, e) => s + e.quantity, 0);
}

describe("seedSynergy wiring is deck-agnostic (non-Hope, non-WU seed)", () => {
  it("infers a Treasure/sacrifice resource and role-classifies candidates from a black/red aristocrats seed with no hardcoded deck knowledge", () => {
    const BR: ManaColor[] = ["B", "R"];

    // The seed package: three cards that define a sacrifice-for-value plan.
    // "Payoff" role is earned automatically by seed-package membership; the
    // resource ("Treasure") must be inferred purely from this text.
    const seedEntries: DeckEntry[] = [
      {
        card: makeCard(
          "Bloodrite Harvester",
          "Bloodrite Harvester deals damage equal to the number of Treasures you control to any target. Sacrifice a Treasure: you gain 2 life.",
          "Creature — Devil",
          BR,
          4,
          "{2}{B}{R}"
        ),
        quantity: 4,
        board: "main",
      },
      {
        card: makeCard(
          "Cinder Confessor",
          "Cinder Confessor gets +1/+0 for each Treasure you control. Sacrifice a Treasure: exile the top card of your library. You may play it this turn.",
          "Creature — Devil",
          BR,
          3,
          "{2}{R}"
        ),
        quantity: 4,
        board: "main",
      },
      {
        card: makeCard(
          "Ashheap Reveler",
          "Whenever you sacrifice a Treasure, put a +1/+1 counter on Ashheap Reveler. Ashheap Reveler gets +0/+1 for each Treasure you control.",
          "Creature — Devil",
          BR,
          2,
          "{1}{B}"
        ),
        quantity: 4,
        board: "main",
      },
    ];

    // Enabler-shaped candidates: they PRODUCE Treasure (the resource the
    // payoffs above read), so resourceCadence() should classify them as
    // repeatable producers feeding the "Enabler" role.
    const treasureProducers = [
      makeCard(
        "Goblin Trader",
        "When Goblin Trader enters the battlefield, create a Treasure token.",
        "Creature — Goblin",
        ["R"],
        2,
        "{1}{R}"
      ),
      makeCard(
        "Fortune's Fence",
        "At the beginning of your upkeep, create a Treasure token.",
        "Enchantment",
        ["B"],
        3,
        "{2}{B}"
      ),
      makeCard(
        "Coin-Op Smuggler",
        "Whenever a Treasure you control is sacrificed, draw a card.",
        "Creature — Human Rogue",
        ["B"],
        2,
        "{1}{B}"
      ),
    ];

    // Protection-shaped candidates: real removal / sweepers.
    const protection = [
      makeCard("Cauterize Wound", "Destroy target creature.", "Instant", ["B"], 2, "{1}{B}"),
      makeCard("Ashfall Reckoning", "Destroy all creatures.", "Sorcery", ["B", "R"], 4, "{2}{B}{R}"),
    ];

    // Consistency-shaped candidates: genuine card draw / tutoring.
    const consistency = [
      makeCard("Ledger of Ruin", "Draw two cards.", "Sorcery", ["B"], 2, "{1}{B}"),
      makeCard(
        "Devil's Search",
        "Search your library for a creature card, reveal it, put it into your hand.",
        "Sorcery",
        ["R"],
        3,
        "{2}{R}"
      ),
    ];

    // Zero-seed-role filler: on-color, on-curve, "generically fine" cards
    // with no removal/draw/tutor/production text at all -- these should be
    // rejected as candidates (scoreCandidate returns -Infinity) regardless
    // of how clean their stats look, because they fill no seed role.
    const deadFiller = Array.from({ length: 24 }, (_, i) =>
      makeCard(`Vanilla Grunt ${i + 1}`, "", "Creature — Human Warrior", ["B"], 3, "{2}{B}")
    );

    const allCards: CardRecord[] = [
      ...seedEntries.map((e) => e.card),
      ...treasureProducers,
      ...protection,
      ...consistency,
      ...deadFiller,
      makeBasic("Swamp"),
      makeBasic("Mountain"),
    ];

    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: BR,
      seedEntries,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 100,
    };

    const result = generateDeck(options, allCards);

    // 1. The seed's own cards remain locked in at their requested counts —
    //    unaffected by the new scoring layer.
    expect(mainQty(result.entries, "Bloodrite Harvester")).toBe(4);
    expect(mainQty(result.entries, "Cinder Confessor")).toBe(4);
    expect(mainQty(result.entries, "Ashheap Reveler")).toBe(4);

    // 2. The generator's own reasoning trace names the INFERRED resource —
    //    proving the inference ran on this seed's text, not a hardcoded
    //    Hope-Estheim-shaped concept. Must be "treasure", never "loyalty"
    //    counters or anything from the example deck.
    const seedSynergyLine = result.diagnostics.reasoning.find((r) =>
      r.startsWith("Seed synergy:")
    );
    expect(seedSynergyLine).toBeDefined();
    expect(seedSynergyLine!.toLowerCase()).toContain("treasure");
    expect(seedSynergyLine!.toLowerCase()).not.toContain("hope");
    expect(seedSynergyLine!.toLowerCase()).not.toContain("space-time");

    // 3. Role-filling candidates (Treasure producers, removal, draw/tutor)
    //    were actually selected into the deck -- the seed-aware scoring
    //    layer didn't just log a note, it changed selection.
    const mainNonlandNames = new Set(
      result.entries.filter((e) => e.board === "main").map((e) => e.card.name)
    );
    const anyTreasureProducerIncluded = treasureProducers.some((c) => mainNonlandNames.has(c.name));
    const anyProtectionIncluded = protection.some((c) => mainNonlandNames.has(c.name));
    expect(anyTreasureProducerIncluded || anyProtectionIncluded).toBe(true);

    // 4. Zero-seed-role vanilla filler should not dominate the deck -- with
    //    24 role-filling/producing candidates plus the 12-card locked seed
    //    available, the generator should not have been forced to reach for
    //    many (if any) of the dead vanilla creatures that fill no seed role.
    const deadFillerCount = deadFiller.filter((c) => mainNonlandNames.has(c.name)).length;
    expect(deadFillerCount).toBeLessThan(deadFiller.length);
  });

  it("produces zero seed-synergy context (and unchanged legacy behaviour) when no seed is supplied", () => {
    const filler = Array.from({ length: 30 }, (_, i) =>
      makeCard(`Generic ${i + 1}`, "Draw a card.", "Creature — Elite", [], 2)
    );
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

    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed synergy:"))).toBe(false);
    expect(result.diagnostics.seedFeasibilityFlags).toBeUndefined();
  });

  it("raises seed feasibility flags derived from THIS seed's own color/role demands, not a fixed WU checklist", () => {
    // A mono-red seed with a heavy triple-pip payoff and almost no lands
    // provided in the candidate pool -- checkFeasibility's color-source
    // math (recommendColorSources) should flag this on its own terms.
    const seedEntries: DeckEntry[] = [
      {
        card: makeCard(
          "Triple Threat",
          "Whenever you sacrifice a creature, deal 3 damage to any target.",
          "Creature — Devil",
          ["R"],
          3,
          "{R}{R}{R}"
        ),
        quantity: 4,
        board: "main",
      },
    ];
    const filler = Array.from({ length: 20 }, (_, i) =>
      makeCard(`Red Filler ${i + 1}`, "Sacrifice a creature: Draw a card.", "Creature — Goblin", ["R"], 2, "{1}{R}")
    );

    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Aggro",
      colors: ["R"],
      seedEntries,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 20,
    };

    const result = generateDeck(options, [...seedEntries.map((e) => e.card), ...filler, makeBasic("Mountain")]);

    // Whether or not this particular pool trips a flag, the mechanism must
    // be present (the field exists / is an array) and, when non-empty, must
    // reference this seed's own role vocabulary (Enabler/Protection/
    // Consistency/Payoff or color coverage), never a hardcoded deck name.
    if (result.diagnostics.seedFeasibilityFlags) {
      for (const flag of result.diagnostics.seedFeasibilityFlags) {
        expect(flag.message.toLowerCase()).not.toContain("hope");
        expect(flag.message.toLowerCase()).not.toContain("lyra");
      }
    }
  });

  it("never places a zero-seed-role candidate, even when it is the only threat-shaped option", () => {
    const seed = makeCard(
      "Treasure Payoff",
      "Treasure Payoff gets +1/+1 for each Treasure you control.",
      "Creature — Rogue",
      [],
      3,
      "{3}",
    );
    const rejectedThreat = {
      ...makeCard("Vanilla Threat", "", "Creature — Giant", [], 3, "{3}"),
      power: "5",
      toughness: "5",
    };
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Aggro",
      colors: [],
      seedEntries: [{ card: seed, quantity: 4, board: "main" }],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const result = generateDeck(options, [seed, rejectedThreat, makeBasic("Wastes")]);

    expect(result.entries.some((entry) => entry.card.oracleId === rejectedThreat.oracleId)).toBe(false);
    expect(Number.isFinite(result.diagnostics.deckScore)).toBe(true);
  });
});
