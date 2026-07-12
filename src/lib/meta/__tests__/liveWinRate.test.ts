/**
 * liveWinRate.test.ts
 *
 * Track 2 data source. The network layer is fully mocked (a fake `fetchImpl`),
 * so these run offline and deterministically. Coverage:
 *   - parseUntappedMeta extracts archetypes from a representative __NEXT_DATA__
 *     payload and computes Wilson intervals,
 *   - wilsonInterval math is sane,
 *   - fetchLiveWinRate never throws on network/parse failure (returns null),
 *   - getLiveWinRateData is cache-first with a 24h TTL and stale fallback,
 *   - unsupported formats return null by design (no fake number).
 */

import { describe, it, expect, beforeEach } from "vitest";
import { db } from "../../db";
import {
  parseUntappedMeta,
  wilsonInterval,
  fetchLiveWinRate,
  getLiveWinRateData,
  updateLiveWinRateCache,
  isFormatSupported,
  environmentFor,
  CACHE_TTL_MS,
} from "../liveWinRate";

// ── Fixture: a representative Untapped-style Next.js payload ──────────────────

function untappedHtml(): string {
  const payload = {
    props: {
      pageProps: {
        meta: {
          archetypes: [
            { name: "Azorius Control", colors: ["W", "U"], winRate: 53.2, playRate: 12.0, matches: 8000 },
            { name: "Mono-Red Aggro", colors: ["R"], winRate: 0.556, playRate: 0.18, matches: 12000 },
            { name: "Golgari Midrange", colorIdentity: "BG", winRate: "51.0%", metaShare: "9%", games: 6000 },
            { name: "Izzet Prowess", colors: ["U", "R"], winRate: 52.4, playRate: 7, matchCount: 5000 },
          ],
        },
      },
    },
  };
  return `<!doctype html><html><head></head><body>
    <script id="__NEXT_DATA__" type="application/json">${JSON.stringify(payload)}</script>
  </body></html>`;
}

/** Build a fetch stand-in that returns a canned response. */
function mockFetch(body: string, ok = true): typeof fetch {
  return (async () =>
    ({
      ok,
      status: ok ? 200 : 500,
      text: async () => body,
    }) as Response) as unknown as typeof fetch;
}

function throwingFetch(): typeof fetch {
  return (async () => {
    throw new Error("network down");
  }) as unknown as typeof fetch;
}

beforeEach(async () => {
  await db.liveWinRate.clear();
});

// ── wilsonInterval ────────────────────────────────────────────────────────────

describe("wilsonInterval", () => {
  it("returns a bracketing interval around the point estimate", () => {
    const ci = wilsonInterval(55, 10000)!;
    expect(ci).toBeDefined();
    expect(ci[0]).toBeLessThan(55);
    expect(ci[1]).toBeGreaterThan(55);
    // Large sample → tight interval.
    expect(ci[1] - ci[0]).toBeLessThan(3);
  });

  it("widens as the sample shrinks", () => {
    const wide = wilsonInterval(55, 100)!;
    const narrow = wilsonInterval(55, 10000)!;
    expect(wide[1] - wide[0]).toBeGreaterThan(narrow[1] - narrow[0]);
  });

  it("returns undefined for a non-positive sample size", () => {
    expect(wilsonInterval(55, 0)).toBeUndefined();
    expect(wilsonInterval(55, -1)).toBeUndefined();
  });
});

// ── parseUntappedMeta ─────────────────────────────────────────────────────────

describe("parseUntappedMeta", () => {
  it("extracts archetypes from a __NEXT_DATA__ payload", () => {
    const ds = parseUntappedMeta(untappedHtml(), "standard", "ladder")!;
    expect(ds).not.toBeNull();
    expect(ds.format).toBe("standard");
    expect(ds.environment).toBe("ladder");
    expect(ds.source).toBe("mtga.untapped.gg");
    expect(ds.archetypes.length).toBe(4);
  });

  it("normalises fractional and percentage-string win rates to 0–100", () => {
    const ds = parseUntappedMeta(untappedHtml(), "standard", "ladder")!;
    const byName = Object.fromEntries(ds.archetypes.map((a) => [a.name, a]));
    expect(byName["Azorius Control"].winRate).toBeCloseTo(53.2, 1);
    expect(byName["Mono-Red Aggro"].winRate).toBeCloseTo(55.6, 1); // 0.556 → 55.6
    expect(byName["Golgari Midrange"].winRate).toBeCloseTo(51.0, 1); // "51.0%" → 51.0
  });

  it("derives colours from name/identity and attaches Wilson intervals from sample size", () => {
    const ds = parseUntappedMeta(untappedHtml(), "standard", "ladder")!;
    const golgari = ds.archetypes.find((a) => a.name === "Golgari Midrange")!;
    expect(golgari.colors).toEqual(["B", "G"]);
    expect(golgari.confidenceInterval).toBeDefined();
    expect(golgari.sampleSize).toBe(6000);
  });

  it("returns null when there is no usable JSON", () => {
    expect(parseUntappedMeta("<html><body>no data here</body></html>", "standard", "ladder")).toBeNull();
  });
});

// ── fetchLiveWinRate ──────────────────────────────────────────────────────────

describe("fetchLiveWinRate", () => {
  it("parses a successful response", async () => {
    const ds = await fetchLiveWinRate("standard", "ladder", mockFetch(untappedHtml()));
    expect(ds).not.toBeNull();
    expect(ds!.archetypes.length).toBe(4);
  });

  it("returns null (never throws) on a network error", async () => {
    await expect(fetchLiveWinRate("standard", "ladder", throwingFetch())).resolves.toBeNull();
  });

  it("returns null on a non-ok HTTP status", async () => {
    await expect(fetchLiveWinRate("standard", "ladder", mockFetch("", false))).resolves.toBeNull();
  });

  it("returns null for an unsupported format without hitting the network", async () => {
    let called = false;
    const spy = (async () => {
      called = true;
      return { ok: true, status: 200, text: async () => "" } as Response;
    }) as unknown as typeof fetch;
    const ds = await fetchLiveWinRate("modern", "ladder", spy);
    expect(ds).toBeNull();
    expect(called).toBe(false);
  });
});

// ── getLiveWinRateData (cache-first) ──────────────────────────────────────────

describe("getLiveWinRateData", () => {
  it("returns null for unsupported formats (no synthesized data)", async () => {
    expect(await getLiveWinRateData("modern", undefined, mockFetch(untappedHtml()))).toBeNull();
  });

  it("fetches + caches on a cold cache, then serves from cache without re-fetching", async () => {
    let fetchCount = 0;
    const countingFetch = (async () => {
      fetchCount++;
      return { ok: true, status: 200, text: async () => untappedHtml() } as Response;
    }) as unknown as typeof fetch;

    const first = await getLiveWinRateData("standard", "bo1", countingFetch);
    expect(first).not.toBeNull();
    expect(fetchCount).toBe(1);

    const second = await getLiveWinRateData("standard", "bo1", countingFetch);
    expect(second).not.toBeNull();
    expect(fetchCount).toBe(1); // served from fresh cache, no second network hit
  });

  it("falls back to stale cache when a refresh fails", async () => {
    // Seed a stale cache row directly (cachedAt older than the TTL).
    const seeded = parseUntappedMeta(untappedHtml(), "standard", "ladder")!;
    await db.liveWinRate.put({
      key: "standard:ladder",
      dataset: seeded,
      cachedAt: Date.now() - CACHE_TTL_MS - 1000,
    });

    const ds = await getLiveWinRateData("standard", "bo1", throwingFetch());
    expect(ds).not.toBeNull();
    expect(ds!.archetypes.length).toBe(seeded.archetypes.length);
  });

  it("returns null when both cache and network are unavailable", async () => {
    expect(await getLiveWinRateData("standard", "bo1", throwingFetch())).toBeNull();
  });
});

// ── updateLiveWinRateCache ────────────────────────────────────────────────────

describe("updateLiveWinRateCache", () => {
  it("force-refreshes a single format and writes it to cache", async () => {
    const out = await updateLiveWinRateCache("standard", "bo1", mockFetch(untappedHtml()));
    expect(out.length).toBe(1);
    const row = await db.liveWinRate.get("standard:ladder");
    expect(row).toBeDefined();
    expect(row!.dataset.archetypes.length).toBe(4);
  });

  it("skips formats whose refresh yields nothing", async () => {
    const out = await updateLiveWinRateCache("standard", "bo1", throwingFetch());
    expect(out.length).toBe(0);
  });
});

// ── helpers ───────────────────────────────────────────────────────────────────

describe("format + environment helpers", () => {
  it("recognises supported constructed formats", () => {
    expect(isFormatSupported("standard")).toBe(true);
    expect(isFormatSupported("explorer")).toBe(true);
    expect(isFormatSupported("modern")).toBe(false);
    expect(isFormatSupported(undefined)).toBe(false);
  });

  it("maps bo3 to tournament and everything else to ladder", () => {
    expect(environmentFor("bo3")).toBe("tournament");
    expect(environmentFor("bo1")).toBe("ladder");
    expect(environmentFor(undefined)).toBe("ladder");
  });
});
