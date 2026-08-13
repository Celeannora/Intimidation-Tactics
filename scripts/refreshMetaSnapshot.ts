/**
 * Refresh the committed Standard meta snapshots from public metagame pages.
 *
 * This is intentionally a Node-only job: the origin sites do not offer the
 * CORS policy needed by the client-only app.  It caches raw responses in
 * .cache/meta-refresh, observes robots.txt where supplied, and is deliberately
 * conservative when a source changes shape or becomes unavailable.
 *
 * Usage: npm run refresh-meta
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { Archetype } from "../src/lib/archetype";
import { inferColorsFromName, inferMacroFromName, parseUntappedMeta, slugifyArchetype } from "../src/lib/meta/liveWinRate";
import { validateSnapshot } from "../src/lib/meta/snapshot";
import type { MetaArchetype, MetaSnapshot } from "../src/lib/meta/types";
import type { ManaColor } from "../src/lib/types";

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, "..");
const DEFAULT_CACHE_DIR = join(ROOT, ".cache", "meta-refresh");
const USER_AGENT = "Intimidation-Tactics-meta-refresh/1.0 (+https://github.com/Celeannora/Intimidation-Tactics)";
const CACHE_TTL_MS = Number(process.env.META_REFRESH_CACHE_TTL_MS ?? 6 * 60 * 60 * 1000);
const REQUEST_DELAY_MS = Number(process.env.META_REFRESH_DELAY_MS ?? 1_250);
const DEFAULT_DECK_LIMIT = Number(process.env.META_REFRESH_DECK_LIMIT ?? 16);

export interface SourceArchetype {
  name: string;
  colors: ManaColor[];
  /** Fraction of a source's observed field, not a percentage. */
  metaShare?: number;
  /** Percent (0–100), available from Untapped only. */
  winRate?: number;
  keyCards: string[];
  /** Mainboard card names from representative published lists. */
  decklists: string[][];
  deckUrl?: string;
}

export interface ParsedSource {
  source: "MTGGoldfish" | "MTGTop8" | "Untapped.gg";
  archetypes: SourceArchetype[];
}

export interface CompetitiveCardRecord {
  name: string;
  playRate: number;
  copiesAvg: number;
  topDeckPresence: number;
}

export interface CompetitiveSnapshot {
  schemaVersion: 1;
  format: "standard";
  updatedAt: string;
  source: string;
  notes: string;
  cards: CompetitiveCardRecord[];
}

const COLOR_ORDER: ManaColor[] = ["W", "U", "B", "R", "G"];
const HTML_ENTITIES: Record<string, string> = {
  "&amp;": "&", "&#39;": "'", "&quot;": '"', "&lt;": "<", "&gt;": ">", "&nbsp;": " ",
};

function decodeHtml(value: string): string {
  return value
    .replace(/<[^>]+>/g, " ")
    .replace(/&(amp|#39|quot|lt|gt|nbsp);/g, (entity) => HTML_ENTITIES[entity] ?? entity)
    .replace(/\s+/g, " ")
    .trim();
}

function normalizeColors(colors: ManaColor[]): ManaColor[] {
  return COLOR_ORDER.filter((color) => colors.includes(color));
}

function colorsFromText(value: string): ManaColor[] {
  const words: Record<string, ManaColor> = { white: "W", blue: "U", black: "B", red: "R", green: "G" };
  const direct = value.toUpperCase().match(/\b[WUBRG]{1,5}\b/g) ?? [];
  const set = new Set<ManaColor>();
  for (const run of direct) for (const char of run) set.add(char as ManaColor);
  for (const [word, color] of Object.entries(words)) {
    if (new RegExp(`\\b${word}\\b`, "i").test(value)) set.add(color);
  }
  return normalizeColors([...set]);
}

function parsePercent(value: string | undefined): number | undefined {
  if (!value) return undefined;
  const numeric = Number.parseFloat(value.replace(/[%,\s]/g, ""));
  return Number.isFinite(numeric) ? numeric / 100 : undefined;
}

/** Parse MTGGoldfish's current server-rendered Standard archetype tiles. */
export function parseMtgGoldfishMeta(html: string): ParsedSource | null {
  const archetypes: SourceArchetype[] = [];
  const tiles = html.match(/<div class='archetype-tile'[\s\S]*?(?=<div class='archetype-tile'|<div class='pagination|<\/main>|$)/g) ?? [];
  for (const tile of tiles) {
    const href = tile.match(/href=["'](\/archetype\/standard-[^"'#?]+)[^"']*["']/i)?.[1];
    const name = tile.match(/archetype-tile-title[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i)?.[1];
    const percent = tile.match(/metagame-percentage[\s\S]*?archetype-tile-statistic-value[^>]*>\s*([\d.]+)%/i)?.[1];
    if (!href || !name || !percent) continue;
    const keyList = tile.match(/archetype-tile-description[\s\S]*?<ul>([\s\S]*?)<\/ul>/i)?.[1] ?? "";
    const keyCards = Array.from(keyList.matchAll(/<li[^>]*>([\s\S]*?)<\/li>/gi)).map((match) => decodeHtml(match[1])).filter(Boolean);
    const displayName = decodeHtml(name);
    const colorText = tile.match(/aria-label=['"]colors:\s*([^'"]+)['"]/i)?.[1] ?? "";
    archetypes.push({
      name: displayName,
      colors: colorsFromText(colorText).length > 0 ? colorsFromText(colorText) : inferColorsFromName(displayName),
      metaShare: parsePercent(percent),
      keyCards,
      decklists: [],
      deckUrl: new URL(href, "https://www.mtggoldfish.com").toString(),
    });
  }
  return archetypes.length > 0 ? { source: "MTGGoldfish", archetypes } : null;
}

/** Parse mainboard card names from MTGGoldfish's encoded deck component calls. */
export function parseMtgGoldfishDecklists(html: string): string[][] {
  const lists: string[][] = [];
  const calls = html.matchAll(/initializeDeckComponents\(\s*'[^']*'\s*,\s*'[^']*'\s*,\s*"([^"]*)"/g);
  for (const call of calls) {
    try {
      const lines = decodeURIComponent(call[1]).split(/\r?\n/);
      const mainboard: string[] = [];
      for (const line of lines) {
        if (line.trim().toLowerCase() === "sideboard") break;
        const card = line.match(/^\s*\d+\s+(.+?)\s*$/)?.[1]?.trim();
        if (card) mainboard.push(card);
      }
      if (mainboard.length > 0) lists.push(mainboard);
    } catch {
      // An individual malformed list is not a reason to discard a whole source.
    }
  }
  return lists;
}

/** Parse MTGTop8's current `format?f=ST` metagame breakdown. */
export function parseMtgTop8Meta(html: string): ParsedSource | null {
  const archetypes: SourceArchetype[] = [];
  // MTGTop8 currently emits unquoted hrefs with literal ampersands, while some
  // older layouts use quoted `&amp;` attributes; accept both forms.
  const items = html.matchAll(/<a\s+href\s*=\s*["']?archetype\?a=(\d+)&(?:amp;)?meta=(\d+)&(?:amp;)?f=ST["']?[^>]*>([^<]+)<\/a>[\s\S]{0,600}?>(\d+(?:\.\d+)?)\s*%/gi);
  for (const item of items) {
    const name = decodeHtml(item[3]);
    archetypes.push({
      name,
      colors: colorsFromText(name).length > 0 ? colorsFromText(name) : inferColorsFromName(name),
      metaShare: parsePercent(item[4]),
      keyCards: [],
      decklists: [],
      deckUrl: `https://mtgtop8.com/archetype?a=${item[1]}&meta=${item[2]}&f=ST`,
    });
  }
  return archetypes.length > 0 ? { source: "MTGTop8", archetypes } : null;
}

/** Adapt the browser's exported Untapped parser for the Node refresh pipeline. */
export function parseUntappedSource(html: string): ParsedSource | null {
  const dataset = parseUntappedMeta(html, "standard", "ladder");
  if (!dataset) return null;
  return {
    source: "Untapped.gg",
    archetypes: dataset.archetypes.map((archetype) => ({
      name: archetype.name,
      colors: archetype.colors,
      metaShare: archetype.playRate == null ? undefined : archetype.playRate / 100,
      winRate: archetype.winRate,
      keyCards: [],
      decklists: [],
    })),
  };
}

function tokenSet(value: string): Set<string> {
  const ignored = new Set(["the", "deck", "mtg", "standard"]);
  return new Set(value.toLowerCase().split(/[^a-z0-9]+/).filter((token) => token.length > 1 && !ignored.has(token)));
}

function setJaccard<T>(left: Set<T>, right: Set<T>): number {
  if (left.size === 0 || right.size === 0) return 0;
  let intersection = 0;
  for (const item of left) if (right.has(item)) intersection++;
  return intersection / (left.size + right.size - intersection);
}

function sameColors(left: ManaColor[], right: ManaColor[]): boolean {
  return left.length > 0 && left.length === right.length && left.every((color, index) => color === right[index]);
}

function archetypesMatch(left: SourceArchetype, right: SourceArchetype): boolean {
  const nameScore = setJaccard(tokenSet(left.name), tokenSet(right.name));
  if (nameScore >= 0.5) return true;
  if (!sameColors(left.colors, right.colors)) return false;
  const leftMacro = inferMacroFromName(left.name);
  const rightMacro = inferMacroFromName(right.name);
  return nameScore >= 0.2 || (leftMacro != null && leftMacro === rightMacro);
}

function normalizedSourceArchetypes(source: ParsedSource): SourceArchetype[] {
  const total = source.archetypes.reduce((sum, archetype) => sum + (archetype.metaShare ?? 0), 0);
  if (total <= 0) return source.archetypes;
  return source.archetypes.map((archetype) => ({ ...archetype, metaShare: archetype.metaShare == null ? undefined : archetype.metaShare / total }));
}

interface ArchetypeCluster {
  entries: Array<{ source: ParsedSource["source"]; archetype: SourceArchetype }>;
}

function dedupeNames(names: string[], limit?: number): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const name of names) {
    const cleaned = name.trim();
    const key = cleaned.toLocaleLowerCase();
    if (!cleaned || seen.has(key)) continue;
    seen.add(key);
    out.push(cleaned);
    if (limit != null && out.length >= limit) break;
  }
  return out;
}

function macroFor(entries: ArchetypeCluster["entries"]): Archetype {
  for (const entry of entries) {
    const macro = inferMacroFromName(entry.archetype.name);
    if (macro) return macro;
  }
  return "Unknown";
}

function speedFor(macro: Archetype): MetaArchetype["speed"] {
  if (macro === "Aggro" || macro === "Tempo") return "fast";
  if (macro === "Control" || macro === "Prison") return "slow";
  return "medium";
}

/**
 * Merge sources by fuzzy name plus strict colour identity. Each source is first
 * normalized to a full field, then every available source has equal weight.
 */
export function mergeMetaSources(sources: ParsedSource[], updatedAt = new Date().toISOString()): MetaSnapshot {
  const clusters: ArchetypeCluster[] = [];
  for (const source of sources) {
    for (const archetype of normalizedSourceArchetypes(source)) {
      const cluster = clusters.find((candidate) => candidate.entries.some((entry) => archetypesMatch(entry.archetype, archetype)));
      if (cluster) cluster.entries.push({ source: source.source, archetype });
      else clusters.push({ entries: [{ source: source.source, archetype }] });
    }
  }

  const sourceNames = sources.map((source) => source.source).join(" + ");
  const archetypes: MetaArchetype[] = clusters.map((cluster) => {
    const sourcePriority: Record<ParsedSource["source"], number> = {
      "MTGGoldfish": 0,
      "Untapped.gg": 1,
      "MTGTop8": 2,
    };
    const representative = [...cluster.entries].sort((left, right) =>
      sourcePriority[left.source] - sourcePriority[right.source]
      || (right.archetype.metaShare ?? 0) - (left.archetype.metaShare ?? 0),
    )[0].archetype;
    // Missing archetypes count as zero for a source. Averaging only sources
    // which happened to publish a given name would inflate small one-source
    // rows and makes a merged field cease to sum to 100%.
    const metaShare = sources.reduce((sum, source) =>
      sum + cluster.entries
        .filter((entry) => entry.source === source.source)
        .reduce((sourceSum, entry) => sourceSum + (entry.archetype.metaShare ?? 0), 0),
    0) / sources.length;
    const decklists = cluster.entries.flatMap((entry) => entry.archetype.decklists);
    const cardCounts = new Map<string, number>();
    for (const list of decklists) for (const card of new Set(list.map((name) => name.trim()))) cardCounts.set(card, (cardCounts.get(card) ?? 0) + 1);
    const deckCards = [...cardCounts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])).map(([name]) => name);
    const keyCards = dedupeNames([...representative.keyCards, ...deckCards], 12);
    const colors = representative.colors.length > 0
      ? representative.colors
      : cluster.entries.find((entry) => entry.archetype.colors.length > 0)?.archetype.colors ?? [];
    const macro = macroFor(cluster.entries);
    return {
      id: slugifyArchetype(representative.name),
      name: representative.name,
      colors,
      macro,
      metaShare: Math.round(metaShare * 10_000) / 10_000,
      keyCards,
      cardNames: dedupeNames([...deckCards, ...representative.keyCards]),
      commonInteraction: [],
      speed: speedFor(macro),
      notes: `Merged from ${dedupeNames(cluster.entries.map((entry) => entry.source)).join(" + ")}.`,
    };
  }).filter((archetype) => archetype.metaShare > 0);

  // Source fields can sometimes round above 100%; retain the highest-share rows
  // but scale once so validateSnapshot's hard guard remains meaningful.
  const shareSum = archetypes.reduce((sum, archetype) => sum + archetype.metaShare, 0);
  if (shareSum > 1) for (const archetype of archetypes) archetype.metaShare = Math.round((archetype.metaShare / shareSum) * 10_000) / 10_000;
  archetypes.sort((left, right) => right.metaShare - left.metaShare || left.name.localeCompare(right.name));
  const usedSources = sources.length === 3 ? sourceNames : `${sourceNames} (degraded: ${sources.length}/3 sources available)`;
  return { schemaVersion: 1, format: "standard", updatedAt, source: `server-side refresh — ${usedSources}`, archetypes };
}

/** Build a per-card inclusion-frequency snapshot from fetched representative mainboards. */
export function buildCompetitiveSnapshot(sources: ParsedSource[], updatedAt: string): CompetitiveSnapshot {
  const decklists = sources.flatMap((source) => source.archetypes.flatMap((archetype) => archetype.decklists));
  const cardStats = new Map<string, { decks: number; copies: number }>();
  for (const list of decklists) {
    const copies = new Map<string, number>();
    for (const card of list) copies.set(card, (copies.get(card) ?? 0) + 1);
    for (const [name, quantity] of copies) {
      const previous = cardStats.get(name) ?? { decks: 0, copies: 0 };
      previous.decks++;
      previous.copies += quantity;
      cardStats.set(name, previous);
    }
  }
  const denominator = Math.max(decklists.length, 1);
  const cards = [...cardStats.entries()]
    .map(([name, value]) => ({
      name,
      playRate: Math.round((value.decks / denominator) * 10_000) / 10_000,
      copiesAvg: Math.round((value.copies / value.decks) * 100) / 100,
      // All fetched lists are source-published representative/top lists, so this
      // is a transparent proxy rather than pretending to have match results.
      topDeckPresence: Math.round((value.decks / denominator) * 10_000) / 10_000,
    }))
    .sort((left, right) => right.playRate - left.playRate || right.copiesAvg - left.copiesAvg || left.name.localeCompare(right.name));
  return {
    schemaVersion: 1,
    format: "standard",
    updatedAt: updatedAt.slice(0, 10),
    source: "MTGGoldfish representative Standard decklists fetched by scripts/refreshMetaSnapshot.ts",
    notes: `Inclusion frequency across ${decklists.length} fetched representative mainboards; topDeckPresence is a published-list presence proxy, not a win rate.`,
    cards,
  };
}

export interface RefreshOutputPaths {
  metaPath: string;
  competitivePath: string;
}

/** Validate before touching either tracked output, so a bad refresh is atomic from the caller's perspective. */
export function writeRefreshOutputs(snapshot: MetaSnapshot, competitive: CompetitiveSnapshot, paths: RefreshOutputPaths): void {
  const validation = validateSnapshot(snapshot);
  if (!validation.valid) throw new Error(`Refusing to write invalid meta snapshot: ${validation.errors.join("; ")}`);
  writeFileSync(paths.metaPath, `${JSON.stringify(snapshot, null, 2)}\n`, "utf8");
  writeFileSync(paths.competitivePath, `${JSON.stringify(competitive, null, 2)}\n`, "utf8");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}

function cachePath(cacheDir: string, key: string): string {
  return join(cacheDir, `${key.replace(/[^a-z0-9._-]+/gi, "-")}.html`);
}

async function fetchTextCached(url: string, key: string, cacheDir: string, delay: () => Promise<void>): Promise<string> {
  const path = cachePath(cacheDir, key);
  if (existsSync(path) && Date.now() - Number.parseInt(readFileSync(`${path}.mtime`, "utf8"), 10) < CACHE_TTL_MS) {
    return readFileSync(path, "utf8");
  }
  await delay();
  const response = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "text/html,application/json" } });
  if (!response.ok) throw new Error(`${url} returned HTTP ${response.status}`);
  const text = await response.text();
  mkdirSync(cacheDir, { recursive: true });
  writeFileSync(path, text, "utf8");
  writeFileSync(`${path}.mtime`, String(Date.now()), "utf8");
  return text;
}

function pathIsDisallowed(robots: string, target: URL): boolean {
  const lines = robots.split(/\r?\n/);
  let applies = false;
  const disallowed: string[] = [];
  for (const raw of lines) {
    const line = raw.replace(/#.*/, "").trim();
    const [field, ...rest] = line.split(":");
    const value = rest.join(":").trim();
    if (!field || !value) continue;
    if (field.toLowerCase() === "user-agent") applies = value === "*";
    if (applies && field.toLowerCase() === "disallow" && value !== "/") disallowed.push(value);
    if (applies && field.toLowerCase() === "disallow" && value === "/") return true;
  }
  return disallowed.some((path) => target.pathname.startsWith(path));
}

async function sourceAllowed(url: string, sourceKey: string, cacheDir: string, delay: () => Promise<void>): Promise<boolean> {
  const target = new URL(url);
  const robotsUrl = `${target.protocol}//${target.host}/robots.txt`;
  try {
    const robots = await fetchTextCached(robotsUrl, `${sourceKey}-robots`, cacheDir, delay);
    if (pathIsDisallowed(robots, target)) {
      console.warn(`[meta-refresh] ${sourceKey} robots.txt disallows ${target.pathname}; source skipped.`);
      return false;
    }
  } catch (error) {
    // A missing robots.txt (currently MTGTop8 returns 404) is not treated as a
    // block; retain the failure in logs and still use the public format page.
    console.warn(`[meta-refresh] ${sourceKey} robots.txt unavailable (${error instanceof Error ? error.message : String(error)}); proceeding cautiously.`);
  }
  return true;
}

async function enrichGoldfishDecklists(source: ParsedSource, cacheDir: string, delay: () => Promise<void>): Promise<void> {
  for (const [index, archetype] of source.archetypes.slice(0, DEFAULT_DECK_LIMIT).entries()) {
    if (!archetype.deckUrl) continue;
    try {
      const html = await fetchTextCached(archetype.deckUrl, `goldfish-archetype-${index}-${slugifyArchetype(archetype.name)}`, cacheDir, delay);
      archetype.decklists = parseMtgGoldfishDecklists(html);
    } catch (error) {
      console.warn(`[meta-refresh] MTGGoldfish decklist for ${archetype.name} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }
}

export async function main(): Promise<void> {
  const cacheDir = process.env.META_REFRESH_CACHE_DIR ?? DEFAULT_CACHE_DIR;
  let lastRequestAt = 0;
  const delay = async () => {
    const wait = REQUEST_DELAY_MS - (Date.now() - lastRequestAt);
    if (wait > 0) await sleep(wait);
    lastRequestAt = Date.now();
  };
  const plans: Array<{ key: string; url: string; parser: (html: string) => ParsedSource | null }> = [
    { key: "goldfish", url: "https://www.mtggoldfish.com/metagame/standard", parser: parseMtgGoldfishMeta },
    { key: "top8", url: "https://mtgtop8.com/format?f=ST", parser: parseMtgTop8Meta },
    { key: "untapped", url: "https://mtga.untapped.gg/constructed/standard/meta", parser: parseUntappedSource },
  ];
  const sources: ParsedSource[] = [];

  for (const plan of plans) {
    try {
      if (!await sourceAllowed(plan.url, plan.key, cacheDir, delay)) continue;
      const html = await fetchTextCached(plan.url, `${plan.key}-standard-meta`, cacheDir, delay);
      const source = plan.parser(html);
      if (!source) throw new Error("page did not contain a usable metagame table");
      if (source.source === "MTGGoldfish") await enrichGoldfishDecklists(source, cacheDir, delay);
      sources.push(source);
      console.log(`[meta-refresh] ${source.source}: ${source.archetypes.length} archetypes parsed.`);
    } catch (error) {
      console.warn(`[meta-refresh] ${plan.key} skipped: ${error instanceof Error ? error.message : String(error)}`);
    }
  }

  if (sources.length === 0) throw new Error("All meta sources failed; refusing to overwrite committed snapshots.");
  const updatedAt = new Date().toISOString();
  const snapshot = mergeMetaSources(sources, updatedAt);
  const competitive = buildCompetitiveSnapshot(sources, updatedAt);
  writeRefreshOutputs(snapshot, competitive, {
    metaPath: join(ROOT, "src", "data", "meta", "standard-snapshot.json"),
    competitivePath: join(ROOT, "src", "data", "competitive", "standard-snapshot.json"),
  });
  console.log(`[meta-refresh] Wrote ${snapshot.archetypes.length} archetypes and ${competitive.cards.length} card-frequency records from ${sources.map((source) => source.source).join(", ")}.`);
}

const executedPath = process.argv[1] ? resolve(process.argv[1]) : "";
if (executedPath && executedPath === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(`[meta-refresh] ${error instanceof Error ? error.message : String(error)}`);
    process.exitCode = 1;
  });
}
