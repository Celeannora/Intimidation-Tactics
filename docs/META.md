# Meta-Snapshot + Counter-Analysis Subsystem

> Status: **scaffold**. Interface-complete with documented `TODO(meta):` markers.
> No behavior change to existing code; the generator `metaTargets` hook is a no-op.

## Why a bundled snapshot

No public Standard metagame source is CORS-accessible from a client-side PWA, so
the metagame is shipped as a **versioned bundled JSON snapshot**
(`src/data/meta/standard-snapshot.json`) with an *optional* remote-refresh URL
checked at runtime. This keeps the app fully functional offline while leaving a
seam to pull fresher data later.

## Architecture

```
src/data/meta/standard-snapshot.json   real June 2026 Standard sample data
src/lib/meta/types.ts                   MetaSnapshot / MetaArchetype / CounterReport types
src/lib/meta/snapshot.ts                loader: bundled import, validate, remote-refresh stub
src/lib/meta/counterAnalysis.ts         analyzeCounters(): naive posture + tech suggestions
src/lib/meta/__tests__/meta.test.ts     tests for the implemented parts
```

- **`types.ts`** — `MetaSnapshot { schemaVersion: 1; format: "standard"; updatedAt; source; archetypes[] }`,
  `MetaArchetype` (reuses the existing `Archetype` enum as `macro`, plus Badaro-style
  `keyCards`), and the `CounterReport` / `CounterSuggestion` output shapes.
- **`snapshot.ts`** — imports the bundled JSON, exposes `getMetaSnapshot(remoteUrl?)`,
  `validateSnapshot()` (checks `schemaVersion`, `format`, and that shares sum ≤ 1.05),
  and `fetchRemoteSnapshot(url)` (stub returning `null`).
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

- **Now (manual):** hand-edit `standard-snapshot.json` from current sources
  (MTGGoldfish / MTGTop8 / WotC Metagame Mentor), bump `updatedAt`, keep `source`
  honest, and ensure shares sum ≤ 1.05. `validateSnapshot()` is the guard.
- **Later (scripted):** a build/CI step regenerates the JSON from a data source,
  then `fetchRemoteSnapshot(url)` lets the running app pull updates between
  releases, caching in Dexie.

## Implementation TODO list (search `TODO(meta):`)

1. `snapshot.ts` — implement `fetchRemoteSnapshot`: GET + parse + `validateSnapshot`
   + Dexie cache keyed by `format`+`updatedAt`; surface a "last refreshed" time.
2. `counterAnalysis.ts` — replace the speed-only posture with a real model
   (key-card answer coverage, goldfish clock, stored `MatchResult` win rates).
3. `counterAnalysis.ts` — rank suggestions against each archetype's
   `keyCards`/`commonInteraction`, and decide `main` vs `side` per card.
4. `counterAnalysis.ts` — expose `suggestTechCardsV2`'s numeric score instead of
   the placeholder `score: 1`.
5. `generator.ts` / `types.ts` — consume `metaTargets`: bias card scoring toward
   answers for the targeted archetypes' key cards.
