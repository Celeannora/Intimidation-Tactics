import type { MetaSnapshot } from "./types";
import bundledStandardSnapshot from "../../data/meta/standard-snapshot.json";
import { db } from "../db";
import { MetaStatsManager, type MetaContext } from "./metaScoring";

/**
 * Snapshot loader.
 *
 * Architecture: the app ships a bundled JSON snapshot (imported below) as the
 * always-available baseline. At runtime an optional remote URL may be checked
 * to fetch a fresher snapshot; if present and valid it supersedes the bundled
 * copy and is cached in Dexie. The remote path uses jsDelivr's CORS-permissive
 * mirror of this repository's reviewed snapshot, not the upstream metagame
 * sites themselves. See docs/META.md for the update process.
 */

/** The reviewed Standard snapshot bundled with the app build. */
export const BUNDLED_STANDARD_SNAPSHOT = bundledStandardSnapshot as MetaSnapshot;

let bundledMetaContext: MetaContext | null = null;

/**
 * Build the scoring context once from the same bundled Standard snapshot used
 * by the meta UI and counter-analysis paths. The snapshot contains the
 * per-archetype share and interaction data required by computeMetaPerformance.
 */
export function getBundledMetaContext(): MetaContext {
  if (!bundledMetaContext) {
    bundledMetaContext = new MetaStatsManager().buildFromSnapshot(
      BUNDLED_STANDARD_SNAPSHOT.archetypes,
    );
  }
  return bundledMetaContext;
}

/** Upper bound on summed metaShare. Allows minor rounding / overlap slack. */
const MAX_SHARE_SUM = 1.05;
/** CORS-permissive mirror of this repository's reviewed, committed snapshot. */
export const STANDARD_SNAPSHOT_CDN_URL =
  "https://cdn.jsdelivr.net/gh/Celeannora/Intimidation-Tactics@main/src/data/meta/standard-snapshot.json";
const REMOTE_CACHE_KEY = "standard";
const REMOTE_CACHE_TTL_MS = 24 * 60 * 60 * 1000;
const REMOTE_TIMEOUT_MS = 7_000;

export interface SnapshotValidation {
  valid: boolean;
  errors: string[];
}

/**
 * Structurally validate a snapshot. Checks the schema version, the format tag,
 * per-archetype share sanity, and that total share does not exceed
 * {@link MAX_SHARE_SUM}. Returns all problems found rather than throwing so
 * callers can decide whether to fall back to the bundled copy.
 */
export function validateSnapshot(snapshot: MetaSnapshot): SnapshotValidation {
  const errors: string[] = [];

  if (snapshot.schemaVersion !== 1) {
    errors.push(`Unsupported schemaVersion: ${snapshot.schemaVersion} (expected 1)`);
  }
  if (snapshot.format !== "standard") {
    errors.push(`Unsupported format: ${snapshot.format} (expected "standard")`);
  }
  if (!Array.isArray(snapshot.archetypes) || snapshot.archetypes.length === 0) {
    errors.push("Snapshot has no archetypes");
    return { valid: false, errors };
  }

  let shareSum = 0;
  const ids = new Set<string>();
  for (const a of snapshot.archetypes) {
    if (ids.has(a.id)) errors.push(`Duplicate archetype id: ${a.id}`);
    ids.add(a.id);
    if (a.metaShare < 0 || a.metaShare > 1) {
      errors.push(`Archetype ${a.id} has out-of-range metaShare: ${a.metaShare}`);
    }
    shareSum += a.metaShare;
  }
  if (shareSum > MAX_SHARE_SUM) {
    errors.push(`Total metaShare ${shareSum.toFixed(3)} exceeds ${MAX_SHARE_SUM}`);
  }

  return { valid: errors.length === 0, errors };
}

/**
 * Fetch a fresher snapshot from a remote URL.
 *
 * Requests the jsDelivr mirror by default, validates the result, and records a
 * successful response in the same Dexie database used by liveWinRate.ts.
 * Network, parse, timeout, and validation failures intentionally resolve to
 * null so callers can use the cached or bundled fallback without disruption.
 */
export async function fetchRemoteSnapshot(
  url = STANDARD_SNAPSHOT_CDN_URL,
  fetchImpl: typeof fetch = fetch,
): Promise<MetaSnapshot | null> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REMOTE_TIMEOUT_MS);
  try {
    const response = await fetchImpl(url, {
      headers: { Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) return null;
    const snapshot = await response.json() as MetaSnapshot;
    if (!validateSnapshot(snapshot).valid) return null;
    try {
      await db.metaSnapshot.put({ key: REMOTE_CACHE_KEY, snapshot, cachedAt: Date.now() });
    } catch {
      /* IndexedDB unavailable: a valid network response remains usable. */
    }
    return snapshot;
  } catch {
    return null;
  } finally {
    clearTimeout(timeout);
  }
}

async function readRemoteCache(): Promise<{ snapshot: MetaSnapshot; cachedAt: number } | null> {
  try {
    const cached = await db.metaSnapshot.get(REMOTE_CACHE_KEY);
    if (!cached || !validateSnapshot(cached.snapshot).valid) return null;
    return { snapshot: cached.snapshot, cachedAt: cached.cachedAt };
  } catch {
    return null;
  }
}

/**
 * Get the active meta snapshot.
 *
 * Cache-first accessor for the CDN mirror. A cache newer than 24 hours avoids a
 * startup request; a stale cache is retained as a fallback if its refresh
 * fails. Passing an empty string disables remote loading explicitly.
 */
export async function getMetaSnapshot(remoteUrl = STANDARD_SNAPSHOT_CDN_URL): Promise<MetaSnapshot> {
  if (remoteUrl) {
    const cached = await readRemoteCache();
    if (cached && Date.now() - cached.cachedAt < REMOTE_CACHE_TTL_MS) return cached.snapshot;
    const remote = await fetchRemoteSnapshot(remoteUrl);
    if (remote && validateSnapshot(remote).valid) return remote;
    if (cached) return cached.snapshot;
  }
  return BUNDLED_STANDARD_SNAPSHOT;
}
