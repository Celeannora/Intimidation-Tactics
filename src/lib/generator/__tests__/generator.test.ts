import { describe, expect, it } from "vitest";
import type { CardRecord, ManaColor } from "../../types";
import type { DeckEntry } from "../../legality";
import { generateDeck } from "../generator";
import type { GenerateOptions } from "../types";

function makeCard(
  name: string,
  oracleText: string,
  typeLine = "Creature — Test",
  colors: ManaColor[] = []
): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: colors.length ? "{1}{U}" : "{1}",
    cmc: 2,
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
    ...makeCard(name, "", "Basic Land", []),
    manaCost: "",
    cmc: 0,
  } as CardRecord;
}

describe("generateDeck focus preservation", () => {
  it("keeps every build-around focus card instead of dropping lower-scored cards behind a focus budget", () => {
    const focusCards = Array.from({ length: 24 }, (_, i) =>
      makeCard(`Mill Piece ${i + 1}`, "Target opponent mills two cards.", i % 3 === 0 ? "Sorcery" : "Creature — Horror")
    );
    const focusEntries: DeckEntry[] = focusCards.map((card) => ({ card, quantity: 1, board: "main" }));
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Control",
      colors: [],
      focusEntries,
      keywordFocus: ["Mill"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const result = generateDeck(options, [...focusCards, makeBasic("Wastes")]);
    const focusedIds = new Set(result.focusedCards.map((card) => card.oracleId));

    expect(focusedIds.size).toBe(focusCards.length);
    for (const card of focusCards) expect(focusedIds.has(card.oracleId)).toBe(true);
    expect(result.diagnostics.reasoning).toContain(
      "Focus: preserved 24 unique build-around card(s); no strategy card was dropped by an arbitrary focus budget"
    );
    expect(result.diagnostics.primaryAxes).toContain("mill");
  });

  it("does not inflate imported focus one-ofs into playsets", () => {
    const focusCards = Array.from({ length: 10 }, (_, i) =>
      makeCard(`Focus One-Of ${i + 1}`, "Target opponent mills two cards.", i % 2 === 0 ? "Sorcery" : "Creature — Horror")
    );
    const fillerCards = Array.from({ length: 20 }, (_, i) =>
      makeCard(`Fresh Candidate ${i + 1}`, "Draw a card. Target opponent mills two cards.", i % 2 === 0 ? "Sorcery" : "Instant")
    );
    const focusEntries: DeckEntry[] = focusCards.map((card) => ({ card, quantity: 1, board: "main" }));
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Control",
      colors: [],
      focusEntries,
      keywordFocus: ["Mill"],
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };

    const result = generateDeck(options, [...focusCards, ...fillerCards, makeBasic("Wastes")]);

    for (const card of focusCards) {
      const entry = result.entries.find((e) => e.card.oracleId === card.oracleId);
      expect(entry?.quantity).toBe(1);
    }
    expect(result.entries.some((entry) => entry.card.name.startsWith("Fresh Candidate"))).toBe(true);
  });
});

describe("generateDeck seed quantity policy", () => {
  function makeBombSeed(): CardRecord {
    return {
      ...makeCard("Bomb Seed", "A powerful build-around threat.", "Creature — Test", []),
      gameChanger: 1,
      edhrecRank: 100,
      rarity: "mythic",
    } as CardRecord;
  }

  function makeFillerCards(count: number): CardRecord[] {
    // power "3" at cmc 2 makes these register as the "Beater" threat role
    // (assignRoles requires power >= 3 && cmc <= 3), so fillRole actually
    // places them into the deck instead of leaving every role slot empty.
    return Array.from({ length: count }, (_, i) =>
      ({
        ...makeCard(
          `Filler ${i + 1}`,
          // Beater by stats (power>=3, cmc<=3), but also carries a genuine
          // card-draw clause so post-synergy-review classifySeedRoles()
          // (which hard-vetoes any candidate filling zero seed roles, see
          // seedSynergy.ts) grants it "Consistency" and it stays eligible
          // as a strong-preference promotion donor instead of being
          // excluded from the candidate pool entirely.
          "A vanilla creature. Whenever this creature deals combat damage to a player, draw a card.",
          "Creature — Test",
          []
        ),
        gameChanger: 0,
        edhrecRank: 20000,
        rarity: "common",
        power: "3",
        toughness: "3",
      } as CardRecord)
    );
  }

  function baseOptions(seedEntries: DeckEntry[], seedPolicy?: GenerateOptions["seedPolicy"]): GenerateOptions {
    return {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      seedEntries,
      seedPolicy,
      mainboardSize: 60,
      maxMainboardSize: 60,
      optimizationIterations: 0,
    };
  }

  it("locked-core (default): a seed never gains extra copies, even when it scores far above everything else", () => {
    const bomb = makeBombSeed();
    const filler = makeFillerCards(30);
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 1, board: "main" }];
    const options = baseOptions(seedEntries); // no seedPolicy -> defaults to locked-core

    const result = generateDeck(options, [bomb, ...filler, makeBasic("Wastes")]);

    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);
    expect(bombEntry?.quantity).toBe(1);
    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed promotion"))).toBe(false);
  });

  // A card that satisfies TWO role slots at once (here: threats + cardDraw)
  // gets placed by whichever role's fillRole call runs first (threats, per
  // ROLE_ORDER), but its copies count toward BOTH roles' live totals. The
  // other role's own fillRole call still fills up to ITS FULL target with
  // no idea that some of its need was already met -- so the deck ends up
  // with genuine surplus above that role's target. This is exactly how
  // real decks (many overlapping-role cards) end up above their archetype
  // targets; a plain single-role filler pool can never do this (Phase 1's
  // fillRole always stops at EXACTLY the target when enough candidates
  // exist, so a same-role donor pool alone has zero headroom under the
  // new role floor -- surplus has to come from a genuinely different
  // source, same as it would in the real generator).
  function makeDualRoleThreatDrawer(): CardRecord {
    return {
      ...makeCard(
        "Dual Beater Drawer",
        "When this creature enters the battlefield, draw a card.",  // singular: matches the CANTRIP_HINT/CardDraw seed-role hint (see seedSynergy.ts), avoiding the zero-seed-role hard veto
        "Creature — Test",
        []
      ),
      gameChanger: 0,
      edhrecRank: 50, // best score among threat candidates -> reliably picked
      rarity: "rare",
      power: "3",
      toughness: "3",
    } as CardRecord;
  }

  function makeCardDrawOnlyFillers(count: number): CardRecord[] {
    // Non-creature, so these never touch the "threats" role -- they only
    // ever count toward cardDraw, and score far worse than every other
    // filler in these tests so they donate first.
    return Array.from({ length: count }, (_, i) =>
      ({
        ...makeCard(`Draw Filler ${i + 1}`, "Draw a card.", "Sorcery", []),  // singular: matches the seed-role Consistency hint, avoiding the zero-seed-role hard veto
        gameChanger: 0,
        edhrecRank: 90000,
        rarity: "common",
        cmc: 3,
      } as CardRecord)
    );
  }

  it("strong-preference: promotes a high-scoring seed above its imported quantity, funded by the weakest unlocked filler", () => {
    const bomb = makeBombSeed();
    const filler = makeFillerCards(30);
    const dualCard = makeDualRoleThreatDrawer();
    const drawFillers = makeCardDrawOnlyFillers(8);
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 1, board: "main" }];
    const options = baseOptions(seedEntries, "strong-preference");

    const result = generateDeck(options, [bomb, dualCard, ...filler, ...drawFillers, makeBasic("Wastes")]);

    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);
    expect(bombEntry?.quantity).toBeGreaterThan(1);
    expect(bombEntry?.quantity).toBeLessThanOrEqual(4);
    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed promotion (strong-preference)"))).toBe(true);

    // Total nonland copy count must stay conserved -- promotion trades
    // copies, it never inflates the deck.
    const nonlandTotal = result.entries
      .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
      .reduce((sum, e) => sum + e.quantity, 0);
    expect(nonlandTotal).toBe(options.mainboardSize! - result.entries.filter((e) => e.card.typeLine.includes("Land")).reduce((s, e) => s + e.quantity, 0));
  });

  it("locked-core: a large mostly-singleton seed pool is neither redistributed (copy consolidation) nor allowed to starve the real land budget down to the absolute floor", () => {
    // Reproduces the reported bug: blending two decklists produces a seed pool
    // that is mostly 1-ofs plus a couple of higher-count entries -- exactly
    // the shape a union of two decklists produces. The old code
    // unconditionally ran a "copy consolidation" pass whenever >50% of seeds
    // were singletons -- regardless of seed policy -- cutting the low-scored
    // multi-copy entries down and promoting high-scored singletons up,
    // silently overriding the exact quantities the user imported. This pool
    // is deliberately kept well under both the old and new nonland budgets so
    // the (legitimate, policy-independent) overflow guard never has to shed
    // anything -- isolating the consolidation-pass bug specifically.
    const topCards = Array.from({ length: 9 }, (_, i) =>
      ({
        ...makeCard(`Blend Top ${i + 1}`, "A powerful build-around threat.", "Creature — Test", []),
        gameChanger: 1,
        edhrecRank: 50,
        rarity: "mythic",
        power: "3",
        toughness: "3",
      } as CardRecord)
    );
    const midCards = Array.from({ length: 6 }, (_, i) =>
      ({
        ...makeCard(
          `Blend Mid ${i + 1}`,
          "Whenever this creature deals combat damage to a player, draw a card.",
          "Creature — Test",
          []
        ),
        gameChanger: 0,
        edhrecRank: 15000,
        rarity: "common",
        power: "3",
        toughness: "3",
      } as CardRecord)
    );
    const donorCards = Array.from({ length: 2 }, (_, i) =>
      ({
        ...makeCard(
          `Blend Donor ${i + 1}`,
          "Whenever this creature deals combat damage to a player, draw a card.",
          "Creature — Test",
          []
        ),
        gameChanger: 0,
        edhrecRank: 90000, // worst score -> the pass would shed these first to fund promotions
        rarity: "common",
        power: "3",
        toughness: "3",
      } as CardRecord)
    );
    const importedQuantities = new Map<string, number>([
      ...topCards.map((c) => [c.oracleId, 1] as const),
      ...midCards.map((c) => [c.oracleId, 1] as const),
      ...donorCards.map((c) => [c.oracleId, 3] as const), // multi-copy entries -> the singleton ratio (15/17) still clears 50%
    ]);
    const seedEntries: DeckEntry[] = [...topCards, ...midCards, ...donorCards].map((card) => ({
      card,
      quantity: importedQuantities.get(card.oracleId)!,
      board: "main",
    }));
    const options = baseOptions(seedEntries); // no seedPolicy -> defaults to locked-core

    const result = generateDeck(options, [...topCards, ...midCards, ...donorCards, makeBasic("Wastes")]);

    // Every seed must stay at EXACTLY the quantity it was imported with --
    // no promotion of the top-scored singletons, no cutting the donors down.
    for (const [oracleId, importedQty] of importedQuantities) {
      const entry = result.entries.find((e) => e.card.oracleId === oracleId);
      expect(entry?.quantity).toBe(importedQty);
    }
    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed consolidation"))).toBe(false);
    expect(result.diagnostics.reasoning.some((r) => r.startsWith("Seed promotion"))).toBe(false);
  });

  it("locked-core: when the seed pool overflows the deck size, a per-card quantity-locked seed is shed AFTER flexible seeds, not before", () => {
    // Per-card "lock quantity" toggle (DeckEntry.quantityLocked): when the
    // overflow guard must free room, flexible-quantity seeds absorb the cut
    // first (down to floor 1, then removed entirely as a last resort) --
    // a quantity-locked seed only gives ground once every flexible entry is
    // already at that floor.
    const flexibleCards = Array.from({ length: 10 }, (_, i) =>
      ({
        ...makeCard(`Flex Filler ${i + 1}`, "A vanilla test creature.", "Creature — Test", []),
        edhrecRank: 100 + i,
        rarity: "uncommon",
        power: "2",
        toughness: "2",
      } as CardRecord)
    );
    const pinnedCard = {
      ...makeCard("Pinned Combo Piece", "A vanilla test creature.", "Creature — Test", []),
      edhrecRank: 500000, // worst score of the pool -- would be shed FIRST under plain score-order
      rarity: "common",
      power: "1",
      toughness: "1",
    } as CardRecord;

    const seedEntries: DeckEntry[] = [
      ...flexibleCards.map((card) => ({ card, quantity: 4, board: "main" as const })),
      { card: pinnedCard, quantity: 4, board: "main" as const, quantityLocked: true },
    ];
    // 11 cards * 4 copies = 44 nonland seed copies, well above the real
    // land-aware budget (60 - ~23 recommended lands ≈ 37), so the overflow
    // guard MUST shed something despite every entry starting above floor 1.
    const options = baseOptions(seedEntries);

    const result = generateDeck(options, [...flexibleCards, pinnedCard, makeBasic("Wastes")]);

    const pinnedEntry = result.entries.find((e) => e.card.oracleId === pinnedCard.oracleId);
    // The pinned card's worst-in-pool score would make it the FIRST thing a
    // plain score-ordered shed touches -- confirm it was protected instead.
    expect(pinnedEntry?.quantity).toBe(4);

    const flexTotal = flexibleCards.reduce((sum, card) => {
      const e = result.entries.find((entry) => entry.card.oracleId === card.oracleId);
      return sum + (e?.quantity ?? 0);
    }, 0);
    // Flexible seeds collectively absorbed the entire cut instead.
    expect(flexTotal).toBeLessThan(10 * 4);

    // And the mana base still reaches a healthy count -- not starved by
    // locked seeds consuming the whole nonland budget.
    const landTotal = result.entries
      .filter((e) => e.card.typeLine.includes("Land"))
      .reduce((sum, e) => sum + e.quantity, 0);
    expect(landTotal).toBeGreaterThanOrEqual(18);
  });

  it("strong-preference: a legendary seed is NOT capped at 2 copies -- the legend rule only restricts the battlefield, not deck construction", () => {
    const legendarySeed = {
      ...makeBombSeed(),
      name: "Legendary Bomb Seed",
      oracleId: "Legendary Bomb Seed",
      id: "Legendary Bomb Seed",
      typeLine: "Legendary Creature — Test",
    } as CardRecord;
    const filler = makeFillerCards(30);
    const dualCard = makeDualRoleThreatDrawer();
    const drawFillers = makeCardDrawOnlyFillers(8);
    const seedEntries: DeckEntry[] = [{ card: legendarySeed, quantity: 1, board: "main" }];
    const options = baseOptions(seedEntries, "strong-preference");

    const result = generateDeck(options, [legendarySeed, dualCard, ...filler, ...drawFillers, makeBasic("Wastes")]);

    const seedEntry = result.entries.find((e) => e.card.oracleId === legendarySeed.oracleId);
    // Same role-based cap as a non-legendary card of the same shape (generic -> up to 3),
    // never artificially clamped to 2 just for being Legendary.
    expect(seedEntry?.quantity).toBeGreaterThan(1);
    expect(seedEntry?.quantity).toBeLessThanOrEqual(4);
  });

  it("strong-preference: never drops a seed below the quantity it was imported with", () => {
    const bomb = makeBombSeed();
    // Seed imported at 2 copies already -- strong-preference must never reduce this.
    const filler = makeFillerCards(30);
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 2, board: "main" }];
    const options = baseOptions(seedEntries, "strong-preference");

    const result = generateDeck(options, [bomb, ...filler, makeBasic("Wastes")]);

    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);
    expect(bombEntry?.quantity).toBeGreaterThanOrEqual(2);
  });

  it("strong-preference: never drains a control role (e.g. counterspells) below its archetype target to fund a seed's promotion", () => {
    const bomb = makeBombSeed(); // non-creature-threat role, doesn't compete for the counterspells slot
    const counterspell = {
      ...makeCard("Lone Counterspell", "Counter target spell.", "Instant", []),
      gameChanger: 0,
      edhrecRank: 5000,
      rarity: "uncommon",
    } as CardRecord;
    const seedEntries: DeckEntry[] = [{ card: bomb, quantity: 1, board: "main" }];
    const options: GenerateOptions = {
      ...baseOptions(seedEntries, "strong-preference"),
      // Only counterspell candidates exist in the pool, so Phase 1 fills
      // exactly to this target (2 copies) and nothing else competes for
      // donor slots -- an unambiguous "donor sits exactly at target" case.
      roleTargetOverrides: { counterspells: 2 },
    };

    const result = generateDeck(options, [bomb, counterspell, makeBasic("Wastes")]);

    const donorEntry = result.entries.find((e) => e.card.oracleId === counterspell.oracleId);
    const bombEntry = result.entries.find((e) => e.card.oracleId === bomb.oracleId);

    // The donor started at (and was filled to) exactly the counterspells
    // target -- donating even one copy would drop the deck's only
    // interaction category below what the archetype calls for, so the
    // role floor must refuse the donation entirely.
    expect(donorEntry?.quantity).toBe(2);
    expect(bombEntry?.quantity).toBe(1); // seed's promotion request went unfunded
    expect(
      result.diagnostics.reasoning.some(
        (r) => r.startsWith("Seed promotion role floor") && r.includes("counterspells")
      )
    ).toBe(true);
  });
});