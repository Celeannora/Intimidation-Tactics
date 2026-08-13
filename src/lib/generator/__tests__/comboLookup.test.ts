import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../../db";
import {
  COMBO_LOOKUP_CACHE_TTL_MS,
  fetchCommanderSpellbookCombos,
  getCommanderSpellbookCombos,
} from "../comboLookup";
import type { CardRecord } from "../../types";

function makeCard(name: string, legalityStandard = "legal"): CardRecord {
  return {
    id: name, oracleId: `${name}-oracle`, name,
    lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{1}", cmc: 1, colorsJson: "[]", colorIdentityJson: "[]",
    typeLine: "Creature — Test", oracleText: "", keywordsJson: "[]",
    power: "1", toughness: "1", loyalty: null, producedManaJson: "[]",
    legalityStandard, legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: legalityStandard }),
    setCode: "TST", setName: "Test", setType: null, collectorNumber: null, rarity: "common",
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null, searchText: name, importedAt: "",
  };
}

function comboResponse(...variants: object[]): string {
  return JSON.stringify({ count: variants.length, next: null, previous: null, results: { included: variants } });
}

function mockFetch(body: string, ok = true): typeof fetch {
  return (async () => ({
    ok,
    status: ok ? 200 : 500,
    json: async () => JSON.parse(body),
  }) as Response) as unknown as typeof fetch;
}

function throwingFetch(): typeof fetch {
  return (async () => { throw new Error("offline"); }) as unknown as typeof fetch;
}

beforeEach(async () => {
  await db.commanderSpellbookCombos.clear();
});

describe("Commander Spellbook combo lookup", () => {
  it("posts one card-list request and keeps only combos whose local pieces are Standard legal", async () => {
    const legalA = makeCard("Legal A");
    const legalB = makeCard("Legal B");
    const illegal = makeCard("Rotated Card", "not_legal");
    let request: RequestInit | undefined;
    const fetchImpl = (async (_url: string, init?: RequestInit) => {
      request = init;
      return {
        ok: true,
        json: async () => JSON.parse(comboResponse(
          {
            id: "legal-combo",
            description: "Make a deterministic win.",
            uses: [{ card: { name: "Legal A", oracleId: legalA.oracleId } }, { card: { name: "Legal B", oracleId: legalB.oracleId } }],
          },
          {
            id: "rotated-combo",
            uses: [{ card: { name: "Legal A", oracleId: legalA.oracleId } }, { card: { name: "Rotated Card", oracleId: illegal.oracleId } }],
          },
        )),
      } as Response;
    }) as unknown as typeof fetch;

    const cards = [legalA, legalB, illegal];
    const combos = await getCommanderSpellbookCombos(cards, fetchImpl);

    expect(combos).toHaveLength(1);
    expect(combos?.[0]).toMatchObject({ id: "legal-combo", cardNames: ["Legal A", "Legal B"] });
    expect(request?.method).toBe("POST");
    expect(JSON.parse(String(request?.body))).toEqual({
      main: [
        { card: "Legal A", quantity: 1 },
        { card: "Legal B", quantity: 1 },
        { card: "Rotated Card", quantity: 1 },
      ],
    });
    const key = cards.map((card) => card.oracleId).sort().join("|");
    await expect(db.commanderSpellbookCombos.get(key)).resolves.toMatchObject({
      combos: [{ id: "legal-combo" }],
    });
  });

  it("falls back to a stale cache when a network lookup fails", async () => {
    const cards = [makeCard("A"), makeCard("B")];
    const key = cards.map((card) => card.oracleId).sort().join("|");
    await db.commanderSpellbookCombos.put({
      key,
      cachedAt: Date.now() - COMBO_LOOKUP_CACHE_TTL_MS - 1,
      combos: [{
        id: "cached",
        cardOracleIds: cards.map((card) => card.oracleId),
        cardNames: cards.map((card) => card.name),
        description: "Cached result",
        explanation: "Cached result",
        source: "Commander Spellbook",
      }],
    });

    await expect(getCommanderSpellbookCombos(cards, throwingFetch())).resolves.toMatchObject([{ id: "cached" }]);
  });

  it("returns an empty result when network and cache are unavailable", async () => {
    await expect(getCommanderSpellbookCombos([makeCard("A"), makeCard("B")], throwingFetch())).resolves.toEqual([]);
    await expect(fetchCommanderSpellbookCombos([makeCard("A")], mockFetch("{}", false))).resolves.toBeNull();
  });
});
