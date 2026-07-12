import type { CardRecord } from "./types";

export interface DeckCard { quantity: number; card: CardRecord; }
export interface ExportDeck { mainboard: DeckCard[]; sideboard: DeckCard[]; name: string; notes?: string; }

// ── Deck name generation ─────────────────────────────────────────────────────

const COLOR_ORDER = ["W", "U", "B", "R", "G"];
const GUILD: Record<string, string> = {
  WU: "Azorius", WB: "Orzhov", WR: "Boros", WG: "Selesnya",
  UB: "Dimir",   UR: "Izzet",  UG: "Simic",
  BR: "Rakdos",  BG: "Golgari", RG: "Gruul",
};
const SHARD: Record<string, string> = {
  WUB: "Esper",  WUR: "Jeskai", WUG: "Bant",
  WBR: "Mardu",  WBG: "Abzan",  WRG: "Naya",
  UBR: "Grixis", UBG: "Sultai", URG: "Temur", BRG: "Jund",
};

function colorIdentityName(colors: string[]): string {
  const sorted = COLOR_ORDER.filter((c) => colors.includes(c));
  const n = sorted.length;
  if (n === 0) return "Colorless";
  if (n === 1) {
    const mono: Record<string, string> = { W: "Mono-White", U: "Mono-Blue", B: "Mono-Black", R: "Mono-Red", G: "Mono-Green" };
    return mono[sorted[0]] ?? "Mono";
  }
  if (n === 5) return "5-Color";
  if (n === 4) return "4c";
  const key = sorted.join("");
  return GUILD[key] ?? SHARD[key] ?? `${n}c`;
}

function dominantTribeFromCards(mainboard: DeckCard[]): string | null {
  const counts = new Map<string, number>();
  for (const { card, quantity } of mainboard) {
    if (!card.typeLine?.includes("Creature")) continue;
    const parts = card.typeLine.split(/[—-]/);
    if (parts.length < 2) continue;
    for (const t of parts[1].trim().split(/\s+/).filter(Boolean)) {
      if (t.length >= 2) counts.set(t, (counts.get(t) ?? 0) + quantity);
    }
  }
  const total = mainboard
    .filter((e) => e.card.typeLine?.includes("Creature"))
    .reduce((s, e) => s + e.quantity, 0);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 4 || best[1] / Math.max(1, total) < 0.28) return null;
  return best[0][0].toUpperCase() + best[0].slice(1).toLowerCase();
}

function archetypeHintFromCards(mainboard: DeckCard[]): string {
  const total = mainboard.reduce((s, e) => s + e.quantity, 0);
  if (total === 0) return "Deck";
  const creatures = mainboard
    .filter((e) => e.card.typeLine?.includes("Creature"))
    .reduce((s, e) => s + e.quantity, 0);
  // Weighted avg CMC (nonlands)
  const avgCmc = mainboard
    .filter((e) => !e.card.typeLine?.includes("Land"))
    .reduce((s, e) => s + (e.card.cmc ?? 0) * e.quantity, 0) /
    Math.max(1, mainboard.filter((e) => !e.card.typeLine?.includes("Land")).reduce((s, e) => s + e.quantity, 0));
  const creatureShare = creatures / total;
  if (creatureShare >= 0.62 && avgCmc <= 2.5) return "Aggro";
  if (creatureShare <= 0.25) return "Control";
  if (avgCmc >= 4.0) return "Ramp";
  if (creatureShare >= 0.45 && avgCmc <= 3.5) return "Midrange";
  return "Midrange";
}

/** Short format code used in deck name prefix, e.g. "[S]" for Standard. */
const FORMAT_ABBREV: Record<string, string> = {
  "Standard": "S",
  "Pioneer": "P",
  "Modern": "M",
  "Legacy": "L",
  "Vintage": "V",
  "Commander": "C",
  "Brawl": "B",
  "Explorer": "E",
  "Historic": "H",
  "Pauper": "PAU",
  "Alchemy": "A",
  "Future": "F",
};

/**
 * Parse the required colors from a mana cost string using a two-pass hybrid-aware
 * algorithm. Hybrid symbols like {W/U} only introduce a new color if NEITHER side
 * of the hybrid is already established by a hard (non-hybrid) color pip — this
 * prevents a single {W/U} card in a mono-white deck from expanding detection to blue.
 * All-hybrid decks (e.g. pure {U/B}) correctly resolve to both colors.
 */
function extractManaCostColors(manaCost: string | null): string[] {
  const ALL: string[] = ["W", "U", "B", "R", "G"];
  const hard = new Set<string>();
  const hybridPairs: [string, string][] = [];
  const symbols = (manaCost ?? "").match(/\{[^}]+\}/g) ?? [];
  for (const sym of symbols) {
    const inner = sym.slice(1, -1);
    if (ALL.includes(inner)) {
      hard.add(inner);
    } else if (inner.includes("/")) {
      const parts = inner.split("/").filter((p) => ALL.includes(p));
      if (parts.length === 2) hybridPairs.push([parts[0], parts[1]]);
      else if (parts.length === 1) hard.add(parts[0]); // phyrexian {W/P}
    }
  }
  for (const [a, b] of hybridPairs) {
    if (!hard.has(a) && !hard.has(b)) {
      hard.add(a);
      hard.add(b);
    }
  }
  return [...hard];
}

export function generateDeckName(
  deck: ExportDeck,
  overrides?: { archetype?: string; theme?: string; format?: string },
): string {
  const main = deck.mainboard;
  // Resolve colors from nonland mana costs only. Use hybrid-aware parsing so a
  // single {W/U} card in a mono-white deck does NOT expand detection to Azorius.
  const colorSet = new Set<string>();
  for (const { card } of main) {
    if (card.typeLine?.includes("Land")) continue;
    for (const c of extractManaCostColors(card.manaCost ?? null)) colorSet.add(c);
  }
  const colorName = colorIdentityName([...colorSet]);

  const tribe = dominantTribeFromCards(main);
  const arch = overrides?.archetype ?? archetypeHintFromCards(main);
  const theme = overrides?.theme;
  const format = overrides?.format;

  // Key focus: tribe first, then theme
  const keyFocus = tribe ? `${tribe}s` : (theme ?? null);

  // Format prefix: "[S]", "[M]", etc. — omit when format is unknown/empty
  const abbrev = format ? (FORMAT_ABBREV[format] ?? format) : null;
  const prefix = abbrev ? `[${abbrev}] ` : "";

  const core = `${prefix}${colorName} ${arch}`;
  return keyFocus ? `${core} - ${keyFocus}` : core;
}

/**
 * Return the display name for a card as used by Arena and MTGO.
 * Double-faced cards, adventure cards, and split cards store both faces in
 * `name` joined by " // " (e.g. "Commit // Memory", "Delver of Secrets // Insectile Aberration").
 * Arena and MTGO only accept the front-face name when importing decklists, so
 * we strip everything from " // " onward.
 */
function displayName(card: import("./types").CardRecord): string {
  return card.name.split(" // ")[0];
}

export function exportMTGO(deck: ExportDeck): string {
  const lines: string[] = [];
  for (const { quantity, card } of deck.mainboard) lines.push(`${quantity} ${displayName(card)}`);
  if (deck.sideboard.length) {
    lines.push("");
    lines.push("Sideboard");
    for (const { quantity, card } of deck.sideboard) lines.push(`${quantity} ${displayName(card)}`);
  }
  return lines.join("\n");
}

export function exportArena(deck: ExportDeck): string {
  const lines: string[] = [];
  // Prepend Arena's "About" block when the deck has a meaningful name.
  const name = deck.name?.trim();
  if (name && name !== "New Deck") {
    lines.push("About");
    lines.push(`Name ${name}`);
    lines.push("");
  }
  lines.push("Deck");
  for (const { quantity, card } of deck.mainboard) {
    const set = card.setCode.toUpperCase();
    const num = card.collectorNumber ?? "1";
    lines.push(`${quantity} ${displayName(card)} (${set}) ${num}`);
  }
  if (deck.sideboard.length) {
    lines.push("");
    lines.push("Sideboard");
    for (const { quantity, card } of deck.sideboard) {
      const set = card.setCode.toUpperCase();
      const num = card.collectorNumber ?? "1";
      lines.push(`${quantity} ${displayName(card)} (${set}) ${num}`);
    }
  }
  return lines.join("\n");
}

export function exportJSON(deck: ExportDeck): string {
  return JSON.stringify({
    name: deck.name,
    notes: deck.notes ?? "",
    mainboard: deck.mainboard.map(({ quantity, card }) => ({ quantity, oracleId: card.oracleId, name: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber })),
    sideboard: deck.sideboard.map(({ quantity, card }) => ({ quantity, oracleId: card.oracleId, name: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber })),
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export function exportCSV(deck: ExportDeck): string {
  const rows = ["name,quantity,board,setCode,collectorNumber,priceUsd"];
  for (const { quantity, card } of deck.mainboard)
    rows.push(`"${card.name}",${quantity},main,${card.setCode},${card.collectorNumber ?? ""},${card.priceUsd ?? ""}`);
  for (const { quantity, card } of deck.sideboard)
    rows.push(`"${card.name}",${quantity},side,${card.setCode},${card.collectorNumber ?? ""},${card.priceUsd ?? ""}`);
  return rows.join("\n");
}

export function encodeShareableLink(deck: ExportDeck): string {
  const payload = { n: deck.name, m: deck.mainboard.map(({ quantity, card }) => `${quantity}:${card.oracleId}`), s: deck.sideboard.map(({ quantity, card }) => `${quantity}:${card.oracleId}`) };
  const b64 = btoa(JSON.stringify(payload));
  return `${window.location.origin}${window.location.pathname}#deck=${b64}`;
}

export function decodeShareableLink(hash: string): { name: string; main: [number, string][]; side: [number, string][] } | null {
  try {
    const match = hash.match(/#deck=([A-Za-z0-9+/=]+)/);
    if (!match) return null;
    const parsed = JSON.parse(atob(match[1]));
    return {
      name: parsed.n ?? "Imported Deck",
      main: (parsed.m as string[]).map((s) => { const [q, id] = s.split(":"); return [Number(q), id]; }),
      side: (parsed.s as string[]).map((s) => { const [q, id] = s.split(":"); return [Number(q), id]; }),
    };
  } catch { return null; }
}

export function exportShareableLink(deck: ExportDeck): string {
  return encodeShareableLink(deck);
}
