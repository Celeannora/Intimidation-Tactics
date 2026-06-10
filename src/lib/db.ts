import Dexie, { Table } from "dexie";
import type { CardRecord } from "./types";

export interface ImportMeta {
  key: string;
  value: string;
}

export interface SavedDeck {
  id: string;          // makeId() value
  name: string;
  updatedAt: number;   // Date.now()
  mainboard: Record<string, number>; // oracleId -> quantity
  sideboard: Record<string, number>;
  wins: number;
  losses: number;
  draws: number;
  /**
   * Pinned cards: oracleId -> locked quantity. Pinned cards are immune to
   * optimizer swaps/upgrades on regeneration. Optional for backward compat with
   * decks saved before pinning existed.
   */
  pins?: Record<string, number>;
}

export interface MatchResult {
  id?: number;         // auto-increment
  deckId: string;
  opponent: string;    // free-text opponent deck name
  result: "win" | "loss" | "draw";
  notes: string;
  playedAt: number;    // Date.now()
}

export class MTGDeckBuilderDB extends Dexie {
  cards!:        Table<CardRecord,   string>;
  meta!:         Table<ImportMeta,   string>;
  savedDecks!:   Table<SavedDeck,    string>;
  matchResults!: Table<MatchResult,  number>;

  constructor() {
    super("mtgDeckBuilderDB");

    this.version(1).stores({
      cards: `
        id,
        oracleId,
        name,
        cmc,
        legalityStandard,
        legalityFuture,
        bannedInStandard,
        setCode,
        setName,
        rarity,
        imageNormal,
        importedAt,
        *keywordsJson,
        *colorsJson,
        *colorIdentityJson,
        typeLine
      `,
      meta: "key",
    });

    this.version(2).stores({
      cards: `
        id,
        oracleId,
        name,
        cmc,
        legalityStandard,
        legalityFuture,
        bannedInStandard,
        setCode,
        setName,
        rarity,
        imageNormal,
        importedAt,
        *keywordsJson,
        *colorsJson,
        *colorIdentityJson,
        typeLine
      `,
      meta:         "key",
      savedDecks:   "id, updatedAt",
      matchResults: "++id, deckId, playedAt",
    });

    this.version(3).stores({
      cards: `
        id,
        oracleId,
        name,
        cmc,
        legalityStandard,
        legalityFuture,
        bannedInStandard,
        setCode,
        setName,
        rarity,
        imageNormal,
        importedAt,
        *keywordsJson,
        *colorsJson,
        *colorIdentityJson,
        typeLine
      `,
      meta:         "key",
      savedDecks:   "id, updatedAt",
      matchResults: "++id, deckId, playedAt",
    });
  }
}

export const db = new MTGDeckBuilderDB();

export async function replaceAllCards(cards: CardRecord[], importedAt: string) {
  await db.transaction("rw", db.cards, db.meta, async () => {
    await db.cards.clear();
    await db.cards.bulkPut(cards);
    await db.meta.bulkPut([
      { key: "lastImportedAt", value: importedAt },
      { key: "cardCount",      value: String(cards.length) },
    ]);
  });
}
