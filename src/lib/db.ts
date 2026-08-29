import Dexie, { Table } from "dexie";
import type { CardRecord } from "./types";
import type { LiveWinRateDataset } from "./meta/liveWinRate";
import type { MetaSnapshot } from "./meta/types";
import type { VerifiedCombo } from "./generator/comboLookup";

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

/**
 * Cached live per-archetype win-rate dataset (Track 2 competitive-strength data).
 * Keyed by `${format}:${environment}` so ladder/tournament variants coexist.
 */
export interface LiveWinRateCacheRow {
  key: string;
  dataset: LiveWinRateDataset;
  cachedAt: number;    // Date.now() when this row was written
}

/** Cached remote meta snapshot, keyed by format for cache-first startup. */
export interface MetaSnapshotCacheRow {
  key: string;
  snapshot: MetaSnapshot;
  cachedAt: number;
}

/** Cached Commander Spellbook response for one sorted candidate-card set. */
export interface CommanderSpellbookComboCacheRow {
  key: string;
  combos: VerifiedCombo[];
  cachedAt: number;
}

export class MTGDeckBuilderDB extends Dexie {
  cards!:        Table<CardRecord,        string>;
  meta!:         Table<ImportMeta,        string>;
  savedDecks!:   Table<SavedDeck,         string>;
  matchResults!: Table<MatchResult,       number>;
  liveWinRate!:  Table<LiveWinRateCacheRow, string>;
  metaSnapshot!: Table<MetaSnapshotCacheRow, string>;
  commanderSpellbookCombos!: Table<CommanderSpellbookComboCacheRow, string>;

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

    this.version(4).stores({
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
      liveWinRate:  "key, cachedAt",
    });

    this.version(5).stores({
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
      liveWinRate:  "key, cachedAt",
      metaSnapshot: "key, cachedAt",
    });

    // Separate version bump: metaSnapshot (v5) already shipped on main via
    // the live-meta-feed feature. Adding commanderSpellbookCombos as v6
    // rather than folding it into v5 keeps the already-released v5 schema
    // immutable, per Dexie's additive-versioning convention.
    this.version(6).stores({
      commanderSpellbookCombos: "key, cachedAt",
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
