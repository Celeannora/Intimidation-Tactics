/**
 * comboLookup.ts — resilient Commander Spellbook cross-reference.
 *
 * The request/response shape is confirmed against Commander Spellbook's
 * OpenAPI schema (https://backend.commanderspellbook.com/schema/): POST
 * /find-my-combos accepts { main: [{ card, quantity }] } and returns a
 * paginated object whose results.included entries are Variant records.
 *
 * This remains optional enrichment. Network, CORS, IndexedDB, and malformed
 * API responses all resolve to an empty list so deck generation is never
 * allowed to crash on a third-party lookup.
 */

import type { CardRecord } from "../types";
import { isCardLegalInFormat } from "../formats";
import { db } from "../db";

const BASE_URL = "https://backend.commanderspellbook.com";
const FIND_MY_COMBOS_URL = `${BASE_URL}/find-my-combos/`;
export const COMBO_LOOKUP_CACHE_TTL_MS = 24 * 60 * 60 * 1000;

export interface VerifiedCombo {
  id: string;
  cardOracleIds: string[];
  cardNames: string[];
  description: string;
  explanation: string;
  source: "Commander Spellbook";
}

interface SpellbookCard {
  name?: unknown;
  oracleId?: unknown;
}

interface SpellbookVariant {
  id?: unknown;
  uses?: Array<{ card?: SpellbookCard; quantity?: unknown }>;
  description?: unknown;
  easyPrerequisites?: unknown;
  notablePrerequisites?: unknown;
}

function cacheKey(cards: CardRecord[]): string {
  return cards.map((card) => card.oracleId).slice().sort().join("|");
}

/**
 * Live request only. This function deliberately makes one batched request for
 * the whole candidate pool, never one request per card or scoring iteration.
 */
export async function fetchCommanderSpellbookCombos(
  cards: CardRecord[],
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedCombo[] | null> {
  if (cards.length === 0) return [];
  try {
    const response = await fetchImpl(FIND_MY_COMBOS_URL, {
      method: "POST",
      headers: { Accept: "application/json", "Content-Type": "application/json" },
      body: JSON.stringify({
        main: cards.map((card) => ({ card: card.name, quantity: 1 })),
      }),
    });
    if (!response.ok) return null;
    const payload: unknown = await response.json();
    return parseStandardLegalCombos(payload, cards);
  } catch {
    return null;
  }
}

/**
 * Cache-first lookup following liveWinRate.ts's honest fallback pattern.
 * A fresh cached value avoids a network request; a stale cache is returned
 * when a refresh fails; no cache plus a failure yields [].
 */
export async function getCommanderSpellbookCombos(
  cards: CardRecord[],
  fetchImpl: typeof fetch = fetch,
): Promise<VerifiedCombo[]> {
  if (cards.length === 0) return [];
  const key = cacheKey(cards);
  const cached = await readCache(key);
  if (cached && Date.now() - cached.cachedAt < COMBO_LOOKUP_CACHE_TTL_MS) return cached.combos;

  const fresh = await fetchCommanderSpellbookCombos(cards, fetchImpl);
  if (fresh !== null) {
    await writeCache(key, fresh);
    return fresh;
  }
  return cached?.combos ?? [];
}

/** Parse the documented paginated result without trusting untyped remote data. */
export function parseStandardLegalCombos(payload: unknown, localCards: CardRecord[]): VerifiedCombo[] {
  const variants = includedVariants(payload);
  if (!variants) return [];

  const cardsByOracleId = new Map(localCards.map((card) => [card.oracleId, card]));
  const cardsByName = new Map(localCards.map((card) => [card.name.toLocaleLowerCase(), card]));
  const output = new Map<string, VerifiedCombo>();

  for (const variant of variants) {
    if (!variant || typeof variant !== "object") continue;
    const raw = variant as SpellbookVariant;
    if (typeof raw.id !== "string" || !Array.isArray(raw.uses) || raw.uses.length < 2) continue;

    const pieces = raw.uses.map((use) => resolveLocalPiece(use?.card, cardsByOracleId, cardsByName));
    // Do not trust Spellbook's own legality flag here. Every returned piece
    // must resolve to the app's Scryfall-backed CardRecord and pass the app's
    // shared Standard legality helper.
    if (pieces.some((piece) => !piece || !isCardLegalInFormat(piece, "standard"))) continue;

    const resolved = pieces as CardRecord[];
    const cardNames = resolved.map((card) => card.name);
    const prerequisites = [raw.easyPrerequisites, raw.notablePrerequisites]
      .filter((value): value is string => typeof value === "string" && value.trim().length > 0)
      .join(" ");
    const description = typeof raw.description === "string" && raw.description.trim()
      ? raw.description.trim()
      : "Verified combo returned by Commander Spellbook.";
    const explanation = `${cardNames.join(" + ")} — ${description}${prerequisites ? ` Prerequisites: ${prerequisites}` : ""}`;

    output.set(raw.id, {
      id: raw.id,
      cardOracleIds: resolved.map((card) => card.oracleId),
      cardNames,
      description,
      explanation,
      source: "Commander Spellbook",
    });
  }

  return [...output.values()].sort((a, b) => a.id.localeCompare(b.id));
}

function includedVariants(payload: unknown): unknown[] | null {
  if (!payload || typeof payload !== "object") return null;
  const root = payload as Record<string, unknown>;
  const results = root.results && typeof root.results === "object"
    ? root.results as Record<string, unknown>
    : root;
  return Array.isArray(results.included) ? results.included : null;
}

function resolveLocalPiece(
  rawCard: SpellbookCard | undefined,
  cardsByOracleId: Map<string, CardRecord>,
  cardsByName: Map<string, CardRecord>,
): CardRecord | undefined {
  if (!rawCard) return undefined;
  if (typeof rawCard.oracleId === "string") {
    const byId = cardsByOracleId.get(rawCard.oracleId);
    if (byId) return byId;
  }
  return typeof rawCard.name === "string" ? cardsByName.get(rawCard.name.toLocaleLowerCase()) : undefined;
}

async function readCache(key: string): Promise<{ combos: VerifiedCombo[]; cachedAt: number } | null> {
  try {
    const row = await db.commanderSpellbookCombos.get(key);
    return row ? { combos: row.combos, cachedAt: row.cachedAt } : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, combos: VerifiedCombo[]): Promise<void> {
  try {
    await db.commanderSpellbookCombos.put({ key, combos, cachedAt: Date.now() });
  } catch {
    /* IndexedDB unavailable: live result is still safe to use for this run. */
  }
}
