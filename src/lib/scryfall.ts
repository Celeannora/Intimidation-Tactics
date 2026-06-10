import type { CardRecord, ScryfallCard, ScryfallCardFace } from "./types";

const EXCLUDED_SET_TYPES = new Set(["token", "memorabilia", "minigame"]);
const EXCLUDED_TYPE_TERMS = [
  "Token",
  "Scheme",
  "Vanguard",
  "Conspiracy",
  "Art Series"
];

function safeJson(value: unknown): string {
  return JSON.stringify(value ?? []);
}

function parsePrice(value?: string | null): number | null {
  if (!value) return null;
  const n = Number(value);
  return Number.isFinite(n) ? n : null;
}

function getNormalImage(card: ScryfallCard): string | null {
  if (card.image_uris?.normal) return card.image_uris.normal;
  if (Array.isArray(card.card_faces)) {
    for (const face of card.card_faces) {
      if (face.image_uris?.normal) return face.image_uris.normal;
    }
  }
  return null;
}

function mergeFaceText(cardFaces?: ScryfallCardFace[]): string | null {
  if (!cardFaces?.length) return null;
  const text = cardFaces
    .map((f) => [f.name, f.type_line, f.oracle_text].filter(Boolean).join(" — "))
    .filter(Boolean)
    .join("\n//\n");
  return text || null;
}

function isExcludedByTypeLine(typeLine: string): boolean {
  return EXCLUDED_TYPE_TERMS.some((term) => typeLine.includes(term));
}

export function isImportEligible(card: ScryfallCard): boolean {
  if (card.lang !== "en") return false;
  if (!card.type_line || isExcludedByTypeLine(card.type_line)) return false;
  if (EXCLUDED_SET_TYPES.has(card.set_type ?? "")) return false;
  return true;
}

export function isStandardEligible(card: ScryfallCard): boolean {
  return isImportEligible(card) && (card.legalities?.standard ?? "") === "legal";
}

export function toCardRecord(card: ScryfallCard, importedAt: string): CardRecord {
  const oracleText = card.oracle_text ?? mergeFaceText(card.card_faces) ?? null;
  const keywords = card.keywords ?? [];
  const colors = card.colors ?? [];
  const colorIdentity = card.color_identity ?? [];
  const producedMana = card.produced_mana ?? [];
  const imageNormal = getNormalImage(card);

  const searchParts = [
    card.name,
    card.type_line,
    oracleText ?? "",
    keywords.join(" "),
    card.flavor_text ?? ""
  ]
    .join(" ")
    .trim()
    .toLowerCase();

  return {
    id: card.id,
    oracleId: card.oracle_id,
    name: card.name,
    lang: card.lang,
    layout: card.layout,
    cardFacesJson: card.card_faces ? JSON.stringify(card.card_faces) : null,

    manaCost: card.mana_cost ?? null,
    cmc: Number(card.cmc ?? 0),
    colorsJson: safeJson(colors),
    colorIdentityJson: safeJson(colorIdentity),
    typeLine: card.type_line,
    oracleText,
    keywordsJson: safeJson(keywords),
    power: card.power ?? null,
    toughness: card.toughness ?? null,
    loyalty: card.loyalty ?? null,
    producedManaJson: safeJson(producedMana),

    legalityStandard: card.legalities?.standard ?? null,
    legalityFuture: card.legalities?.future ?? null,
    bannedInStandard: card.legalities?.standard === "banned" ? 1 : 0,
    legalitiesJson: JSON.stringify(card.legalities ?? {}),

    setCode: card.set,
    setName: card.set_name,
    setType: card.set_type ?? null,
    collectorNumber: card.collector_number ?? null,
    rarity: card.rarity ?? null,

    imageNormal,
    priceUsd: parsePrice(card.prices?.usd),
    priceUsdFoil: parsePrice(card.prices?.usd_foil),
    priceEur: parsePrice(card.prices?.eur),
    edhrecRank: card.edhrec_rank ?? null,
    gameChanger: card.game_changer ? 1 : 0,

    flavorText: card.flavor_text ?? null,
    artist: card.artist ?? null,

    searchText: searchParts,
    importedAt
  };
}
