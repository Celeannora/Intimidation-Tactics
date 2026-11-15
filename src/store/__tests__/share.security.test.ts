import { beforeEach, describe, expect, it } from "vitest";
import { decodeShareableLink, encodeShareableLink } from "../../lib/deckExporter";
import { useDeckStore } from "../deckStore";
import { db } from "../../lib/db";
import type { CardRecord } from "../../lib/types";

const island = { id: "island", oracleId: "island", name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: null, oracleText: "", legalityStandard: "legal" } as CardRecord;
const creature = { ...island, id: "bear", oracleId: "bear", name: "Bear", typeLine: "Creature — Bear", cmc: 2 } as CardRecord;
const yorion = { ...creature, id: "yorion", oracleId: "yorion", name: "Yorion, Sky Nomad" } as CardRecord;
const hash = (m: unknown, s: unknown = [], n: unknown = "Test") => `#deck=${btoa(JSON.stringify({ n, m, s }))}`;

beforeEach(async () => {
  useDeckStore.getState().clearDeck();
  await db.cards.clear();
  await db.cards.bulkPut([island, creature, yorion]);
});

describe("share payload admission", () => {
  it.each(["1000000000", "Infinity", "NaN", "-1", "0", "1.5", "1e9", "0x10", "", "100"])("rejects quantity %j before loading", q => {
    expect(decodeShareableLink(hash([`${q}:island`]))).toBeNull();
  });
  it.each([null, {}, [null], [4], ["4:"], ["4:island:extra"]])("rejects malformed board %j", m => {
    expect(decodeShareableLink(hash(m))).toBeNull();
  });
  it("rejects duplicate board identifiers", () => {
    expect(decodeShareableLink(hash(["2:bear", "2:bear"]))).toBeNull();
  });
  it("rejects oversized totals across both boards", () => {
    const main = Array.from({ length: 60 }, (_, i) => `99:main${i}`);
    const side = Array.from({ length: 60 }, (_, i) => `99:side${i}`);
    expect(decodeShareableLink(hash(main, side))).toBeNull();
  });
  it("rejects oversized names and encoded payloads", () => {
    expect(decodeShareableLink(hash([], [], "x".repeat(257)))).toBeNull();
    expect(decodeShareableLink(hash(["1:" + "x".repeat(300_000)]))).toBeNull();
  });
  it("round-trips ordinary exported links", () => {
    const link = encodeShareableLink({ name: "Test", mainboard: [{ quantity: 24, card: island }], sideboard: [] });
    expect(decodeShareableLink(link.slice(link.indexOf("#")))).toEqual({ name: "Test", main: [[24, "island"]], side: [] });
  });
});

describe("snapshot store boundary", () => {
  it("rejects direct over-limit input without changing the current deck", async () => {
    const store = useDeckStore.getState();
    store.addCard(creature, "main");
    store.pinCard("bear");
    const before = useDeckStore.getState();
    await expect(store.loadFromSnapshot({ name: "Attack", main: [[100, "island"]], side: [] })).rejects.toThrow();
    expect(useDeckStore.getState()).toBe(before);
  });
  it("keeps safe over-copy snapshots diagnostic rather than changing their contents", async () => {
    await useDeckStore.getState().loadFromSnapshot({ name: "Over-copy", main: [[6, "bear"]], side: [[1, "bear"]] });
    expect(useDeckStore.getState().entries.map(e => e.quantity)).toEqual([6, 1]);
    expect(useDeckStore.getState().validation.violations.some(v => v.rule === "MAX_COPIES")).toBe(true);
  });
  it("preserves basic land counts and quantity-dependent Yorion checks", async () => {
    await useDeckStore.getState().loadFromSnapshot({ name: "Legal shape", main: [[80, "island"]], side: [[1, "yorion"]] });
    expect(useDeckStore.getState().entries[0].quantity).toBe(80);
    expect(useDeckStore.getState().companionCheck?.satisfied).toBe(true);
    await useDeckStore.getState().loadFromSnapshot({ name: "Small", main: [[60, "island"]], side: [[1, "yorion"]] });
    expect(useDeckStore.getState().companionCheck?.satisfied).toBe(false);
  });
  it("continues to ignore unknown oracle IDs", async () => {
    await useDeckStore.getState().loadFromSnapshot({ name: "Known only", main: [[1, "missing"], [24, "island"]], side: [] });
    expect(useDeckStore.getState().entries).toHaveLength(1);
  });
});
