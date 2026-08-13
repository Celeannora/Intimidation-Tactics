# Meta-Snapshot + Counter-Analysis Subsystem

> Status: **scheduled server-side refresh**. The generator `metaTargets` hook
> remains a no-op; snapshot refresh does not alter generation policy by itself.

## Why a bundled snapshot

No public Standard metagame source is CORS-accessible from a client-side PWA, so
the metagame is shipped as a **versioned bundled JSON snapshot**
(`src/data/meta/standard-snapshot.json`) with an *optional* remote-refresh URL
checked at runtime. This keeps the app fully functional offline while leaving a
seam to pull fresher data later.

## Architecture

```
src/data/meta/standard-snapshot.json   reviewed Standard archetype snapshot
src/lib/meta/types.ts                   MetaSnapshot / MetaArchetype / CounterReport types
src/lib/meta/snapshot.ts                loader: bundled import, validation, CDN refresh + Dexie cache
src/lib/meta/counterAnalysis.ts         analyzeCounters(): naive posture + tech suggestions
src/lib/meta/__tests__/meta.test.ts     tests for the implemented parts
scripts/refreshMetaSnapshot.ts          Node-only multi-source refresh + raw-response cache
.github/workflows/refresh-meta.yml      daily refresh that opens a review PR
```

- **`types.ts`** — `MetaSnapshot { schemaVersion: 1; format: "standard"; updatedAt; source; archetypes[] }`,
  `MetaArchetype` (reuses the existing `Archetype` enum as `macro`, plus Badaro-style
  `keyCards`), and the `CounterReport` / `CounterSuggestion` output shapes.
- **`snapshot.ts`** — imports the bundled JSON, exposes `getMetaSnapshot(remoteUrl?)`,
  `validateSnapshot()` (checks `schemaVersion`, `format`, and that shares sum ≤ 1.05),
  and `fetchRemoteSnapshot(url)`. The default remote is the CORS-permissive
  jsDelivr mirror at
  `https://cdn.jsdelivr.net/gh/Celeannora/Intimidation-Tactics@main/src/data/meta/standard-snapshot.json`.
  Valid remote data is cached in Dexie for 24 hours; a timeout, malformed
  response, or validation failure falls back to cache and then the bundle.
- **`refreshMetaSnapshot.ts`** — reads public MTGGoldfish, MTGTop8, and Untapped.gg
  Standard pages outside the browser, rate limits requests, caches raw responses
  under `.cache/meta-refresh/`, and validates before writing either snapshot.
  A source that fails or changes page structure is logged and omitted; all three
  failing aborts without overwriting tracked data.
- **`counterAnalysis.ts`** — `analyzeCounters(deck, pool, snapshot)` returns a
  structurally valid `CounterReport`. Posture is a naive speed/macro heuristic;
  suggestions reuse the existing `suggestTechCardsV2` engine.

## Integration with existing code (intentionally minimal)

- `MetaArchetype.macro` reuses `src/lib/archetype.ts`'s `Archetype` enum — one
  vocabulary, no parallel enum.
- Counter suggestions route through `suggestTechCardsV2` (`src/lib/matchup.ts`).
- `GenerateOptions.metaTargets?: string[]` was added and threaded into
  `generator.ts` as a **documented no-op** (records a reasoning line only).

## Snapshot update process

- **Local:** run `npm run refresh-meta`. It follows each available source's
  `robots.txt` directives, waits between uncached requests, and reuses the
  local raw-response cache to avoid repeated development traffic.
- **CI:** `.github/workflows/refresh-meta.yml` runs daily at 06:00 UTC and on
  `workflow_dispatch`. Changed snapshots are committed only to a
  `meta-refresh/standard` branch and opened as a pull request against `main`;
  the workflow never commits directly to `main`.
- **Data boundaries:** archetype shares are a merge of sources that parse
  successfully. Per-card frequency is derived only from source-published
  representative decklists (currently MTGGoldfish); it is an inclusion proxy,
  not a match-win-rate claim. Untapped contributes only when its public page
  still embeds a parseable archetype dataset.

## Implementation TODO list (search `TODO(meta):`)

1. `snapshot.ts` — surface a "last refreshed" timestamp to the UI.
2. `counterAnalysis.ts` — replace the speed-only posture with a real model
   (key-card answer coverage, goldfish clock, stored `MatchResult` win rates).
3. `counterAnalysis.ts` — rank suggestions against each archetype's
   `keyCards`/`commonInteraction`, and decide `main` vs `side` per card.
4. `counterAnalysis.ts` — expose `suggestTechCardsV2`'s numeric score instead of
   the placeholder `score: 1`.
5. `generator.ts` / `types.ts` — consume `metaTargets`: bias card scoring toward
   answers for the targeted archetypes' key cards.
