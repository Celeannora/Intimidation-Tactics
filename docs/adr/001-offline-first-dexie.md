# ADR-001: Offline-First with Dexie/IndexedDB

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Core team

---

## Context and Problem Statement

Intimidation-Tactics is a deck-building tool that must work reliably at paper events, hotel Wi-Fi dead zones, and any environment where internet access is intermittent or unavailable. The card pool is large (~30,000+ cards) and must be queryable in milliseconds without a network round-trip. How should card data be stored and queried on the client?

---

## Decision Drivers

- Users must be able to build and browse decks with **zero network dependency** once cards are imported
- Card queries (filter by colour, type, legality, keyword) must complete in **< 50 ms** to feel instant
- Storage must survive page refreshes and browser sessions indefinitely
- The data model needs schema versioning to support future migrations without data loss
- Developer ergonomics: TypeScript-native API, Promise-based, no SQL boilerplate

---

## Considered Options

### Option A: Dexie.js (IndexedDB wrapper) ✓ chosen

### Option B: SQLite via WASM (e.g. wa-sqlite, sql.js)

### Option C: In-memory store (Zustand / Map) with localStorage serialisation

### Option D: Hosted database (Supabase, PlanetScale) with offline fallback

---

## Decision Outcome

**Chosen option: Dexie.js (IndexedDB)**

Dexie is the thinnest viable abstraction over IndexedDB that provides:
- Typed tables via `Table<T, K>` generics
- Declarative schema versioning (`version(N).stores(...)`) with automatic migration
- Compound and multi-value indices (critical for `*colorsJson`, `*keywordsJson` array queries)
- Observable live queries (`liveQuery`) for reactive UI updates
- Transactions with automatic rollback

The entire card database is imported once and lives in IndexedDB. No network call is required for deck building after the initial import.

---

## Consequences

### Positive

- Full offline capability from first use after import
- Sub-5 ms indexed queries on a 35,000-row card table
- Automatic schema upgrades across app versions
- Zero server infrastructure required for core functionality
- Data stays on the user's device — no privacy concerns

### Negative

- IndexedDB storage quota varies by browser/platform (typically 50 MB – 1 GB)
- Initial import is a one-time ~8-10 second operation (35k card write)
- Multi-value index syntax (`*fieldName`) is Dexie-specific — not portable to other IndexedDB libraries
- Cross-tab synchronisation requires Dexie's `liveQuery` or manual BroadcastChannel coordination

### Neutral

- Querying JSON-serialised arrays (e.g. `colorsJson`) via multi-value indices is Dexie-specific but well-documented

---

## Pros and Cons of Rejected Options

### Option B — SQLite WASM

- ✓ True SQL: joins, aggregates, subqueries
- ✗ 1–3 MB WASM bundle adds to initial load time
- ✗ No built-in multi-value array indexing (requires JSON functions or junction tables)
- ✗ More complex setup; persistence requires Origin Private File System (OPFS)

### Option C — In-memory + localStorage

- ✓ Zero dependencies, instant reads
- ✗ localStorage is capped at 5–10 MB — cannot hold 30k card records
- ✗ Synchronous API blocks the main thread during writes
- ✗ No structured querying — JS array `.filter()` on 35k items is ~10-50 ms

### Option D — Hosted database

- ✓ No storage quota concerns
- ✓ Real-time sync across devices
- ✗ Requires network — violates the offline-first requirement
- ✗ Adds server costs, auth complexity, and a privacy attack surface

---

## More Information

- [Dexie.js documentation](https://dexie.org/docs/)
- [IndexedDB quota limits (MDN)](https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
- Schema reference: [DATABASE_SCHEMA.md](../DATABASE_SCHEMA.md)
