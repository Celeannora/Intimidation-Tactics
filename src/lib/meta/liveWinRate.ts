/**
 * liveWinRate.ts — Track 2 competitive-strength data source.
 *
 * Fetches real per-archetype win-rate data from Untapped.gg's public
 * constructed meta pages (aggregated from real MTG Arena ladder games) and
 * caches it in IndexedDB with a ~24h refresh cadence.
 *
 * This is the *only* legitimate source for a deck's competitive-strength
 * signal: a win rate is a real match outcome, not a heuristic. Decks that do
 * not match a tracked archetype get NO competitive number at all (see
 * {@link ../meta/archetypeMatch} and mythicViability's Track 2) rather than a
 * synthesized one — that fake-confidence behaviour is the exact bug this
 * architecture removes.
 *
 * Hard limit made explicit: no data source has a win rate for a deck nobody
 * has played. When the network path is unavailable (Untapped.gg is not
 * CORS-accessible from every deployment) callers fall back to cached data, and
 * when there is no cache the competitive track is honestly reported as
 * "no comparable market data".
 */

import type { ManaColor } from "../types";
import type { Archetype } from "../archetype";
import type { ConstructedFormat, PlayEnvironment } from "../formats";
import { db } from "../db";

/** Real win-rate record for one tracked archetype. */
export interface LiveArchetypeWinRate {
  /** Stable kebab-case id derived from the display name. */
  id: string;
  /** Display name as published, e.g. "Izzet Prowess". */
  name: string;
  /** Colour identity of the archetype core (WUBRG subset). */
  colors: ManaColor[];
  /** Best-effort macro classification inferred from the name. */
  macro?: Archetype;
  /** Real win rate as a percentage in [0, 100]. */
  winRate: number;
  /** Play rate / meta share as a percentage, when published. */
  playRate?: number;
  /** Number of games/matches backing the win rate, when published. */
  sampleSize?: number;
  /** 95% Wilson confidence interval [low, high] as percentages. */
  confidenceInterval?: [number, number];
}

/** Which real dataset a win rate was pulled from. */
export type LiveWinRateEnvironment = "ladder" | "tournament";

/** A parsed, cached snapshot of one format's live win-rate data. */
export interface LiveWinRateDataset {
  format: ConstructedFormat;
  environment: LiveWinRateEnvironment;
  /** Provenance host, e.g. "mtga.untapped.gg". */
  source: string;
  /** Epoch ms the dataset was fetched/parsed. */
  lastUpdated: number;
  archetypes: LiveArchetypeWinRate[];
}

/** How long a cached dataset is considered fresh. */
export const CACHE_TTL_MS = 24 * 60 * 60 * 1000;

/**
 * Untapped.gg constructed formats we can pull. Formats absent from this map
 * (modern, legacy, commander, …) have no Untapped constructed meta page, so
 * competitive strength is unavailable for them by design.
 */
const UNTAPPED_FORMAT_PATH: Partial<Record<ConstructedFormat, string>> = {
  standard: "standard",
  historic: "historic",
  alchemy: "alchemy",
  pioneer: "pioneer",
  timeless: "timeless",
  explorer: "pioneer", // Explorer is the Arena-legal Pioneer subset
};

const SOURCE_HOST = "mtga.untapped.gg";

export function isFormatSupported(format: ConstructedFormat | undefined): boolean {
  return !!format && format in UNTAPPED_FORMAT_PATH;
}

/**
 * Bo3 play maps to tournament-style data where available; Bo1/casual map to
 * ladder data. Untapped currently only publishes ladder aggregates, so this
 * chooses the environment *label* the caller should match against rather than
 * forcing a synthetic split.
 */
export function environmentFor(playEnvironment: PlayEnvironment | undefined): LiveWinRateEnvironment {
  return playEnvironment === "bo3" ? "tournament" : "ladder";
}

function metaUrl(format: ConstructedFormat): string | null {
  const path = UNTAPPED_FORMAT_PATH[format];
  return path ? `https://${SOURCE_HOST}/constructed/${path}/meta` : null;
}

function cacheKey(format: ConstructedFormat, environment: LiveWinRateEnvironment): string {
  return `${format}:${environment}`;
}

// ── Parsing ─────────────────────────────────────────────────────────────────

const COLOR_CHARS: ManaColor[] = ["W", "U", "B", "R", "G"];

/** Guild / shard / wedge / colour-word names → WUBRG colour sets. */
const COLOR_NAME_MAP: Record<string, ManaColor[]> = {
  white: ["W"], blue: ["U"], black: ["B"], red: ["R"], green: ["G"], colorless: [],
  azorius: ["W", "U"], dimir: ["U", "B"], rakdos: ["B", "R"], gruul: ["R", "G"], selesnya: ["W", "G"],
  orzhov: ["W", "B"], izzet: ["U", "R"], golgari: ["B", "G"], boros: ["W", "R"], simic: ["U", "G"],
  esper: ["W", "U", "B"], grixis: ["U", "B", "R"], jund: ["B", "R", "G"], naya: ["W", "R", "G"], bant: ["W", "U", "G"],
  abzan: ["W", "B", "G"], jeskai: ["W", "U", "R"], sultai: ["U", "B", "G"], mardu: ["W", "B", "R"], temur: ["U", "R", "G"],
};

const MACRO_KEYWORDS: Array<{ macro: Archetype; patterns: RegExp }> = [
  { macro: "Aggro", patterns: /aggro|aggressive|burn|prowess|zoo|hyper/i },
  { macro: "Control", patterns: /control|draw-?go|azorius control|dimir control/i },
  { macro: "Combo", patterns: /combo|storm|reanimator|hypergenesis|convoke/i },
  { macro: "Ramp", patterns: /ramp|big red|domain|omniscience|landfall/i },
  { macro: "Tempo", patterns: /tempo|spirits|fae|faeries|flash/i },
  { macro: "Prison", patterns: /prison|stax|lock/i },
  { macro: "Midrange", patterns: /midrange|rock|value|jund|abzan|golgari/i },
];

/** Extract a WUBRG colour set from an archetype display name. */
export function inferColorsFromName(name: string): ManaColor[] {
  const lower = name.toLowerCase();
  const set = new Set<ManaColor>();
  for (const [word, colors] of Object.entries(COLOR_NAME_MAP)) {
    if (new RegExp(`\\b${word}\\b`).test(lower)) colors.forEach((c) => set.add(c));
  }
  // Also honour explicit WUBRG letter runs like "WU" / "RG".
  const letterRun = name.match(/\b[WUBRG]{2,5}\b/);
  if (letterRun) {
    for (const ch of letterRun[0]) if (COLOR_CHARS.includes(ch as ManaColor)) set.add(ch as ManaColor);
  }
  return COLOR_CHARS.filter((c) => set.has(c));
}

/** Best-effort macro inference from an archetype display name. */
export function inferMacroFromName(name: string): Archetype | undefined {
  for (const { macro, patterns } of MACRO_KEYWORDS) {
    if (patterns.test(name)) return macro;
  }
  return undefined;
}

export function slugifyArchetype(name: string): string {
  return name.trim().toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/(^-|-$)/g, "");
}

/**
 * 95% Wilson score interval for a proportion, returned as percentages.
 * Used when the source publishes a sample size but no interval of its own.
 */
export function wilsonInterval(winRatePct: number, sampleSize: number): [number, number] | undefined {
  if (!Number.isFinite(sampleSize) || sampleSize <= 0) return undefined;
  const p = Math.min(1, Math.max(0, winRatePct / 100));
  const z = 1.96;
  const z2 = z * z;
  const denom = 1 + z2 / sampleSize;
  const centre = (p + z2 / (2 * sampleSize)) / denom;
  const margin = (z * Math.sqrt((p * (1 - p) + z2 / (4 * sampleSize)) / sampleSize)) / denom;
  const low = Math.max(0, (centre - margin) * 100);
  const high = Math.min(100, (centre + margin) * 100);
  return [Math.round(low * 10) / 10, Math.round(high * 10) / 10];
}

/** Loosely-typed shape of an archetype entry embedded in Untapped's page JSON. */
interface RawArchetypeLike {
  name?: unknown;
  title?: unknown;
  archetype?: unknown;
  colors?: unknown;
  colorIdentity?: unknown;
  winRate?: unknown;
  win_rate?: unknown;
  winrate?: unknown;
  playRate?: unknown;
  play_rate?: unknown;
  metaShare?: unknown;
  matches?: unknown;
  matchCount?: unknown;
  sampleSize?: unknown;
  games?: unknown;
  count?: unknown;
}

function asNumber(v: unknown): number | undefined {
  if (typeof v === "number" && Number.isFinite(v)) return v;
  if (typeof v === "string") {
    const n = parseFloat(v.replace("%", ""));
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

/** Normalise a possibly-fractional win/play rate to a 0–100 percentage. */
function toPct(v: number | undefined): number | undefined {
  if (v == null) return undefined;
  return v > 0 && v <= 1 ? v * 100 : v;
}

function coerceColors(raw: unknown, fallbackName: string): ManaColor[] {
  if (Array.isArray(raw)) {
    const out = raw
      .map((c) => (typeof c === "string" ? c.toUpperCase() : ""))
      .filter((c): c is ManaColor => COLOR_CHARS.includes(c as ManaColor));
    if (out.length > 0) return COLOR_CHARS.filter((c) => out.includes(c));
  }
  if (typeof raw === "string" && raw.length > 0) {
    const out = raw.toUpperCase().split("").filter((c): c is ManaColor => COLOR_CHARS.includes(c as ManaColor));
    if (out.length > 0) return COLOR_CHARS.filter((c) => out.includes(c));
  }
  return inferColorsFromName(fallbackName);
}

function normaliseArchetype(raw: RawArchetypeLike): LiveArchetypeWinRate | null {
  const name = [raw.name, raw.title, raw.archetype].find((v) => typeof v === "string" && v.trim().length > 0) as
    | string
    | undefined;
  const winRate = toPct(asNumber(raw.winRate) ?? asNumber(raw.win_rate) ?? asNumber(raw.winrate));
  if (!name || winRate == null) return null;

  const playRate = toPct(asNumber(raw.playRate) ?? asNumber(raw.play_rate) ?? asNumber(raw.metaShare));
  const sampleSize = asNumber(raw.matches) ?? asNumber(raw.matchCount) ?? asNumber(raw.sampleSize) ?? asNumber(raw.games) ?? asNumber(raw.count);
  const confidenceInterval = sampleSize != null ? wilsonInterval(winRate, sampleSize) : undefined;

  return {
    id: slugifyArchetype(name),
    name,
    colors: coerceColors(raw.colors ?? raw.colorIdentity, name),
    macro: inferMacroFromName(name),
    winRate: Math.round(winRate * 10) / 10,
    playRate: playRate != null ? Math.round(playRate * 10) / 10 : undefined,
    sampleSize: sampleSize != null ? Math.round(sampleSize) : undefined,
    confidenceInterval,
  };
}

/** Recursively hunt an arbitrary JSON blob for arrays of archetype-like records. */
function collectArchetypeArrays(node: unknown, out: LiveArchetypeWinRate[], seen: Set<unknown>): void {
  if (!node || typeof node !== "object" || seen.has(node)) return;
  seen.add(node);
  if (Array.isArray(node)) {
    const parsed = node
      .map((el) => (el && typeof el === "object" ? normaliseArchetype(el as RawArchetypeLike) : null))
      .filter((x): x is LiveArchetypeWinRate => x != null);
    // Only accept arrays that look like archetype tables (majority parsed).
    if (parsed.length >= 3 && parsed.length >= node.length * 0.5) {
      out.push(...parsed);
    }
    for (const el of node) collectArchetypeArrays(el, out, seen);
    return;
  }
  for (const value of Object.values(node as Record<string, unknown>)) {
    collectArchetypeArrays(value, out, seen);
  }
}

/**
 * Parse Untapped.gg constructed-meta page HTML into a dataset.
 *
 * Untapped is a Next.js app, so the aggregated table is embedded as JSON in a
 * `<script id="__NEXT_DATA__">` (or an inline `application/json`). We extract
 * that JSON and walk it for archetype-like records. Returns null when nothing
 * usable is found, so callers can fall back to cache honestly.
 *
 * Exported for testing — the network layer is mocked and this pure parser is
 * exercised against representative payloads.
 */
export function parseUntappedMeta(
  html: string,
  format: ConstructedFormat,
  environment: LiveWinRateEnvironment,
): LiveWinRateDataset | null {
  const scripts: string[] = [];
  const re = /<script[^>]*type="application\/json"[^>]*>([\s\S]*?)<\/script>/gi;
  let m: RegExpExecArray | null;
  while ((m = re.exec(html)) !== null) scripts.push(m[1]);
  const nextData = html.match(/<script[^>]*id="__NEXT_DATA__"[^>]*>([\s\S]*?)<\/script>/i);
  if (nextData) scripts.push(nextData[1]);

  const collected: LiveArchetypeWinRate[] = [];
  const seen = new Set<unknown>();
  for (const raw of scripts) {
    try {
      collectArchetypeArrays(JSON.parse(raw), collected, seen);
    } catch {
      /* skip non-JSON script bodies */
    }
  }

  if (collected.length === 0) return null;

  // De-duplicate by id, keeping the record with the largest sample size.
  const byId = new Map<string, LiveArchetypeWinRate>();
  for (const a of collected) {
    const prev = byId.get(a.id);
    if (!prev || (a.sampleSize ?? 0) > (prev.sampleSize ?? 0)) byId.set(a.id, a);
  }

  return {
    format,
    environment,
    source: SOURCE_HOST,
    lastUpdated: Date.now(),
    archetypes: Array.from(byId.values()).sort((a, b) => (b.playRate ?? 0) - (a.playRate ?? 0)),
  };
}

// ── Network + cache ───────────────────────────────────────────────────────────

/**
 * Fetch + parse a live dataset from Untapped.gg. Returns null on any network,
 * CORS, or parse failure — never throws — so cache fallback stays clean.
 */
export async function fetchLiveWinRate(
  format: ConstructedFormat,
  environment: LiveWinRateEnvironment = "ladder",
  fetchImpl: typeof fetch = fetch,
): Promise<LiveWinRateDataset | null> {
  const url = metaUrl(format);
  if (!url) return null;
  try {
    const res = await fetchImpl(url, { headers: { Accept: "text/html" } });
    if (!res.ok) return null;
    const html = await res.text();
    return parseUntappedMeta(html, format, environment);
  } catch {
    return null;
  }
}

async function readCache(key: string): Promise<{ dataset: LiveWinRateDataset; cachedAt: number } | null> {
  try {
    const row = await db.liveWinRate.get(key);
    return row ? { dataset: row.dataset, cachedAt: row.cachedAt } : null;
  } catch {
    return null;
  }
}

async function writeCache(key: string, dataset: LiveWinRateDataset): Promise<void> {
  try {
    await db.liveWinRate.put({ key, dataset, cachedAt: Date.now() });
  } catch {
    /* IndexedDB unavailable (SSR / private mode) — degrade to no cache */
  }
}

/**
 * Cache-first accessor. Returns fresh cache when < 24h old; otherwise attempts
 * a network refresh and falls back to stale cache (then null) on failure.
 */
export async function getLiveWinRateData(
  format: ConstructedFormat | undefined,
  playEnvironment?: PlayEnvironment,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveWinRateDataset | null> {
  if (!isFormatSupported(format)) return null;
  const fmt = format as ConstructedFormat;
  const environment = environmentFor(playEnvironment);
  const key = cacheKey(fmt, environment);

  const cached = await readCache(key);
  if (cached && Date.now() - cached.cachedAt < CACHE_TTL_MS) return cached.dataset;

  const fresh = await fetchLiveWinRate(fmt, environment, fetchImpl);
  if (fresh) {
    await writeCache(key, fresh);
    return fresh;
  }
  return cached?.dataset ?? null;
}

/**
 * Force-refresh the cache for one format (or every supported format when
 * omitted). Returns the datasets successfully refreshed. Exposed for a manual
 * "update meta data" control and background refresh.
 */
export async function updateLiveWinRateCache(
  format?: ConstructedFormat,
  playEnvironment?: PlayEnvironment,
  fetchImpl: typeof fetch = fetch,
): Promise<LiveWinRateDataset[]> {
  const formats = format
    ? [format]
    : (Object.keys(UNTAPPED_FORMAT_PATH) as ConstructedFormat[]);
  const environment = environmentFor(playEnvironment);
  const out: LiveWinRateDataset[] = [];
  for (const fmt of formats) {
    const fresh = await fetchLiveWinRate(fmt, environment, fetchImpl);
    if (fresh) {
      await writeCache(cacheKey(fmt, environment), fresh);
      out.push(fresh);
    }
  }
  return out;
}
