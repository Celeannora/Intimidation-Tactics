import { describe, expect, it, vi } from "vitest";
import { searchCards, getCardById, getAllKeywords, getStandardSets } from "../search";
import type { CardRecord } from "../types";

// ---------------------------------------------------------------------------
// Mock db so tests don't need a real IndexedDB environment
// ---------------------------------------------------------------------------

const { standardCards, legalCards } = vi.hoisted(() => {
  // Inline a minimal card factory because vi.hoisted runs before module scope.
  const make = (overrides: Partial<CardRecord> = {}): CardRecord => ({
    id: "card-1",
    oracleId: "oid-card-1",
    name: "Test Creature",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    typeLine: "Creature — Human Warrior",
    oracleText: "When ~ enters, draw a card.",
    flavorText: null,
    cmc: 2,
    colorsJson: JSON.stringify(["W"]),
    colorIdentityJson: JSON.stringify(["W"]),
    manaCost: "{1}{W}",
    keywordsJson: JSON.stringify(["First strike"]),
    power: "2",
    toughness: "1",
    loyalty: null,
    producedManaJson: "[]",
    rarity: "common",
    setCode: "mid",
    setName: "Innistrad: Midnight Hunt",
    setType: "expansion",
    collectorNumber: "001",
    imageNormal: null,
    priceUsd: 0.5,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: 1000,
    gameChanger: 0,
    legalityStandard: "legal",
    legalityFuture: "legal",
    bannedInStandard: 0,
    artist: null,
    searchText: "",
    importedAt: new Date().toISOString(),
    ...overrides,
  });
  const cards: CardRecord[] = [
    make({ id: "c1", name: "Adeline", setCode: "mid", cmc: 3, rarity: "rare", colorsJson: JSON.stringify(["W"]), keywordsJson: JSON.stringify(["Vigilance", "First strike"]), priceUsd: 2 }),
    make({ id: "c2", name: "Burn Down the House", typeLine: "Sorcery", setCode: "vow", cmc: 5, rarity: "rare", colorsJson: JSON.stringify(["R"]), keywordsJson: JSON.stringify([]), priceUsd: 1 }),
    make({ id: "c3", name: "Colorless Rock", typeLine: "Artifact", setCode: "neo", cmc: 2, rarity: "uncommon", colorsJson: JSON.stringify([]), keywordsJson: JSON.stringify([]), priceUsd: 0.25 }),
    make({ id: "c4", name: "Mystical Archive", typeLine: "Instant", setCode: "stx", cmc: 1, rarity: "mythic", colorsJson: JSON.stringify(["U"]), keywordsJson: JSON.stringify(["Flash"]), priceUsd: 15 }),
    make({ id: "c5", name: "Future Card", setCode: "xyz", cmc: 3, rarity: "common", colorsJson: JSON.stringify(["G"]), keywordsJson: JSON.stringify([]), priceUsd: null, legalityStandard: "not_legal", legalityFuture: "legal" }),
  ];
  return { standardCards: cards, legalCards: cards.filter((c) => c.legalityStandard === "legal") };
});

vi.mock("../db", () => {
  const makeQuery = (index: string, val: string) => ({
    toArray: async () =>
      standardCards.filter((c) =>
        index === "legalityFuture" ? c.legalityFuture === val : c.legalityStandard === val
      ),
    filter: (fn: (c: CardRecord) => boolean) => ({
      toArray: async () =>
        standardCards.filter((c) => {
          const matches =
            index === "legalityFuture" ? c.legalityFuture === val : c.legalityStandard === val;
          return matches && fn(c);
        }),
    }),
  });

  return {
    db: {
      cards: {
        where: (index: string) => ({ equals: (val: string) => makeQuery(index, val) }),
        get: async (id: string) => standardCards.find((c) => c.id === id),
        toArray: async () => standardCards,
      },
    },
  };
});

// ---------------------------------------------------------------------------
// searchCards
// ---------------------------------------------------------------------------

describe("searchCards — text filter", () => {
  it("returns cards matching name", async () => {
    const { cards } = await searchCards({ text: "adeline" });
    expect(cards.map((c) => c.id)).toContain("c1");
  });

  it("returns cards matching oracle text", async () => {
    const { cards } = await searchCards({ text: "draw a card" });
    expect(cards.length).toBeGreaterThan(0);
  });

  it("returns cards matching type line", async () => {
    const { cards } = await searchCards({ text: "Sorcery" });
    expect(cards.map((c) => c.id)).toContain("c2");
  });

  it("returns nothing for unmatched text", async () => {
    const { cards } = await searchCards({ text: "xyzzy_no_match" });
    expect(cards).toHaveLength(0);
  });
});

describe("searchCards — color filters", () => {
  it("includes mode: all selected colors present", async () => {
    const { cards } = await searchCards({ colors: ["W"], colorMode: "includes" });
    expect(cards.every((c) => JSON.parse(c.colorsJson).includes("W"))).toBe(true);
  });

  it("exactly mode: only exact color identity", async () => {
    const { cards } = await searchCards({ colors: ["W"], colorMode: "exactly" });
    expect(cards.every((c) => {
      const cc = JSON.parse(c.colorsJson);
      return cc.length === 1 && cc.includes("W");
    })).toBe(true);
  });

  it("atMost mode: card colors are a subset of filter", async () => {
    const { cards } = await searchCards({ colors: ["W", "U"], colorMode: "atMost" });
    expect(cards.every((c) => {
      const cc = JSON.parse(c.colorsJson) as string[];
      return cc.every((col) => ["W", "U"].includes(col));
    })).toBe(true);
  });

  it("colorless filter returns only colorless cards", async () => {
    const { cards } = await searchCards({ colorless: true });
    expect(cards.every((c) => JSON.parse(c.colorsJson).length === 0)).toBe(true);
  });
});

describe("searchCards — CMC filters", () => {
  it("cmcMin excludes lower-cost cards", async () => {
    const { cards } = await searchCards({ cmcMin: 3 });
    expect(cards.every((c) => c.cmc >= 3)).toBe(true);
  });

  it("cmcMax excludes higher-cost cards", async () => {
    const { cards } = await searchCards({ cmcMax: 2 });
    expect(cards.every((c) => c.cmc <= 2)).toBe(true);
  });

  it("cmcMin + cmcMax together narrow the range", async () => {
    const { cards } = await searchCards({ cmcMin: 2, cmcMax: 3 });
    expect(cards.every((c) => c.cmc >= 2 && c.cmc <= 3)).toBe(true);
  });
});

describe("searchCards — rarity filter", () => {
  it("filters to selected rarities", async () => {
    const { cards } = await searchCards({ rarities: ["rare"] });
    expect(cards.every((c) => c.rarity === "rare")).toBe(true);
  });

  it("multiple rarities work as OR", async () => {
    const { cards } = await searchCards({ rarities: ["common", "uncommon"] });
    expect(cards.every((c) => ["common", "uncommon"].includes(c.rarity ?? ""))).toBe(true);
  });
});

describe("searchCards — set filter", () => {
  it("returns only cards from the specified set", async () => {
    const { cards } = await searchCards({ sets: ["mid"] });
    expect(cards.every((c) => c.setCode === "mid")).toBe(true);
  });
});

describe("searchCards — keyword filter", () => {
  it("returns cards that have all specified keywords", async () => {
    const { cards } = await searchCards({ keywords: ["Vigilance"] });
    expect(cards.map((c) => c.id)).toContain("c1");
  });

  it("returns nothing if a keyword is absent", async () => {
    const { cards } = await searchCards({ keywords: ["Deathtouch"] });
    expect(cards).toHaveLength(0);
  });
});

describe("searchCards — price filter", () => {
  it("excludes cards above maxPriceUsd", async () => {
    const { cards } = await searchCards({ maxPriceUsd: 1 });
    expect(cards.every((c) => (c.priceUsd ?? 9999) <= 1)).toBe(true);
  });

  it("excludes null-price cards when maxPriceUsd set", async () => {
    const { cards } = await searchCards({ maxPriceUsd: 10 });
    expect(cards.every((c) => c.priceUsd !== null)).toBe(true);
  });
});

describe("searchCards — sorting", () => {
  it("sorts by name ascending by default", async () => {
    const { cards } = await searchCards({});
    const names = cards.map((c) => c.name);
    expect(names).toEqual([...names].sort());
  });

  it("sorts by name descending", async () => {
    const { cards } = await searchCards({ sort: "name", direction: "desc" });
    const names = cards.map((c) => c.name);
    expect(names).toEqual([...names].sort().reverse());
  });

  it("sorts by cmc ascending", async () => {
    const { cards } = await searchCards({ sort: "cmc", direction: "asc" });
    for (let i = 1; i < cards.length; i++) {
      expect(cards[i].cmc).toBeGreaterThanOrEqual(cards[i - 1].cmc);
    }
  });

  it("sorts by rarity descending (mythic first)", async () => {
    const { cards } = await searchCards({ sort: "rarity", direction: "desc" });
    expect(cards[0].rarity).toBe("mythic");
  });
});

describe("searchCards — pagination", () => {
  it("returns correct slice for page 1", async () => {
    const { cards, total } = await searchCards({ page: 1, perPage: 2 });
    expect(cards).toHaveLength(2);
    expect(total).toBeGreaterThan(2);
  });

  it("returns next slice for page 2", async () => {
    const { cards: p1 } = await searchCards({ page: 1, perPage: 2 });
    const { cards: p2 } = await searchCards({ page: 2, perPage: 2 });
    const p1ids = p1.map((c) => c.id);
    const p2ids = p2.map((c) => c.id);
    expect(p1ids.some((id) => p2ids.includes(id))).toBe(false);
  });

  it("total reflects unfiltered count", async () => {
    const { total } = await searchCards({});
    expect(total).toBe(legalCards.length);
  });
});

describe("searchCards — type filter", () => {
  it("returns cards matching any of the specified types", async () => {
    const { cards } = await searchCards({ types: ["Sorcery"] });
    expect(cards.map((c) => c.id)).toContain("c2");
  });

  it("subtype filter narrows by substring", async () => {
    const { cards } = await searchCards({ subtype: "Warrior" });
    expect(cards.map((c) => c.id)).toContain("c1");
    expect(cards.map((c) => c.id)).not.toContain("c2");
  });
});

describe("searchCards — includeFuture", () => {
  it("includes future-legal cards when flag is set", async () => {
    const { cards } = await searchCards({ includeFuture: true });
    expect(cards.map((c) => c.id)).toContain("c5");
  });

  it("excludes future-only cards by default", async () => {
    const { cards } = await searchCards({});
    expect(cards.map((c) => c.id)).not.toContain("c5");
  });
});

// ---------------------------------------------------------------------------
// getCardById
// ---------------------------------------------------------------------------

describe("getCardById", () => {
  it("returns the card when found", async () => {
    const card = await getCardById("c1");
    expect(card?.id).toBe("c1");
  });

  it("returns undefined for unknown id", async () => {
    const card = await getCardById("does-not-exist");
    expect(card).toBeUndefined();
  });
});

// ---------------------------------------------------------------------------
// getAllKeywords
// ---------------------------------------------------------------------------

describe("getAllKeywords", () => {
  it("returns a sorted, deduplicated keyword list", async () => {
    const kws = await getAllKeywords();
    expect(kws).toContain("Vigilance");
    expect(kws).toContain("First strike");
    expect(kws).toContain("Flash");
    const sorted = [...kws].sort();
    expect(kws).toEqual(sorted);
  });

  it("contains no duplicates", async () => {
    const kws = await getAllKeywords();
    expect(new Set(kws).size).toBe(kws.length);
  });
});

// ---------------------------------------------------------------------------
// getStandardSets
// ---------------------------------------------------------------------------

describe("getStandardSets", () => {
  it("returns only standard-legal sets", async () => {
    const sets = await getStandardSets();
    const codes = sets.map((s) => s.setCode);
    expect(codes).not.toContain("xyz"); // future-only
  });

  it("results are sorted by set name", async () => {
    const sets = await getStandardSets();
    const names = sets.map((s) => s.setName);
    expect(names).toEqual([...names].sort());
  });

  it("each entry has both setCode and setName", async () => {
    const sets = await getStandardSets();
    sets.forEach((s) => {
      expect(s.setCode).toBeTruthy();
      expect(s.setName).toBeTruthy();
    });
  });
});
