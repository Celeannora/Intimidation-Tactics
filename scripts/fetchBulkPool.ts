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

async function fetchManifestEntry(): Promise<BulkEntry> {
  const res = await fetch(SCRYFALL_BULK_MANIFEST, {
    headers: { "User-Agent": "intimidation-tactics-poc/1.0", Accept: "application/json" },
  });
  if (!res.ok) throw new Error(`Manifest fetch failed: ${res.status}`);
  const manifest = (await res.json()) as { data: BulkEntry[] };
  const entry = manifest.data.find((d) => d.type === "oracle_cards");
  if (!entry) throw new Error("No oracle_cards entry found in Scryfall bulk manifest.");
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

async function ensureBulkFile(): Promise<void> {
  const entry = await fetchManifestEntry();

  if (existsSync(BULK_CACHE) && existsSync(META_CACHE)) {
    const meta = JSON.parse(readFileSync(META_CACHE, "utf-8")) as { updated_at?: string };
    if (meta.updated_at && entry.updated_at && meta.updated_at >= entry.updated_at) {
      console.log(`[BULK] Cache is current (updated_at ${meta.updated_at}); skipping download.`);
      return;
    }
  }

  console.log(`[BULK] Downloading oracle_cards (${((entry.size ?? 0) / 1_000_000).toFixed(1)} MB) ...`);
  // NOTE (documented shortfall #2): Scryfall's bulk manifest no longer exposes
  // a plain-JSON download_uri — entries now provide jsonl_download_uri
  // (gzipped JSONL). The app's ScryfallUpdateController still expects
  // download_uri, so the in-app "refresh database" flow is broken against the
  // live manifest until it is updated to handle the JSONL format.
  const dlUri = entry.download_uri ?? entry.jsonl_download_uri;
  if (!dlUri) throw new Error("Could not resolve oracle_cards download uri.");
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
  writeFileSync(BULK_CACHE, text, "utf-8");
  writeFileSync(META_CACHE, JSON.stringify({ updated_at: entry.updated_at, size: entry.size, fetched_at: new Date().toISOString() }), "utf-8");
  console.log(`[BULK] Saved ${(statSync(BULK_CACHE).size / 1_000_000).toFixed(1)} MB to ${BULK_CACHE}`);
}

function derivePools(): void {
  console.log("[BULK] Parsing bulk file ...");
  const all = JSON.parse(readFileSync(BULK_CACHE, "utf-8")) as RawCard[];
  console.log(`[BULK] ${all.length} total oracle cards.`);

  const wuOnly = (ci: string[] | undefined) => (ci ?? []).every((c) => c === "W" || c === "U");

  const nonland: RawCard[] = [];
  const lands: RawCard[] = [];
  let standardLegal = 0;

  for (const card of all) {
    // Same gate the app's importWorker applies (isImportEligible) plus the
    // standard-legality check the generator relies on (legalityStandard).
    if (!isStandardEligible(card)) continue;
    standardLegal++;
    if (!wuOnly(card.color_identity)) continue;
    if ((card.type_line ?? "").includes("Land")) lands.push(card);
    else nonland.push(card);
  }

  writeFileSync(join(POOL_DIR, "azorius_pool.json"), JSON.stringify(nonland), "utf-8");
  writeFileSync(join(POOL_DIR, "lands.json"), JSON.stringify(lands), "utf-8");
  // The colorless-artifacts file is now redundant (colorless identity ⊆ WU is
  // included above); keep an empty array so older readers don't break.
  writeFileSync(join(POOL_DIR, "colorless_artifacts.json"), "[]", "utf-8");

  console.log(`[BULK] Standard-legal (app ingest rules): ${standardLegal}`);
  console.log(`[BULK] Derived pools — nonland WU/colorless: ${nonland.length}, lands: ${lands.length}`);
}

async function main() {
  await ensureBulkFile();
  derivePools();
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
