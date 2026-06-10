import { create } from "zustand";
import { validateDeck, maxCopiesForCard } from "../lib/legality";
import { checkCompanionRestriction } from "../lib/companion";
import { db } from "../lib/db";
import type { CardRecord } from "../lib/types";
import type { DeckEntry, ValidationResult } from "../lib/legality";
import type { CompanionCheckResult } from "../lib/companion";
import type { SavedDeck } from "../lib/db";

export interface ShareableDecoded {
  name: string;
  main: [number, string][];
  side: [number, string][];
}

export interface DeckState {
  activeDeckId: string;
  deckId: string | null;
  deckName: string;
  entries: DeckEntry[];
  /** oracleId -> locked quantity. Pinned cards are immune to generator/optimizer swaps. */
  pins: Record<string, number>;
  validation: ValidationResult;
  companionCheck: CompanionCheckResult | null;

  // Multi-deck
  savedDecks: SavedDeck[];
  loadSavedDecks: () => Promise<void>;
  saveCurrentDeck: () => Promise<void>;
  loadSavedDeck: (id: string) => Promise<void>;
  deleteSavedDeck: (id: string) => Promise<void>;
  renameSavedDeck: (id: string, name: string) => Promise<void>;
  newDeck: () => void;

  addCard: (card: CardRecord, board: "main" | "side") => void;
  removeCard: (oracleId: string, board: "main" | "side") => void;
  setQuantity: (oracleId: string, board: "main" | "side", qty: number) => void;
  moveCard: (oracleId: string, from: "main" | "side", to: "main" | "side") => void;
  clearDeck: () => void;
  setDeckName: (name: string) => void;
  loadFromSnapshot: (decoded: ShareableDecoded) => Promise<void>;

  // Card pinning (post-generation locks)
  /** Pin a card at the given quantity (defaults to its current mainboard quantity). */
  pinCard: (oracleId: string, quantity?: number) => void;
  unpinCard: (oracleId: string) => void;
  setPinQuantity: (oracleId: string, quantity: number) => void;
  isPinned: (oracleId: string) => boolean;
}

function makeId(): string {
  return `deck_${Date.now()}_${Math.random().toString(36).slice(2, 7)}`;
}

/**
 * Keep the pins map consistent with mainboard edits. Pins only track mainboard
 * cards. If a mainboard card is removed, drop its pin; if its quantity drops
 * below the pinned amount, clamp the pin down.
 */
function prunePin(
  pins: Record<string, number>,
  oracleId: string,
  board: "main" | "side",
  removed: boolean,
  newMainQty: number
): Record<string, number> {
  if (board !== "main") return pins;
  if (!(oracleId in pins)) return pins;
  if (removed) {
    const next = { ...pins };
    delete next[oracleId];
    return next;
  }
  if (pins[oracleId] > newMainQty) {
    return { ...pins, [oracleId]: newMainQty };
  }
  return pins;
}

function revalidate(
  entries: DeckEntry[]
): { validation: ValidationResult; companionCheck: CompanionCheckResult | null } {
  const validation = validateDeck(entries);
  const sideCards  = entries.filter(e => e.board === "side").flatMap(e => Array(e.quantity).fill(e.card) as CardRecord[]);
  const mainCards  = entries.filter(e => e.board === "main").flatMap(e => Array(e.quantity).fill(e.card) as CardRecord[]);
  const companionCheck = checkCompanionRestriction(sideCards, mainCards);
  return { validation, companionCheck };
}

function entriesToRecord(entries: DeckEntry[], board: "main" | "side"): Record<string, number> {
  return Object.fromEntries(
    entries.filter(e => e.board === board).map(e => [e.card.oracleId, e.quantity])
  );
}

export const useDeckStore = create<DeckState>((set, get) => ({
  activeDeckId: makeId(),
  deckId: null,
  deckName: "New Deck",
  entries: [],
  pins: {},
  savedDecks: [],
  validation: {
    legal: false,
    mainCount: 0,
    sideCount: 0,
    violations: [{ rule: "MIN_60", message: "Mainboard has 0 cards — minimum is 60." }],
  },
  companionCheck: null,

  // ── Multi-deck ───────────────────────────────────────────────────────────

  async loadSavedDecks() {
    const decks = await db.savedDecks.orderBy("updatedAt").reverse().toArray();
    set({ savedDecks: decks });
  },

  async saveCurrentDeck() {
    const { activeDeckId, deckName, entries, pins } = get();
    const record: SavedDeck = {
      id:        activeDeckId,
      name:      deckName,
      updatedAt: Date.now(),
      mainboard: entriesToRecord(entries, "main"),
      sideboard: entriesToRecord(entries, "side"),
      wins:      0,
      losses:    0,
      draws:     0,
      pins:      { ...pins },
    };
    const existing = await db.savedDecks.get(activeDeckId);
    if (existing) {
      record.wins   = existing.wins;
      record.losses = existing.losses;
      record.draws  = existing.draws;
    }
    await db.savedDecks.put(record);
    const decks = await db.savedDecks.orderBy("updatedAt").reverse().toArray();
    set({ savedDecks: decks });
  },

  async loadSavedDeck(id: string) {
    const saved = await db.savedDecks.get(id);
    if (!saved) return;

    const allOracleIds = [
      ...Object.keys(saved.mainboard),
      ...Object.keys(saved.sideboard),
    ];
    const cards = await db.cards.where("oracleId").anyOf(allOracleIds).toArray();
    const cardMap = new Map(cards.map(c => [c.oracleId, c]));

    const entries: DeckEntry[] = [];
    for (const [oracleId, qty] of Object.entries(saved.mainboard)) {
      const card = cardMap.get(oracleId);
      if (card) entries.push({ card, quantity: qty, board: "main" });
    }
    for (const [oracleId, qty] of Object.entries(saved.sideboard)) {
      const card = cardMap.get(oracleId);
      if (card) entries.push({ card, quantity: qty, board: "side" });
    }

    // Only keep pins for cards still present in the loaded mainboard.
    const mainIds = new Set(entries.filter((e) => e.board === "main").map((e) => e.card.oracleId));
    const pins: Record<string, number> = {};
    for (const [oracleId, qty] of Object.entries(saved.pins ?? {})) {
      if (mainIds.has(oracleId)) pins[oracleId] = qty;
    }

    set({
      activeDeckId: saved.id,
      deckName:     saved.name,
      entries,
      pins,
      ...revalidate(entries),
    });
  },

  async deleteSavedDeck(id: string) {
    await db.savedDecks.delete(id);
    const decks = await db.savedDecks.orderBy("updatedAt").reverse().toArray();
    set({ savedDecks: decks });
  },

  async renameSavedDeck(id: string, name: string) {
    const trimmed = name.trim();
    if (!trimmed) return;
    await db.savedDecks.update(id, { name: trimmed });
    // If this is the active deck, update deckName in store too
    if (get().activeDeckId === id) set({ deckName: trimmed });
    const decks = await db.savedDecks.orderBy("updatedAt").reverse().toArray();
    set({ savedDecks: decks });
  },

  newDeck() {
    const entries: DeckEntry[] = [];
    set({
      activeDeckId: makeId(),
      deckId:       null,
      deckName:     "New Deck",
      entries,
      pins:         {},
      ...revalidate(entries),
    });
  },

  // ── Card editing ──────────────────────────────────────────────────────────

  addCard(card, board) {
    const { entries } = get();
    const existing   = entries.find(e => e.card.oracleId === card.oracleId && e.board === board);
    const maxCopies  = maxCopiesForCard(card);

    let updated: DeckEntry[];
    if (existing) {
      if (existing.quantity >= maxCopies) return;
      updated = entries.map(e =>
        e.card.oracleId === card.oracleId && e.board === board
          ? { ...e, quantity: e.quantity + 1 }
          : e
      );
    } else {
      updated = [...entries, { card, quantity: 1, board }];
    }
    set({ entries: updated, ...revalidate(updated) });
  },

  removeCard(oracleId, board) {
    const { entries, pins } = get();
    const existing   = entries.find(e => e.card.oracleId === oracleId && e.board === board);
    if (!existing) return;
    const removed = existing.quantity <= 1;
    const updated = removed
      ? entries.filter(e => !(e.card.oracleId === oracleId && e.board === board))
      : entries.map(e =>
          e.card.oracleId === oracleId && e.board === board
            ? { ...e, quantity: e.quantity - 1 }
            : e
        );
    set({ entries: updated, pins: prunePin(pins, oracleId, board, removed, existing.quantity - 1), ...revalidate(updated) });
  },

  setQuantity(oracleId, board, qty) {
    const { entries, pins }  = get();
    const card         = entries.find(e => e.card.oracleId === oracleId)?.card;
    const maxCopies    = card ? maxCopiesForCard(card) : 4;
    const clampedQty   = Math.max(0, Math.min(qty, maxCopies));

    let updated: DeckEntry[];
    if (clampedQty === 0) {
      updated = entries.filter(e => !(e.card.oracleId === oracleId && e.board === board));
    } else {
      const exists = entries.some(e => e.card.oracleId === oracleId && e.board === board);
      if (!exists) return;
      updated = entries.map(e =>
        e.card.oracleId === oracleId && e.board === board
          ? { ...e, quantity: clampedQty }
          : e
      );
    }
    set({ entries: updated, pins: prunePin(pins, oracleId, board, clampedQty === 0, clampedQty), ...revalidate(updated) });
  },

  moveCard(oracleId, from, to) {
    const { entries }    = get();
    const entry          = entries.find(e => e.card.oracleId === oracleId && e.board === from);
    if (!entry) return;

    const withoutSource  = entries.filter(e => !(e.card.oracleId === oracleId && e.board === from));
    const destExisting   = withoutSource.find(e => e.card.oracleId === oracleId && e.board === to);
    const maxCopies      = maxCopiesForCard(entry.card);

    const updated: DeckEntry[] = destExisting
      ? withoutSource.map(e =>
          e.card.oracleId === oracleId && e.board === to
            ? { ...e, quantity: Math.min(e.quantity + entry.quantity, maxCopies) }
            : e
        )
      : [...withoutSource, { ...entry, board: to }];

    set({ entries: updated, ...revalidate(updated) });
  },

  clearDeck() {
    const entries: DeckEntry[] = [];
    set({ entries, pins: {}, activeDeckId: makeId(), ...revalidate(entries) });
  },

  setDeckName(name) {
    set({ deckName: name });
  },

  async loadFromSnapshot(decoded: ShareableDecoded) {
    const allPairs  = [
      ...decoded.main.map(([q, id]) => ({ q, id, board: "main" as const })),
      ...decoded.side.map(([q, id]) => ({ q, id, board: "side" as const })),
    ];
    const oracleIds = allPairs.map(p => p.id);
    const cards     = await db.cards.where("oracleId").anyOf(oracleIds).toArray();
    const cardMap   = new Map(cards.map(c => [c.oracleId, c]));

    const entries: DeckEntry[] = [];
    for (const { q, id, board } of allPairs) {
      const card = cardMap.get(id);
      if (card) entries.push({ card, quantity: q, board });
    }
    set({ entries, pins: {}, deckName: decoded.name, activeDeckId: makeId(), ...revalidate(entries) });
  },

  // ── Card pinning ────────────────────────────────────────────────────────────

  pinCard(oracleId, quantity) {
    const { entries, pins } = get();
    const mainEntry = entries.find((e) => e.card.oracleId === oracleId && e.board === "main");
    if (!mainEntry) return; // only mainboard cards can be pinned
    const qty = Math.max(1, Math.floor(quantity ?? mainEntry.quantity));
    set({ pins: { ...pins, [oracleId]: Math.min(qty, mainEntry.quantity) } });
  },

  unpinCard(oracleId) {
    const { pins } = get();
    if (!(oracleId in pins)) return;
    const next = { ...pins };
    delete next[oracleId];
    set({ pins: next });
  },

  setPinQuantity(oracleId, quantity) {
    const { entries, pins } = get();
    if (!(oracleId in pins)) return;
    const mainEntry = entries.find((e) => e.card.oracleId === oracleId && e.board === "main");
    if (!mainEntry) return;
    const qty = Math.max(1, Math.min(Math.floor(quantity), mainEntry.quantity));
    set({ pins: { ...pins, [oracleId]: qty } });
  },

  isPinned(oracleId) {
    return oracleId in get().pins;
  },
}));

const mainCache = new WeakMap<DeckEntry[], DeckEntry[]>();
const sideCache = new WeakMap<DeckEntry[], DeckEntry[]>();

export function useMainboardEntries() {
  return useDeckStore(s => {
    const cached = mainCache.get(s.entries);
    if (cached) return cached;
    const filtered = s.entries.filter(e => e.board === "main");
    mainCache.set(s.entries, filtered);
    return filtered;
  });
}
export function useSideboardEntries() {
  return useDeckStore(s => {
    const cached = sideCache.get(s.entries);
    if (cached) return cached;
    const filtered = s.entries.filter(e => e.board === "side");
    sideCache.set(s.entries, filtered);
    return filtered;
  });
}
