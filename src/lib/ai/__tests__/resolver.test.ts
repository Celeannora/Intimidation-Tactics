import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import { resolveCardName, resolveCardMatch, resolveLines } from "../resolver";

function makeCard(name: string, overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{R}",
    cmc: 2,
    colorsJson: JSON.stringify(["R"]),
    colorIdentityJson: JSON.stringify(["R"]),
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

const pool = [
  makeCard("Lightning Bolt"),
  makeCard("Lightning Strike"),
  makeCard("Shock"),
  makeCard("Counterspell"),
  makeCard("Fire // Ice", { typeLine: "Instant", layout: "split" }),
];

describe("resolveCardMatch precedence", () => {
  it("matches exact names case-insensitively", () => {
    const m = resolveCardMatch("lightning bolt", pool);
    expect(m?.card.name).toBe("Lightning Bolt");
    expect(m?.matchKind).toBe("exact");
  });

  it("normalizes curly apostrophes and dashes to ascii", () => {
    const withApostrophe = [makeCard("Urza's Saga")];
    const m = resolveCardMatch("Urza\u2019s Saga", withApostrophe);
    expect(m?.card.name).toBe("Urza's Saga");
    expect(m?.matchKind).toBe("exact");
  });

  it("matches the front face of a split/DFC card", () => {
    const m = resolveCardMatch("Fire", pool);
    expect(m?.card.name).toBe("Fire // Ice");
  });
});

describe("fuzzy fallback", () => {
  it("recovers from a single-character typo", () => {
    const m = resolveCardMatch("Lighming Bolt", pool);
    expect(m?.card.name).toBe("Lightning Bolt");
    expect(m?.matchKind).toBe("fuzzy");
    expect(m?.matchDistance).toBeGreaterThan(0);
  });

  it("recovers from a transposition", () => {
    const m = resolveCardMatch("Countersplel", pool);
    expect(m?.card.name).toBe("Counterspell");
    expect(m?.matchKind).toBe("fuzzy");
  });

  it("rejects matches beyond the distance threshold", () => {
    const m = resolveCardMatch("Completely Different Card", pool);
    expect(m).toBeNull();
  });

  it("does not fuzzy-match very short queries", () => {
    // "Sho" is a prefix of Shock, so it resolves via prefix — but a garbled
    // 3-letter token with no prefix/substring hit should not fuzzy-match.
    const m = resolveCardMatch("Xqz", pool);
    expect(m).toBeNull();
  });

  it("rejects ambiguous fuzzy matches with no clear winner", () => {
    const ambiguous = [makeCard("Grizzly Bears"), makeCard("Grizzly Beans")];
    // "Grizzly Beats" is distance 1 from both — ambiguous, should be dropped.
    const m = resolveCardMatch("Grizzly Beats", ambiguous);
    expect(m).toBeNull();
  });
});

describe("prefix/substring ambiguity guards (Fix 3)", () => {
  it("rejects a prefix shorthand that ties between two distinct cards", () => {
    // "sacred cat" and "sacred cow" are equally specific under the prefix "sacred c".
    const cards = [makeCard("Sacred Cat"), makeCard("Sacred Cow")];
    const m = resolveCardMatch("Sacred C", cards);
    expect(m).toBeNull();
  });

  it("still resolves a prefix when one distinct card is clearly more specific", () => {
    // "Lightning Bolt" (len 14) beats "Lightning Strike" (len 16) on specificity
    // by 2 chars — a clear winner, so the prefix tier binds it.
    const cards = [makeCard("Lightning Bolt"), makeCard("Lightning Strike")];
    const m = resolveCardMatch("Lightning B", cards);
    expect(m?.card.name).toBe("Lightning Bolt");
    expect(m?.matchKind).toBe("prefix");
  });

  it("collapses multiple printings of the same card (same oracleId) — not ambiguous", () => {
    // Two DB rows, different printings, SAME oracleId: a real single card.
    const printings = [
      makeCard("Llanowar Elves", { id: "printA", oracleId: "shared-oracle" }),
      makeCard("Llanowar Elves", { id: "printB", oracleId: "shared-oracle" }),
    ];
    const m = resolveCardMatch("Llanow", printings);
    expect(m?.card.oracleId).toBe("shared-oracle");
    expect(m?.matchKind).toBe("prefix");
  });

  it("rejects a substring shorthand that ties between two distinct cards", () => {
    // Both contain "sun" as a substring and are equally specific (13 chars each).
    const cards = [makeCard("Red Sun Blade"), makeCard("Big Sun Blade")];
    const m = resolveCardMatch("sun", cards);
    expect(m).toBeNull();
  });
});

describe("resolveCardName (compat)", () => {
  it("returns the card or null", () => {
    expect(resolveCardName("Shock", pool)?.name).toBe("Shock");
    expect(resolveCardName("Nonexistent Xyz Qqq", pool)).toBeNull();
  });
});

describe("resolveLines", () => {
  it("partitions resolved and unresolved lines and annotates match kind", () => {
    const { resolved, unresolved } = resolveLines(
      [
        { name: "Lightning Bolt", quantity: 4, board: "main" },
        { name: "Lighming Bolt", quantity: 1, board: "main" }, // fuzzy → Lightning Bolt
        { name: "Totally Made Up Card", quantity: 2, board: "side" },
      ],
      pool
    );
    expect(resolved).toHaveLength(2);
    expect(resolved[0].matchKind).toBe("exact");
    expect(resolved[1].matchKind).toBe("fuzzy");
    expect(unresolved).toHaveLength(1);
    expect(unresolved[0].name).toBe("Totally Made Up Card");
  });
});
