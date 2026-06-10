import type { MetaSnapshot } from "./types";
import bundledStandardSnapshot from "../../data/meta/standard-snapshot.json";

/**
 * Snapshot loader.
 *
 * Architecture: the app ships a bundled JSON snapshot (imported below) as the
 * always-available baseline. At runtime an optional remote URL may be checked
 * to fetch a fresher snapshot; if present and valid it supersedes the bundled
 * copy and is cached in Dexie. No public Standard meta source is
 * CORS-accessible client-side, so the remote path is a documented stub today.
 * See docs/META.md for the update process.
 */

/** The bundled June 2026 Standard snapshot, shipped with the app. */
export const BUNDLED_STANDARD_SNAPSHOT = bundledStandardSnapshot as MetaSnapshot;

/** Upper bound on summed metaShare. Allows minor rounding / overlap slack. */
const MAX_SHARE_SUM = 1.05;

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
 * TODO(meta): implement remote refresh. Intended algorithm: GET the URL, parse
 * JSON, run validateSnapshot(); on success cache it in Dexie keyed by
 * format+updatedAt and return it, else return null so the caller keeps the
 * bundled copy. Today this is a stub because no CORS-accessible source exists.
 */
export async function fetchRemoteSnapshot(_url: string): Promise<MetaSnapshot | null> {
  // TODO(meta): fetch + validate + Dexie-cache; returning null keeps the bundled snapshot.
  return null;
}

/**
 * Get the active meta snapshot.
 *
 * Returns the bundled snapshot today. When `remoteUrl` is provided, attempts a
 * remote refresh first and falls back to the bundled copy if the remote is
 * unavailable or fails validation.
 *
 * TODO(meta): consult a Dexie cache before hitting the network, and expose a
 * "last refreshed" timestamp to the UI.
 */
export async function getMetaSnapshot(remoteUrl?: string): Promise<MetaSnapshot> {
  if (remoteUrl) {
    const remote = await fetchRemoteSnapshot(remoteUrl);
    if (remote && validateSnapshot(remote).valid) return remote;
  }
  return BUNDLED_STANDARD_SNAPSHOT;
}
