import { beforeEach, describe, expect, it } from "vitest";
import { useDeckStore } from "../deckStore";
import { card, deck } from "./generated.fixtures";
import { db } from "../../lib/db";

beforeEach(() => {
  useDeckStore.getState().newDeck();
});

describe("atomic generated deck application", () => {
  it("uses the applied format for subsequent copy limits and revalidation", () => {
    const singleton = card("Singleton", { typeLine: "Creature" });
    const store = useDeckStore.getState();
    store.applyGeneratedDeck([...deck(99), { card: singleton, quantity: 1, board: "main" }], "commander");
    store.addCard(singleton, "main");
    expect(useDeckStore.getState().entries.find((e) => e.card.oracleId === "Singleton")?.quantity).toBe(1);
    expect(useDeckStore.getState().validation.legal).toBe(true);
    store.setQuantity(singleton.oracleId, "main", 4);
    expect(useDeckStore.getState().entries.find((e) => e.card.oracleId === "Singleton")?.quantity).toBe(1);
    expect(store.importEntries([{ card: singleton, quantity: 4, board: "main" }], false)).toBe(0);
    store.removeCard("Island", "main");
    expect(useDeckStore.getState().validation).toMatchObject({ legal: false, mainCount: 99 });
    store.clearDeck();
    expect(useDeckStore.getState().format).toBe("commander");
    expect(useDeckStore.getState().validation.violations[0].message).toContain("100");
    store.newDeck();
    expect(useDeckStore.getState().format).toBe("standard");
  });

  it("caps imports and moves across both boards using the stored format", () => {
    const singleton = card("Singleton", { typeLine: "Creature" });
    const store = useDeckStore.getState();
    store.applyGeneratedDeck([...deck(99), { card: singleton, quantity: 1, board: "main" }], "commander");
    expect(store.importEntries([{ card: singleton, quantity: 4, board: "side" }], false)).toBe(0);
    store.moveCard(singleton.oracleId, "main", "side");
    expect(useDeckStore.getState().validation.violations.some((v) => v.rule === "SIDE_SIZE")).toBe(true);
    store.addCard(singleton, "main");
    expect(useDeckStore.getState().entries.filter((e) => e.card.oracleId === "Singleton")
      .reduce((sum, e) => sum + e.quantity, 0)).toBe(1);
  });

  it("persists the format without requiring it on older saved decks", async () => {
    await db.cards.put(card());
    const store = useDeckStore.getState();
    store.applyGeneratedDeck(deck(), "modern", "Modern");
    const id = useDeckStore.getState().activeDeckId;
    await store.saveCurrentDeck();
    expect((await db.savedDecks.get(id))?.format).toBe("modern");
    store.newDeck();
    await store.loadSavedDeck(id);
    expect(useDeckStore.getState().format).toBe("modern");
    await db.savedDecks.update(id, { format: undefined });
    await store.loadSavedDeck(id);
    expect(useDeckStore.getState().format).toBe("standard");
  });

  it("preserves recorded pins and incoming/previous quantity locks", () => {
    const locked = card("Locked", { typeLine: "Creature" });
    const fresh = card("Fresh", { typeLine: "Creature" });
    useDeckStore.getState().importEntries([
      { card: locked, board: "main", quantity: 2, quantityLocked: true },
    ], true);
    useDeckStore.getState().pinCard(locked.oracleId, 2);
    const before = useDeckStore.getState();
    const result = before.applyGeneratedDeck([
      ...deck(57),
      { card: locked, board: "main", quantity: 2 },
      { card: fresh, board: "main", quantity: 1, quantityLocked: true },
    ], "standard");
    expect(result.legal).toBe(true);
    const after = useDeckStore.getState();
    expect(after.pins).toEqual({ Locked: 2 });
    expect(after.entries.find((e) => e.card.oracleId === "Locked")?.quantityLocked).toBe(true);
    expect(after.entries.find((e) => e.card.oracleId === "Fresh")?.quantityLocked).toBe(true);
    expect(after.activeDeckId).toBe(before.activeDeckId);
  });

  it.each([0, 1, 3])("rejects generated pin quantity %i without any state change", (quantity) => {
    const pinned = card("Pinned", { typeLine: "Creature" });
    useDeckStore.getState().importEntries([{ card: pinned, board: "main", quantity: 2 }], true);
    useDeckStore.getState().pinCard(pinned.oracleId);
    const before = useDeckStore.getState();
    const result = before.applyGeneratedDeck([
      ...deck(60 - quantity),
      ...(quantity ? [{ card: pinned, board: "main" as const, quantity }] : []),
    ], "modern", "Must not rename");
    expect(result.legal).toBe(false);
    expect(result.violations.some((v) => v.rule === "PIN_QUANTITY")).toBe(true);
    expect(useDeckStore.getState()).toBe(before);
  });

  it("rejects illegal results without changing format, name, entries or validation", () => {
    const before = useDeckStore.getState();
    expect(before.applyGeneratedDeck(deck(59), "modern", "Rejected").legal).toBe(false);
    expect(useDeckStore.getState()).toBe(before);
  });

  it("publishes a validated deck and its format/name in one notification", () => {
    const notifications: unknown[] = [];
    const unsubscribe = useDeckStore.subscribe((state) => notifications.push(state));
    try {
      expect(typeof useDeckStore.getState().applyGeneratedDeck).toBe("function");
      const entries = [...deck(99), { card: card("Plains"), quantity: 1, board: "main" as const }];
      const validation = useDeckStore.getState().applyGeneratedDeck(entries, "commander", "Generated");
      expect(validation.legal).toBe(true);
      expect(notifications).toHaveLength(1);
      expect(useDeckStore.getState()).toMatchObject({
        format: "commander", deckName: "Generated", entries, validation: { legal: true },
      });
    } finally { unsubscribe(); }
  });
});
