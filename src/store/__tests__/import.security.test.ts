import { beforeEach, describe, expect, it, vi } from "vitest";
import { parseDecklistText, resolveDeckEntries } from "../../lib/deckParser";
import { useDeckStore } from "../deckStore";
import { db } from "../../lib/db";
import type { CardRecord } from "../../lib/types";

const island = { id: "island", oracleId: "island", name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: null, oracleText: "", legalityStandard: "legal" } as CardRecord;
const bear = { ...island, id: "bear", oracleId: "bear", name: "Bear", typeLine: "Creature — Bear" } as CardRecord;

beforeEach(async () => {
  useDeckStore.getState().clearDeck();
  await db.cards.clear();
  await db.cards.bulkPut([island, bear]);
});

describe("bounded deck resolution", () => {
  it.each([1e9, Infinity, NaN, -1, 0, 0.5, "4"])("rejects quantity %j before database work", async quantity => {
    const where = vi.spyOn(db.cards, "where");
    try {
      await expect(resolveDeckEntries([{ cardName: "Island", quantity: quantity as number, board: "side" }])).rejects.toThrow();
      expect(where).not.toHaveBeenCalled();
    } finally { where.mockRestore(); }
  });
  it("rejects oversized individual lines before format matching", () => {
    expect(() => parseDecklistText("1" + " ".repeat(1_100) + "Island")).toThrow(/line/i);
  });
  it("rejects oversized direct set codes before database access", async () => {
    const where = vi.spyOn(db.cards, "where");
    try {
      await expect(resolveDeckEntries([{ cardName: "Island", quantity: 1, board: "main", setCode: "x".repeat(33) }])).rejects.toThrow();
      expect(where).not.toHaveBeenCalled();
    } finally { where.mockRestore(); }
  });
  it("preserves Arena suffixes and whitespace-separated MTGO quantities", () => {
    expect(parseDecklistText("4 Island (TST) 12").mainboard[0]).toMatchObject({ quantity: 4, cardName: "Island", setCode: "tst", collectorNumber: "12" });
    expect(parseDecklistText("4x\tIsland").mainboard[0]).toMatchObject({ quantity: 4, cardName: "Island" });
  });
  it("rejects huge text quantities rather than emitting an unsafe entry", () => {
    expect(() => parseDecklistText("999999999999999999999 Island")).toThrow();
    expect(() => parseDecklistText("Sideboard\n1000000000 Island")).toThrow();
  });
  it("bounds row count and requested totals across both boards", async () => {
    await expect(resolveDeckEntries(Array.from({ length: 1001 }, () => ({ cardName: "Island", quantity: 1, board: "main" as const })))).rejects.toThrow();
    await expect(resolveDeckEntries(Array.from({ length: 102 }, () => ({ cardName: "Island", quantity: 99, board: "side" as const })))).rejects.toThrow();
  });
  it("normalizes duplicate resolved rows and preserves unmatched reporting", async () => {
    const result = await resolveDeckEntries([
      { cardName: "Bear", quantity: 3, board: "main" },
      { cardName: "Bear", quantity: 3, board: "main" },
      { cardName: "Island", quantity: 70, board: "main" },
      { cardName: "Island", quantity: 70, board: "main" },
      { cardName: "Bear", quantity: 2, board: "side" },
      { cardName: "Absent", quantity: 1, board: "main" },
    ]);
    expect(result.resolved.map(e => [e.card.oracleId, e.quantity, e.board])).toEqual([
      ["bear", 4, "main"], ["island", 99, "main"], ["bear", 2, "side"],
    ]);
    expect(result.unmatched).toEqual(["1 Absent"]);
  });
  it("retains multi-deck detection and accepts bounded blends", async () => {
    const parsed = parseDecklistText("Deck\n60 Island\nDeck\n60 Island");
    expect(parsed.multipleDecksDetected).toBe(true);
    expect((await resolveDeckEntries(parsed.mainboard)).resolved[0].quantity).toBe(99);
  });
});

describe("atomic store imports", () => {
  it("rejects invalid replacement before losing entries, name or pins", () => {
    const store = useDeckStore.getState();
    store.addCard(bear, "main"); store.pinCard("bear"); store.setDeckName("Keep");
    const before = useDeckStore.getState();
    expect(() => store.importEntries([{ card: island, quantity: 1e9, board: "side" }], true)).toThrow();
    expect(useDeckStore.getState()).toBe(before);
  });
  it("adds bounded quantities in one state update while retaining pins and locks", () => {
    useDeckStore.setState({ entries: [{ card: bear, quantity: 1, board: "main", quantityLocked: true }], pins: { bear: 1 } });
    const changed = vi.fn();
    const unsubscribe = useDeckStore.subscribe(changed);
    try {
      expect(useDeckStore.getState().importEntries([{ card: bear, quantity: 99, board: "main" }, { card: island, quantity: 99, board: "main" }], false)).toBe(102);
      expect(changed).toHaveBeenCalledTimes(1);
      expect(useDeckStore.getState().entries[0]).toMatchObject({ quantity: 4, quantityLocked: true });
      expect(useDeckStore.getState().pins).toEqual({ bear: 1 });
    } finally { unsubscribe(); }
  });
  it("replaces successfully in one update and clears old pins", () => {
    useDeckStore.getState().addCard(bear, "main");
    useDeckStore.getState().pinCard("bear");
    expect(useDeckStore.getState().importEntries([{ card: island, quantity: 24, board: "main" }], true)).toBe(24);
    expect(useDeckStore.getState().pins).toEqual({});
    expect(useDeckStore.getState().entries).toEqual([{ card: island, quantity: 24, board: "main" }]);
  });
});
