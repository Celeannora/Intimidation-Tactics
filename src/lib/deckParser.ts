import { db } from "./db";
import type { CardRecord } from "./types";

export interface ParsedDeckEntry {
  quantity: number;
  cardName: string;
  setCode?: string;
  collectorNumber?: string;
  board: "main" | "side";
}

export interface ParsedDeck {
  mainboard: ParsedDeckEntry[];
  sideboard: ParsedDeckEntry[];
  unmatched: string[];
}

export interface ResolvedDeckEntry {
  quantity: number;
  card: CardRecord;
  board: "main" | "side";
}

export interface DeckImportResult {
  resolved: ResolvedDeckEntry[];
  unmatched: string[];
}

// Parse MTGO / Arena decklist text
export function parseDecklistText(raw: string): ParsedDeck {
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const mainboard: ParsedDeckEntry[] = [];
  const sideboard: ParsedDeckEntry[] = [];
  const unmatched: string[] = [];
  let board: "main" | "side" = "main";

  for (const rawLine of lines) {
    const section = parseSectionHeader(rawLine);
    if (section) {
      board = section;
      continue;
    }

    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (lower === "deck" || lower === "mainboard") { board = "main"; continue; }
    if (lower === "sideboard" || lower === "side") { board = "side"; continue; }
    if (line.startsWith("//") || line.startsWith("#")) continue;

    const entry = parseArenaLine(line) ?? parseMTGOLine(line);
    if (!entry) { unmatched.push(line); continue; }
    entry.board = board;
    if (board === "main") mainboard.push(entry);
    else sideboard.push(entry);
  }

  return { mainboard, sideboard, unmatched };
}

function parseSectionHeader(line: string): "main" | "side" | null {
  const normalized = line
    .replace(/^\/\/\s*/, "")
    .replace(/^#\s*/, "")
    .trim()
    .toLowerCase();

  if (normalized === "deck" || normalized === "main" || normalized === "mainboard") return "main";
  if (normalized === "side" || normalized === "sideboard") return "side";
  return null;
}

function stripInlineComment(line: string): string {
  if (line.startsWith("//") || line.startsWith("#")) return "";

  // Treat ` // note` as a comment but preserve split-card names like `Fire // Ice`.
  const slashComment = line.search(/\s\/\/\s+(?:note|notes|comment|sideboard|side|maybe|cut|remove|vs\b|against\b|for\b|anti\b|aggro\b|control\b|midrange\b|ramp\b|combo\b|graveyard\b|removal\b|counter\b|draw\b|threat\b|land\b|fixing\b|hand\b|discard\b|tech\b|flex\b|board\b)/i);
  const hashComment = line.search(/\s#\s*/);
  const cutAt = [slashComment, hashComment].filter((idx) => idx >= 0).sort((a, b) => a - b)[0];
  return cutAt == null ? line : line.slice(0, cutAt);
}

function parseArenaLine(line: string): ParsedDeckEntry | null {
  // Arena format: "4 Lightning Bolt (M21) 150"
  const arenaRe = /^(\d+)\s+(.+?)\s+\((\w+)\)\s+(\d+)$/;
  const m = line.match(arenaRe);
  if (m) return { quantity: Number(m[1]), cardName: m[2].trim(), setCode: m[3].toLowerCase(), collectorNumber: m[4], board: "main" };
  return null;
}

function parseMTGOLine(line: string): ParsedDeckEntry | null {
  // MTGO format: "4 Lightning Bolt"
  const re = /^(\d+)x?\s+(.+)$/;
  const m = line.match(re);
  if (m) return { quantity: Number(m[1]), cardName: m[2].trim(), board: "main" };
  return null;
}

export async function resolveDeckEntries(entries: ParsedDeckEntry[]): Promise<DeckImportResult> {
  const resolved: ResolvedDeckEntry[] = [];
  const unmatched: string[] = [];

  for (const entry of entries) {
    const card = await fuzzyMatchCard(entry.cardName, entry.setCode);
    if (card) resolved.push({ quantity: entry.quantity, card, board: entry.board });
    else unmatched.push(`${entry.quantity} ${entry.cardName}`);
  }

  return { resolved, unmatched };
}

export function cardNameCandidates(name: string): string[] {
  const trimmed = name.trim();
  const candidates = [trimmed];

  if (trimmed.includes(" // ")) {
    const faces = trimmed.split(/\s+\/\/\s+/).map((part) => part.trim()).filter(Boolean);
    if (faces.length > 0) candidates.push(faces[0], ...faces);
  }

  return [...new Set(candidates.filter(Boolean))];
}

async function fuzzyMatchCard(name: string, setCode?: string): Promise<CardRecord | undefined> {
  // Exact match first
  const candidates = cardNameCandidates(name);
  for (const candidate of candidates) {
    const card = await db.cards.where("name").equalsIgnoreCase(candidate).first();
    if (card) return card;
  }

  // Try with set constraint
  if (setCode) {
    for (const candidate of candidates) {
      const card = await db.cards
        .where("name").equalsIgnoreCase(candidate)
        .and((c) => c.setCode === setCode)
        .first();
      if (card) return card;
    }
  }

  // Partial match — starts with
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const card = await db.cards.filter((c) => c.name.toLowerCase().startsWith(lower)).first();
    if (card) return card;
  }

  // Partial match — contains
  for (const candidate of candidates) {
    const lower = candidate.toLowerCase();
    const card = await db.cards.filter((c) => c.name.toLowerCase().includes(lower)).first();
    if (card) return card;
  }

  return undefined;
}
