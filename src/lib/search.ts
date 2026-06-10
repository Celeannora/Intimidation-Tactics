import { db } from "./db";
import type { CardRecord } from "./types";

export type SortField =
  | "name"
  | "cmc"
  | "priceUsd"
  | "rarity"
  | "edhrecRank"
  | "gameChanger";

export type SortDirection = "asc" | "desc";

export interface CardFilters {
  text?: string;
  types?: string[];
  subtype?: string;
  colors?: string[];
  colorMode?: "includes" | "exactly" | "atMost";
  colorless?: boolean;
  cmcMin?: number;
  cmcMax?: number;
  rarities?: string[];
  sets?: string[];
  keywords?: string[];
  roles?: string[];
  maxPriceUsd?: number;
  includeFuture?: boolean;
  sort?: SortField;
  direction?: SortDirection;
  page?: number;
  perPage?: number;
}

const RARITY_ORDER: Record<string, number> = {
  mythic: 4,
  rare: 3,
  uncommon: 2,
  common: 1,
};

function matchesText(card: CardRecord, text: string): boolean {
  const q = text.toLowerCase();
  return (
    card.name.toLowerCase().includes(q) ||
    (card.oracleText?.toLowerCase().includes(q) ?? false) ||
    card.typeLine.toLowerCase().includes(q) ||
    (card.flavorText?.toLowerCase().includes(q) ?? false)
  );
}

function matchesColors(
  card: CardRecord,
  colors: string[],
  mode: "includes" | "exactly" | "atMost"
): boolean {
  const cardColors: string[] = JSON.parse(card.colorsJson);
  if (mode === "exactly") {
    return (
      cardColors.length === colors.length &&
      colors.every((c) => cardColors.includes(c))
    );
  }
  if (mode === "atMost") {
    return cardColors.every((c) => colors.includes(c));
  }
  return colors.every((c) => cardColors.includes(c));
}

function matchesTypes(card: CardRecord, types: string[]): boolean {
  return types.some((t) => card.typeLine.includes(t));
}

function matchesKeywords(card: CardRecord, keywords: string[]): boolean {
  const cardKws: string[] = JSON.parse(card.keywordsJson);
  return keywords.every((kw) =>
    cardKws.some((k) => k.toLowerCase() === kw.toLowerCase())
  );
}

function getSortValue(card: CardRecord, field: SortField): number | string {
  switch (field) {
    case "name": return card.name;
    case "cmc": return card.cmc;
    case "priceUsd": return card.priceUsd ?? 9999;
    case "rarity": return RARITY_ORDER[card.rarity ?? "common"] ?? 0;
    case "edhrecRank": return card.edhrecRank ?? 999999;
    case "gameChanger": return card.gameChanger;
    default: return card.name;
  }
}

export async function searchCards(filters: CardFilters): Promise<{
  cards: CardRecord[];
  total: number;
}> {
  const {
    text,
    types,
    subtype,
    colors,
    colorMode = "includes",
    colorless,
    cmcMin,
    cmcMax,
    rarities,
    sets,
    keywords,
    maxPriceUsd,
    includeFuture = false,
    sort = "name",
    direction = "asc",
    page = 1,
    perPage = 50,
  } = filters;

  let results = await db.cards.where("legalityStandard").equals("legal").toArray();

  if (includeFuture) {
    const futureCards = await db.cards
      .where("legalityFuture")
      .equals("legal")
      .toArray();
    const existingIds = new Set(results.map((c) => c.id));
    futureCards.forEach((c) => {
      if (!existingIds.has(c.id)) results.push(c);
    });
  }

  if (text?.trim()) {
    results = results.filter((c) => matchesText(c, text.trim()));
  }
  if (types?.length) {
    results = results.filter((c) => matchesTypes(c, types));
  }
  if (subtype?.trim()) {
    const st = subtype.trim().toLowerCase();
    results = results.filter((c) => c.typeLine.toLowerCase().includes(st));
  }
  if (colors?.length) {
    if (colorless) {
      results = results.filter((c) => {
        const cc: string[] = JSON.parse(c.colorsJson);
        return cc.length === 0;
      });
    } else {
      results = results.filter((c) => matchesColors(c, colors, colorMode));
    }
  } else if (colorless) {
    results = results.filter((c) => {
      const cc: string[] = JSON.parse(c.colorsJson);
      return cc.length === 0;
    });
  }
  if (cmcMin !== undefined) {
    results = results.filter((c) => c.cmc >= cmcMin);
  }
  if (cmcMax !== undefined) {
    results = results.filter((c) => c.cmc <= cmcMax);
  }
  if (rarities?.length) {
    results = results.filter((c) => rarities.includes(c.rarity ?? ""));
  }
  if (sets?.length) {
    results = results.filter((c) => sets.includes(c.setCode));
  }
  if (keywords?.length) {
    results = results.filter((c) => matchesKeywords(c, keywords));
  }
  if (maxPriceUsd !== undefined) {
    results = results.filter(
      (c) => c.priceUsd !== null && c.priceUsd <= maxPriceUsd
    );
  }

  results.sort((a, b) => {
    const av = getSortValue(a, sort);
    const bv = getSortValue(b, sort);
    const mul = direction === "asc" ? 1 : -1;
    if (typeof av === "string" && typeof bv === "string") {
      return av.localeCompare(bv) * mul;
    }
    return ((av as number) - (bv as number)) * mul;
  });

  const total = results.length;
  const start = (page - 1) * perPage;
  const cards = results.slice(start, start + perPage);

  return { cards, total };
}

export async function getCardById(id: string): Promise<CardRecord | undefined> {
  return db.cards.get(id);
}

export async function getAllKeywords(): Promise<string[]> {
  const all = await db.cards.toArray();
  const set = new Set<string>();
  for (const card of all) {
    const kws: string[] = JSON.parse(card.keywordsJson);
    kws.forEach((k) => set.add(k));
  }
  return Array.from(set).sort();
}

export async function getStandardSets(): Promise<
  Array<{ setCode: string; setName: string }>
> {
  const all = await db.cards
    .where("legalityStandard")
    .equals("legal")
    .toArray();
  const seen = new Map<string, string>();
  for (const c of all) {
    if (!seen.has(c.setCode)) seen.set(c.setCode, c.setName);
  }
  return Array.from(seen.entries())
    .map(([setCode, setName]) => ({ setCode, setName }))
    .sort((a, b) => a.setName.localeCompare(b.setName));
}
