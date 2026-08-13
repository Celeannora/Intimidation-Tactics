/**
 * scripts/fetchBulkPool.ts
 *
 * Node-side mirror of the app's own data path (src/lib/scryfallUpdate.ts):
 *   1. Fetch the Scryfall /bulk-data manifest.
 *   2. Find the oracle_cards dataset entry (same as ScryfallUpdateController).
 *   3. Download the FULL bulk file (cached at pool_data/oracle_cards.json;
 *      re-downloaded only when Scryfall's updated_at is newer than the cache).
 *   4. Derive the comparison pools with the app's OWN eligibility functions
 *      (isImportEligible via isStandardEligible from src/lib/scryfall.ts) —
 *      exactly what importWorker.ts applies during ingest — plus the
 *      WU-color-identity scope this PoC needs:
 *        - pool_data/azorius_pool.json  (nonland, color identity ⊆ {W,U}, incl. colorless)
 *        - pool_data/lands.json         (lands, color identity ⊆ {W,U})
 *
 * This replaces the earlier targeted search-API queries so the PoC runs on
 * the same database the app itself downloads and imports.
 *
 * NOTE (documented shortfall): the app's ingest applies NO release-date
 * guard — Scryfall pre-marks preview cards as standard-legal, so unreleased
 * cards (e.g. Gleaming Splendor before 2026-08-14) pass isStandardEligible
 * and would be imported as playable by the app itself. The comparison
 * script's isReleased() guard papers over this downstream; the durable fix
 * belongs in the app (store released_at in CardRecord and gate on it).
 *
 * Usage: npx tsx scripts/fetchBulkPool.ts
 */

import { existsSync, readFileSync, writeFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";
import type { ScryfallCard } from "../src/lib/types";
import { isStandardEligible } from "../src/lib/scryfall";

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);
const POOL_DIR = join(__dirname, "..", "..", "pool_data");

const SCRYFALL_BULK_MANIFEST = "https://api.scryfall.com/bulk-data";
const BULK_CACHE = join(POOL_DIR, "oracle_cards.json");
const META_CACHE = join(POOL_DIR, "oracle_cards.meta.json");
// default_cards holds EVERY English printing (not just oracle_cards' single
// "most recognizable" pick per card). Needed because Arena availability is a
// PRINTING-level fact, not an oracle-card-level fact: Sheltered by Ghosts'
// oracle_cards representative is its Secrets of Strixhaven Commander reprint
// (paper/mtgo only), but its original Duskmourn printing (2024-09-27) IS on
// Arena. Checking only the bulk file's single representative card silently
// drops any card whose Arena printing isn't the one Scryfall happened to
// choose as "most recognizable" -- this file builds a cross-printing index
// instead of trusting one printing's `games` field.
const ARENA_INDEX_CACHE = join(POOL_DIR, "arena_oracle_ids.json");
const ARENA_INDEX_META_CACHE = join(POOL_DIR, "arena_oracle_ids.meta.json");

interface BulkEntry {
  type: string;
  download_uri?: string;
  jsonl_download_uri?: string;
  uri?: string;
  size?: number;
  compressed_size?: number;
  updated_at?: string;
}

type RawCard = ScryfallCard & {
  released_at?: string;
  color_identity?: string[];
  card_faces?: { oracle_text?: string; mana_cost?: string }[];
};

async function fetchManifestEntry(bulkType: string): Promise<BulkEntry> {
  const res = await fetch(SCRYFALL_BULK_MANIFEST, {
    headers: { "User-Agent": "intimidation-tactics-poc/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const manifest = (await res.json()) as { data: BulkEntry[] };
  const entry = manifest.data.find((d) => d.type === bulkType);
  if (!entry) throw new Error(`No ${bulkType} entry found in Scryfall bulk manifest.`);
  if (!entry.download_uri && entry.uri) {
    // Newer manifest shape: the top-level list omits download_uri; follow the
    // per-entry uri to resolve it (same dataset the app's controller targets).
    const detail = await fetch(entry.uri, {
      headers: { "User-Agent": "intimidation-tactics-poc/1.0", Accept: "application/json" },
    });
    if (!detail.ok) throw new Error(`Bulk entry fetch failed: ${detail.status}`);
    const full = (await detail.json()) as BulkEntry;
    return { ...entry, ...full };
  }
  return entry;
}

async function ensureBulkFile(
  bulkType: string,
  cachePath: string,
  metaPath: string
): Promise<void> {
  const entry = await fetchManifestEntry(bulkType);

  if (existsSync(cachePath) && existsSync(metaPath)) {
    const meta = JSON.parse(readFileSync(metaPath, "utf-8")) as { updated_at?: string };
    if (meta.updated_at && entry.updated_at && meta.updated_at >= entry.updated_at) {
      console.log(`[BULK] ${bulkType} cache is current (updated_at ${meta.updated_at}); skipping download.`);
      return;
    }
  }

  console.log(`[BULK] Downloading ${bulkType} (${((entry.size ?? 0) / 1_000_000).toFixed(1)} MB) ...`);
  // NOTE (documented shortfall #2): Scryfall's bulk manifest no longer exposes
  // a plain-JSON download_uri — entries now provide jsonl_download_uri
  // (gzipped JSONL). The app's ScryfallUpdateController still expects
  // download_uri, so the in-app "refresh database" flow is broken against the
  // live manifest until it is updated to handle the JSONL format.
  const dlUri = entry.download_uri ?? entry.jsonl_download_uri;
  if (!dlUri) throw new Error(`Could not resolve ${bulkType} download uri.`);
  const res = await fetch(dlUri, {
    headers: { "User-Agent": "intimidation-tactics-poc/1.0" },
  });
  if (!res.ok) throw new Error(`Bulk download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  let text: string;
  if (dlUri.endsWith(".gz")) {
    const { gunzipSync } = await import("zlib");
    text = gunzipSync(buf).toString("utf-8");
  } else {
    text = buf.toString("utf-8");
  }
  if (dlUri.includes(".jsonl")) {
    // Convert JSONL -> JSON array so downstream readers keep a single shape.
    const cards = text
      .split("\n")
      .filter((l) => l.trim().length > 0)
      .map((l) => JSON.parse(l) as unknown);
    text = JSON.stringify(cards);
  }
  writeFileSync(cachePath, text, "utf-8");
  writeFileSync(metaPath, JSON.stringify({ updated_at: entry.updated_at, size: entry.size, fetched_at: new Date().toISOString() }), "utf-8");
  console.log(`[BULK] Saved ${(statSync(cachePath).size / 1_000_000).toFixed(1)} MB to ${cachePath}`);
}

/**
 * Build (and cache) the set of oracle_ids that have AT LEAST ONE Arena
 * printing, from default_cards (every English printing) rather than
 * oracle_cards (one representative printing per card). Arena availability is
 * a printing-level fact; relying on oracle_cards' single representative
 * printing silently misses any card whose Arena print isn't the one Scryfall
 * chose to bundle (see Sheltered by Ghosts, module header note).
 */
async function ensureArenaIndex(): Promise<Set<string>> {
  const entry = await fetchManifestEntry("default_cards");

  if (existsSync(ARENA_INDEX_CACHE) && existsSync(ARENA_INDEX_META_CACHE)) {
    const meta = JSON.parse(readFileSync(ARENA_INDEX_META_CACHE, "utf-8")) as { updated_at?: string };
    if (meta.updated_at && entry.updated_at && meta.updated_at >= entry.updated_at) {
      console.log(`[ARENA-INDEX] Cache is current (updated_at ${meta.updated_at}); skipping rebuild.`);
      return new Set(JSON.parse(readFileSync(ARENA_INDEX_CACHE, "utf-8")) as string[]);
    }
  }

  // default_cards decompressed is large enough (every English printing of
  // every card) to exceed Node's max string length via the generic
  // ensureBulkFile() path (buf.toString() on the full gunzipped payload).
  // We only need two fields per printing (oracle_id, games), so stream-parse
  // the raw JSONL directly instead of materializing the whole file as one
  // string or one parsed array.
  console.log(`[ARENA-INDEX] Downloading default_cards (${((entry.size ?? 0) / 1_000_000).toFixed(1)} MB) to build cross-printing Arena index ...`);
  const dlUri = entry.download_uri ?? entry.jsonl_download_uri;
  if (!dlUri) throw new Error("Could not resolve default_cards download uri.");
  const res = await fetch(dlUri, { headers: { "User-Agent": "intimidation-tactics-poc/1.0" } });
  if (!res.ok) throw new Error(`default_cards download failed: ${res.status}`);
  const buf = Buffer.from(await res.arrayBuffer());
  const { gunzipSync } = await import("zlib");
  const decompressed: Buffer = dlUri.endsWith(".gz") ? gunzipSync(buf) : buf;

  const arenaOracleIds = new Set<string>();
  let lineStart = 0;
  let linesParsed = 0;
  for (let i = 0; i < decompressed.length; i++) {
    if (decompressed[i] !== 0x0a /* \n */) continue;
    const line = decompressed.subarray(lineStart, i);
    lineStart = i + 1;
    if (line.length === 0) continue;
    try {
      const printing = JSON.parse(line.toString("utf-8")) as { oracle_id?: string; games?: string[] };
      linesParsed++;
      if (printing.oracle_id && (printing.games ?? []).includes("arena")) {
        arenaOracleIds.add(printing.oracle_id);
      }
    } catch {
      // Skip malformed lines (e.g. a stray non-JSON leading/trailing bracket
      // if the source ever ships as a JSON array instead of JSONL).
    }
  }

  writeFileSync(ARENA_INDEX_CACHE, JSON.stringify([...arenaOracleIds]), "utf-8");
  writeFileSync(ARENA_INDEX_META_CACHE, JSON.stringify({ updated_at: entry.updated_at, builtAt: new Date().toISOString(), linesParsed, count: arenaOracleIds.size }), "utf-8");
  console.log(`[ARENA-INDEX] Parsed ${linesParsed} printings; ${arenaOracleIds.size} oracle cards have at least one Arena printing.`);
  return arenaOracleIds;
}

function derivePools(arenaOracleIds: Set<string>): void {
  console.log("[BULK] Parsing bulk file ...");
  const all = JSON.parse(readFileSync(BULK_CACHE, "utf-8")) as (RawCard & { oracle_id?: string })[];
  console.log(`[BULK] ${all.length} total oracle cards.`);

  const wuOnly = (ci: string[] | undefined) => (ci ?? []).every((c) => c === "W" || c === "U");
  // App-level gap #3 (found via Sheltered by Ghosts, printed only in Secrets
  // of Strixhaven Commander): Scryfall's `standard: legal` legality field is
  // about the PAPER/MTGO Standard format and is entirely independent of
  // Arena print availability. `isStandardEligible` (and the app's importer)
  // has no Arena gate at all, so Commander-only reprints of otherwise
  // Standard-legal cards pass through even though they cannot be imported
  // into an MTGA decklist. Filtered here since the deliverable is an MTGA
  // import; documented in docs/synergy-first-poc/README.md as a fourth
  // app-level ingest gap alongside the release-date and manifest-shape bugs.
  //
  // IMPORTANT: checked by oracle_id against the cross-printing arenaOracleIds
  // index (built from default_cards), NOT by reading `games` off this single
  // oracle_cards representative printing. oracle_cards intentionally keeps
  // only one "most recognizable" printing per card, which for a card like
  // Sheltered by Ghosts is its non-Arena Commander reprint even though its
  // original Duskmourn printing IS on Arena. Any card that has EVER had an
  // Arena printing (under any set) passes.
  const arenaAvailable = (oracleId: string | undefined) => !!oracleId && arenaOracleIds.has(oracleId);

  const nonland: RawCard[] = [];
  const lands: RawCard[] = [];
  let standardLegal = 0;
  let droppedNonArena = 0;

  for (const card of all) {
    // Same gate the app's importWorker applies (isImportEligible) plus the
    // standard-legality check the generator relies on (legalityStandard).
    if (!isStandardEligible(card)) continue;
    standardLegal++;
    if (!wuOnly(card.color_identity)) continue;
    if (!arenaAvailable(card.oracle_id)) {
      droppedNonArena++;
      continue;
    }
    if ((card.type_line ?? "").includes("Land")) lands.push(card);
    else nonland.push(card);
  }

  writeFileSync(join(POOL_DIR, "azorius_pool.json"), JSON.stringify(nonland), "utf-8");
  writeFileSync(join(POOL_DIR, "lands.json"), JSON.stringify(lands), "utf-8");
  // The colorless-artifacts file is now redundant (colorless identity ⊆ WU is
  // included above); keep an empty array so older readers don't break.
  writeFileSync(join(POOL_DIR, "colorless_artifacts.json"), "[]", "utf-8");

  console.log(`[BULK] Standard-legal (app ingest rules): ${standardLegal}`);
  console.log(`[BULK] Dropped for no Arena printing (Standard-legal on paper/MTGO only): ${droppedNonArena}`);
  console.log(`[BULK] Derived pools — nonland WU/colorless (Arena-available): ${nonland.length}, lands: ${lands.length}`);
}

async function main() {
  await ensureBulkFile("oracle_cards", BULK_CACHE, META_CACHE);
  const arenaOracleIds = await ensureArenaIndex();
  derivePools(arenaOracleIds);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
