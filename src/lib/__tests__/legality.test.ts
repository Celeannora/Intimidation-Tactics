import { describe, it, expect } from "vitest";
import { validateDeck, BASIC_LAND_NAMES, allowsAnyNumberOfCopies, maxCopiesForCard } from "../legality";
import type { DeckEntry } from "../legality";
import type { CardRecord } from "../types";

// ─── helpers ────────────────────────────────────────────────────────────────

function makeCard(overrides: Partial<CardRecord>): CardRecord {
  return {
    id: overrides.id ?? "id-" + Math.random(),
    oracleId: overrides.oracleId ?? "oid-" + Math.random(),
    name: overrides.name ?? "Test Card",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: overrides.manaCost ?? "{1}",
    cmc: overrides.cmc ?? 1,
    colorsJson: overrides.colorsJson ?? "[]",
    colorIdentityJson: overrides.colorIdentityJson ?? "[]",
    typeLine: overrides.typeLine ?? "Creature — Human",
    oracleText: overrides.oracleText ?? null,
    keywordsJson: overrides.keywordsJson ?? "[]",
    power: overrides.power ?? "1",
    toughness: overrides.toughness ?? "1",
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: overrides.legalityStandard ?? "legal",
    legalityFuture: null,
    bannedInStandard: overrides.bannedInStandard ?? 0,
    setCode: "mid",
    setName: "Test Set",
    setType: "expansion",
    collectorNumber: "1",
    rarity: "common",
    imageNormal: null,
    priceUsd: null,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: null,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "",
    importedAt: new Date().toISOString(),
    ...overrides,
  };
}

function nCopies(card: CardRecord, n: number, board: "main" | "side" = "main"): DeckEntry {
  return { card, quantity: n, board };
}

function fill60(_baseCard: CardRecord, _overrides: Partial<DeckEntry>[] = []): DeckEntry[] {
  const base: DeckEntry[] = Array.from({ length: 15 }, (_, i) =>
    nCopies(makeCard({ oracleId: `filler-${i}`, name: `Filler ${i}` }), 4)
  );
  return base; // 60 cards
}

// ─── EDGE CASES ─────────────────────────────────────────────────────────────

describe("Legality Engine — 50 Edge Cases", () => {

  // ── 1. Exactly 60 cards is legal ──────────────────────────────────────────
  it("EC-01: exactly 60 mainboard cards passes MIN_60", () => {
    const deck = fill60(makeCard({}));
    const result = validateDeck(deck);
    const hasMin = result.violations.some(v => v.rule === "MIN_60");
    expect(hasMin).toBe(false);
  });

  // ── 2. 59 cards triggers MIN_60 ───────────────────────────────────────────
  it("EC-02: 59 mainboard cards triggers MIN_60", () => {
    // Build an explicit 59-card deck
    const deck59: DeckEntry[] = Array.from({ length: 14 }, (_, i) =>
      nCopies(makeCard({ oracleId: `c${i}` }), 4)
    );
    deck59.push(nCopies(makeCard({ oracleId: "c14" }), 3));
    const result = validateDeck(deck59);
    expect(result.violations.some(v => v.rule === "MIN_60")).toBe(true);
  });

  // ── 3. 4 copies of same card is legal ────────────────────────────────────
  it("EC-03: 4 copies of a non-basic passes MAX_COPIES", () => {
    const card = makeCard({ oracleId: "unique-1", name: "Bolt" });
    const main: DeckEntry[] = [
      nCopies(card, 4),
      ...Array.from({ length: 14 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(false);
  });

  // ── 4. 5 copies of same card triggers MAX_COPIES ─────────────────────────
  it("EC-04: 5 copies of a non-basic triggers MAX_COPIES", () => {
    const card = makeCard({ oracleId: "unique-1", name: "Bolt" });
    const main: DeckEntry[] = [
      nCopies(card, 5),
      ...Array.from({ length: 13 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
      nCopies(makeCard({ oracleId: "f13" }), 3),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(true);
  });

  // ── 5. Basic lands allow >4 copies ───────────────────────────────────────
  it("EC-05: 24 copies of Island (basic) passes MAX_COPIES", () => {
    const island = makeCard({ oracleId: "island-id", name: "Island", typeLine: "Basic Land — Island" });
    const main: DeckEntry[] = [
      nCopies(island, 24),
      ...Array.from({ length: 9 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(false);
  });

  // ── 6. All 5 basic land names are recognised ──────────────────────────────
  it("EC-06: all 5 basic land names are in BASIC_LAND_NAMES", () => {
    ["Plains", "Island", "Swamp", "Mountain", "Forest"].forEach(name => {
      expect(BASIC_LAND_NAMES.has(name)).toBe(true);
    });
  });

  // ── 7. Wastes (colourless basic) is in BASIC_LAND_NAMES ───────────────────
  it("EC-07: Wastes is treated as a basic land", () => {
    expect(BASIC_LAND_NAMES.has("Wastes")).toBe(true);
  });

  // ── 8. Sideboard of exactly 15 is legal ──────────────────────────────────
  it("EC-08: sideboard exactly 15 passes SIDE_SIZE", () => {
    const main = fill60(makeCard({}));
    const side: DeckEntry[] = Array.from({ length: 15 }, (_, i) =>
      nCopies(makeCard({ oracleId: `s${i}` }), 1, "side")
    );
    const result = validateDeck([...main, ...side]);
    expect(result.violations.some(v => v.rule === "SIDE_SIZE")).toBe(false);
  });

  // ── 9. Sideboard of 14 triggers SIDE_SIZE ────────────────────────────────
  it("EC-09: sideboard of 14 triggers SIDE_SIZE", () => {
    const main = fill60(makeCard({}));
    const side: DeckEntry[] = Array.from({ length: 14 }, (_, i) =>
      nCopies(makeCard({ oracleId: `s${i}` }), 1, "side")
    );
    const result = validateDeck([...main, ...side]);
    expect(result.violations.some(v => v.rule === "SIDE_SIZE")).toBe(true);
  });

  // ── 10. Sideboard of 0 is also valid (empty sideboard allowed) ────────────
  it("EC-10: empty sideboard (0) passes SIDE_SIZE", () => {
    const main = fill60(makeCard({}));
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "SIDE_SIZE")).toBe(false);
  });

  // ── 11. Sideboard of 16 triggers SIDE_SIZE ───────────────────────────────
  it("EC-11: sideboard of 16 triggers SIDE_SIZE", () => {
    const main = fill60(makeCard({}));
    const side: DeckEntry[] = Array.from({ length: 16 }, (_, i) =>
      nCopies(makeCard({ oracleId: `s${i}` }), 1, "side")
    );
    const result = validateDeck([...main, ...side]);
    expect(result.violations.some(v => v.rule === "SIDE_SIZE")).toBe(true);
  });

  // ── 12. Banned card triggers BANNED violation ─────────────────────────────
  it("EC-12: banned card in mainboard triggers BANNED", () => {
    const banned = makeCard({ oracleId: "ban-1", name: "BannedCard", bannedInStandard: 1, legalityStandard: "banned" });
    const main: DeckEntry[] = [
      nCopies(banned, 4),
      ...Array.from({ length: 14 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "BANNED")).toBe(true);
  });

  // ── 13. Banned card in sideboard also triggers BANNED ─────────────────────
  it("EC-13: banned card in sideboard triggers BANNED", () => {
    const main = fill60(makeCard({}));
    const banned = makeCard({ oracleId: "ban-2", name: "BannedSide", bannedInStandard: 1, legalityStandard: "banned" });
    const result = validateDeck([...main, nCopies(banned, 1, "side")]);
    expect(result.violations.some(v => v.rule === "BANNED")).toBe(true);
  });

  // ── 14. Not-legal card (non-standard) triggers NOT_LEGAL ──────────────────
  it("EC-14: non-standard card triggers NOT_LEGAL", () => {
    const illegal = makeCard({ oracleId: "old-1", name: "AncientCard", legalityStandard: "not_legal" });
    const main: DeckEntry[] = [
      nCopies(illegal, 4),
      ...Array.from({ length: 14 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "NOT_LEGAL")).toBe(true);
  });

  // ── 15. MAX_COPIES counts across split entries with same oracleId ──────────
  it("EC-15: two entries with same oracleId sum their quantities for MAX_COPIES", () => {
    const card = makeCard({ oracleId: "split-oid" });
    const main: DeckEntry[] = [
      nCopies(card, 3),
      nCopies({ ...card }, 2), // same oracleId, 5 total
      ...Array.from({ length: 13 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
      nCopies(makeCard({ oracleId: "f13" }), 3),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(true);
  });

  // ── 16. Legal deck returns legal: true ───────────────────────────────────
  it("EC-16: a legal 60-card deck returns legal: true", () => {
    const main = fill60(makeCard({}));
    const result = validateDeck(main);
    expect(result.legal).toBe(true);
  });

  // ── 17. mainCount counts only mainboard entries ───────────────────────────
  it("EC-17: mainCount reflects only mainboard quantities", () => {
    const main = fill60(makeCard({})); // 60
    const side: DeckEntry[] = Array.from({ length: 15 }, (_, i) =>
      nCopies(makeCard({ oracleId: `s${i}` }), 1, "side")
    );
    const result = validateDeck([...main, ...side]);
    expect(result.mainCount).toBe(60);
    expect(result.sideCount).toBe(15);
  });

  // ── 18. multiple violations accumulate ───────────────────────────────────
  it("EC-18: deck with <60 cards AND a banned card accumulates multiple violations", () => {
    const banned = makeCard({ oracleId: "b1", bannedInStandard: 1, legalityStandard: "banned" });
    const result = validateDeck([nCopies(banned, 1)]);
    expect(result.violations.length).toBeGreaterThanOrEqual(2);
  });

  // ── 19. Exact violation message includes card name ────────────────────────
  it("EC-19: BANNED violation message includes card name", () => {
    const banned = makeCard({ oracleId: "b2", name: "ForbiddenOne", bannedInStandard: 1, legalityStandard: "banned" });
    const main = fill60(makeCard({}));
    const result = validateDeck([...main.slice(0, -1), nCopies(banned, 4)]);
    const bannedViolation = result.violations.find(v => v.rule === "BANNED");
    expect(bannedViolation?.message).toContain("ForbiddenOne");
  });

  // ── 20. Exactly 61 mainboard cards triggers OVER_60 warning ──────────────
  it("EC-20: 61 mainboard cards triggers OVER_60 warning", () => {
    const main: DeckEntry[] = [
      ...Array.from({ length: 15 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
      nCopies(makeCard({ oracleId: "extra" }), 1),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "OVER_60")).toBe(true);
  });

  // ── 21. "A deck can have any number" card: >4 copies passes MAX_COPIES ────
  it("EC-21: 20 copies of Rat Colony (any-number oracle text) passes MAX_COPIES", () => {
    const rat = makeCard({
      oracleId: "rat-colony",
      name: "Rat Colony",
      oracleText: "A deck can have any number of cards named Rat Colony.",
    });
    const main: DeckEntry[] = [
      nCopies(rat, 20),
      ...Array.from({ length: 10 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(false);
  });

  // ── 22. Normal non-basic with 5 copies still fails even with other any-number cards in deck
  it("EC-22: 5 copies of a normal card still triggers MAX_COPIES even when any-number card is also present", () => {
    const rat = makeCard({
      oracleId: "rat-colony",
      name: "Rat Colony",
      oracleText: "A deck can have any number of cards named Rat Colony.",
    });
    const bolt = makeCard({ oracleId: "bolt", name: "Bolt" });
    const main: DeckEntry[] = [
      nCopies(rat, 10),
      nCopies(bolt, 5),
      ...Array.from({ length: 11 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
      nCopies(makeCard({ oracleId: "f11" }), 1),
    ];
    const result = validateDeck(main);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(true);
    expect(result.violations.find(v => v.rule === "MAX_COPIES")?.cardNames).toContain("Bolt");
  });

  // ── 23. allowsAnyNumberOfCopies returns true for "any number" oracle text ─
  it("EC-23: allowsAnyNumberOfCopies returns true for 'any number of cards named' oracle text", () => {
    const card = makeCard({ oracleText: "A deck can have any number of cards named Dragon's Approach." });
    expect(allowsAnyNumberOfCopies(card)).toBe(true);
  });

  // ── 24. allowsAnyNumberOfCopies returns false for normal cards ────────────
  it("EC-24: allowsAnyNumberOfCopies returns false for a normal non-basic card", () => {
    const card = makeCard({ oracleText: "Destroy target creature." });
    expect(allowsAnyNumberOfCopies(card)).toBe(false);
  });

  // ── 25. maxCopiesForCard returns 99 for basics ────────────────────────────
  it("EC-25: maxCopiesForCard returns 99 for Island", () => {
    const island = makeCard({ name: "Island" });
    expect(maxCopiesForCard(island)).toBe(99);
  });

  // ── 26. maxCopiesForCard returns 99 for any-number cards ─────────────────
  it("EC-26: maxCopiesForCard returns 99 for a card with 'any number of cards named' text", () => {
    const petitioners = makeCard({
      name: "Persistent Petitioners",
      oracleText: "A deck can have any number of cards named Persistent Petitioners.",
    });
    expect(maxCopiesForCard(petitioners)).toBe(99);
  });

  // ── 27. maxCopiesForCard returns 4 for normal non-basic ───────────────────
  it("EC-27: maxCopiesForCard returns 4 for a normal non-basic card", () => {
    const card = makeCard({ oracleText: null });
    expect(maxCopiesForCard(card)).toBe(4);
  });

  // ── 28. "any number" card: split entries across main+side also allowed ────
  it("EC-28: split entries of any-number card across boards do not trigger MAX_COPIES", () => {
    const rat = makeCard({
      oracleId: "rat-colony",
      name: "Rat Colony",
      oracleText: "A deck can have any number of cards named Rat Colony.",
    });
    const main: DeckEntry[] = [
      nCopies(rat, 20),
      ...Array.from({ length: 10 }, (_, i) =>
        nCopies(makeCard({ oracleId: `f${i}` }), 4)
      ),
    ];
    const side: DeckEntry[] = [nCopies({ ...rat }, 5, "side")];
    const result = validateDeck([...main, ...side]);
    expect(result.violations.some(v => v.rule === "MAX_COPIES")).toBe(false);
  });
});

// ─── Vintage restricted list (maxCopiesForCard) ───────────────────────────────

describe("Vintage restricted-list max copies", () => {
  const restricted = makeCard({
    oracleId: "black-lotus",
    name: "Black Lotus",
    legalitiesJson: JSON.stringify({ vintage: "restricted", legacy: "banned" }),
  });
  const vintageLegal = makeCard({
    oracleId: "swords",
    name: "Swords to Plowshares",
    legalitiesJson: JSON.stringify({ vintage: "legal" }),
  });

  it("caps a Vintage-restricted card at exactly 1 copy", () => {
    expect(maxCopiesForCard(restricted, "vintage")).toBe(1);
  });

  it("leaves a non-restricted Vintage-legal card at the blanket 4-of cap", () => {
    expect(maxCopiesForCard(vintageLegal, "vintage")).toBe(4);
  });

  it("does not apply the restricted cap in a non-restricted-aware format (Standard)", () => {
    // Same card, but Standard's rules row is not restrictedListAware, so the
    // blanket 4-of cap applies rather than the Vintage 1-of restriction.
    expect(maxCopiesForCard(restricted, "standard")).toBe(4);
  });

  it("passes validation at 1 copy but flags MAX_COPIES at 2 copies in Vintage", () => {
    const fillers = (n: number) =>
      Array.from({ length: n }, (_, i) =>
        nCopies(makeCard({ oracleId: `vf${i}`, legalitiesJson: JSON.stringify({ vintage: "legal" }) }), 4)
      );

    // 1 restricted + 59 legal fillers (total 60): no MAX_COPIES violation.
    const okDeck: DeckEntry[] = [
      nCopies(restricted, 1),
      ...fillers(14),
      nCopies(makeCard({ oracleId: "vf14", legalitiesJson: JSON.stringify({ vintage: "legal" }) }), 3),
    ];
    const okResult = validateDeck(okDeck, "vintage");
    expect(okResult.violations.some(v => v.rule === "MAX_COPIES")).toBe(false);

    // 2 copies of the restricted card: over the 1-of restricted cap.
    const badDeck: DeckEntry[] = [
      nCopies(restricted, 2),
      ...fillers(14),
      nCopies(makeCard({ oracleId: "vf14", legalitiesJson: JSON.stringify({ vintage: "legal" }) }), 2),
    ];
    const badResult = validateDeck(badDeck, "vintage");
    expect(badResult.violations.some(v => v.rule === "MAX_COPIES")).toBe(true);
    expect(badResult.violations.find(v => v.rule === "MAX_COPIES")?.cardNames).toContain("Black Lotus");
  });
});
