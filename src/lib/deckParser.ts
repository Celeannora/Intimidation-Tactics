import { db } from "./db";
import { maxCopiesForCard } from "./legality";
import { assertDeckBudget, assertDeckQuantity, MAX_DECK_INPUT_LENGTH, MAX_DECK_ROWS } from "./deckInput";
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
  /**
   * True when the input text appears to contain more than one separate
   * decklist (e.g. the user pasted three 60-card lists into the same
   * textarea).  Callers should show a warning and ask the user to confirm
   * before committing the import.
   *
   * Detection heuristics (any one triggers this flag):
   *   • More than one "Deck" / "// Deck" section header found
   *   • Total card-copy count across mainboard > 100
   */
  multipleDecksDetected: boolean;
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
  if (raw.length > MAX_DECK_INPUT_LENGTH) throw new Error("Deck input is too large.");
  const lines = raw.split("\n").map((l) => l.trim()).filter(Boolean);
  const mainboard: ParsedDeckEntry[] = [];
  const sideboard: ParsedDeckEntry[] = [];
  const unmatched: string[] = [];
  let board: "main" | "side" = "main";
  // Count how many times we see a "Deck" / "// Deck" header — more than one
  // strongly suggests the user pasted multiple separate decklists.
  let deckHeaderCount = 0;

  for (const rawLine of lines) {
    if (rawLine.length > 1_024) throw new Error("Deck input line exceeds 1024 characters.");
    // Skip Arena "About" section headers and "Name ..." deck-title lines so that
    // re-importing an exported Arena decklist doesn't produce unmatched entries.
    const lowerRaw = rawLine.toLowerCase();
    if (lowerRaw === "about") continue;
    if (lowerRaw.startsWith("name ")) continue;

    const section = parseSectionHeader(rawLine);
    if (section) {
      if (section === "main") deckHeaderCount++;
      board = section;
      continue;
    }

    const line = stripInlineComment(rawLine).trim();
    if (!line) continue;

    const lower = line.toLowerCase();
    if (lower === "deck" || lower === "mainboard") { deckHeaderCount++; board = "main"; continue; }
    if (lower === "sideboard" || lower === "side") { board = "side"; continue; }
    if (line.startsWith("//") || line.startsWith("#")) continue;

    const entry = parseCardLine(line);
    if (!entry) { unmatched.push(line); continue; }
    entry.board = board;
    if (board === "main") mainboard.push(entry);
    else sideboard.push(entry);
  }

  // Detect multiple-deck paste:
  //   • >1 explicit "Deck" section header, OR
  //   • mainboard total card copies > 100 (no single legal deck exceeds that)
  const mainboardTotal = mainboard.reduce((s, e) => s + e.quantity, 0);
  const multipleDecksDetected = deckHeaderCount > 1 || mainboardTotal > 100;

  assertDeckBudget([...mainboard, ...sideboard]);
  return { mainboard, sideboard, unmatched, multipleDecksDetected };
}

export function parseDeckJSON(raw: string): ParsedDeckEntry[] {
  if (raw.length > MAX_DECK_INPUT_LENGTH) throw new Error("Deck input is too large.");
  const data = JSON.parse(raw);
  if (!data || typeof data !== "object" || Array.isArray(data) ||
      (!Object.hasOwn(data, "mainboard") && !Object.hasOwn(data, "sideboard"))) throw new Error("Invalid JSON deck.");
  const entries: ParsedDeckEntry[] = [];
  for (const [key, board] of [["mainboard", "main"], ["sideboard", "side"]] as const) {
    const rows: unknown = Object.hasOwn(data, key) ? data[key] : [];
    if (!Array.isArray(rows) || rows.length + entries.length > MAX_DECK_ROWS) throw new Error("Invalid or oversized JSON board.");
    for (const row of rows) {
      if (!row || typeof row !== "object" || typeof row.name !== "string" || !row.name.trim() || row.name.length > 512) {
        throw new Error("Invalid JSON card name.");
      }
      entries.push({ quantity: row.quantity, cardName: row.name, board });
    }
  }
  assertDeckBudget(entries);
  return entries;
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
  // Lines that start with // are full-line comments (or section headers — handled upstream).
  if (line.startsWith("//") || line.startsWith("#")) return "";

  // Strip # comments (e.g. "4 Duress # hand disruption") — # never appears in card names.
  const hashComment = line.search(/\s#\s/);
  if (hashComment >= 0) return line.slice(0, hashComment);

  // Disambiguate " // comment" from a split/double-faced card name:
  //   • MTG split/DFC faces are always Title Case ("Fire // Ice",
  //     "Throne of the Grim Captain // The Grim Captain"), so a segment whose
  //     first character is lowercase ("// hand disruption") is inline prose and
  //     is stripped.
  //   • Title-Case segments are left intact as part of the card name; if the
  //     full name later fails to resolve, cardNameCandidates falls back to the
  //     front face alone.
  const slashComment = line.match(/\s\/\/\s+(.*)$/);
  if (slashComment && /^[a-z]/.test(slashComment[1])) {
    return line.slice(0, slashComment.index);
  }

  return line;
}

function parseCardLine(line: string): ParsedDeckEntry | null {
  // Split the quantity once. Overlapping whitespace/name regexes can backtrack
  // polynomially when an attacker omits the optional Arena suffix.
  const separator = line.search(/\s/u);
  if (separator < 1) return null;
  const token = line.slice(0, separator);
  if (!/^\d+x?$/.test(token)) return null;
  const quantity = Number(token.endsWith("x") ? token.slice(0, -1) : token);
  assertDeckQuantity(quantity);
  const remainder = line.slice(separator).trim();
  if (!remainder) return null;
  const paren = remainder.lastIndexOf("(");
  if (paren > 0 && /\s/u.test(remainder[paren - 1])) {
    const suffix = remainder.slice(paren).match(/^\((\w{1,32})\)\s+(\d{1,32})$/);
    if (suffix) return {
      quantity, cardName: remainder.slice(0, paren).trim(),
      setCode: suffix[1].toLowerCase(), collectorNumber: suffix[2], board: "main",
    };
  }
  return { quantity, cardName: remainder, board: "main" };
}

export async function resolveDeckEntries(entries: ParsedDeckEntry[]): Promise<DeckImportResult> {
  if (!Array.isArray(entries)) throw new Error("Deck entries must be an array.");
  assertDeckBudget(entries);
  for (const entry of entries) {
    if (typeof entry.cardName !== "string" || !entry.cardName.trim() || entry.cardName.length > 512 ||
        (entry.board !== "main" && entry.board !== "side") ||
        (entry.setCode !== undefined && (typeof entry.setCode !== "string" || entry.setCode.length > 32))) {
      throw new Error("Invalid deck card name or board.");
    }
  }
  const resolved = new Map<string, ResolvedDeckEntry>();
  const unmatched: string[] = [];

  for (const entry of entries) {
    const card = await fuzzyMatchCard(entry.cardName, entry.setCode);
    if (card) {
      const key = JSON.stringify([entry.board, card.oracleId]);
      const existing = resolved.get(key);
      const quantity = Math.min((existing?.quantity ?? 0) + entry.quantity, maxCopiesForCard(card));
      resolved.set(key, { quantity, card: existing?.card ?? card, board: entry.board });
    } else unmatched.push(`${entry.quantity} ${entry.cardName}`);
  }

  return { resolved: [...resolved.values()], unmatched };
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
