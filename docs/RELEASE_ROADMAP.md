# Intimidation-Tactics — Release Roadmap
> **Date:** 2026-06-15  
> **Author:** Engineering review (cross-reference: ENGINEERING_ASSESSMENT.md, SYNERGY_CHAIN_AUDIT_2026-06-15.md, PROJECT_AUDIT_2026-06-15.md)  
> **Perspective:** Mythic-level MTG player × Senior engineering leader  
> **Purpose:** Definitive gap-analysis and phased action plan from current prototype state to a public-ready product.

---

## Executive Summary

Intimidation-Tactics has a genuinely exceptional foundation for an independent PWA: offline-first architecture, a type-strict TypeScript pipeline, a 16-file test suite already in `src/lib/__tests__/`, a multi-provider AI abstraction layer, a live engineering tracker, and three audit documents that demonstrate unusual self-awareness about quality. The engine has the structural bones to reach Mythic rank as a tool.

What stands between current state and public release is not a missing feature — it is a **missing harness**. The scoring and generation pipeline has grown complex enough that changes in any stage can silently shift output without tests catching it. The AI layer produces output whose legality is never programmatically validated before display. Heavy computations (synergy graph, generator optimizer, bulk import) have no guaranteed off-thread execution path. State, hooks, and configuration are coherent but underdisciplined for production scale.

This document provides an unambiguous, phase-gated action plan to close every identified gap. Work is organized into six phases. Each phase has a concrete exit criterion. No phase is optional.

---

## Part 1 — Codebase Inventory and Risk Register

### 1.1 What Exists Today (Confirmed)

| Layer | Key Files | Quality Signal |
|---|---|---|
| Domain types | `src/lib/types.ts`, `formats.ts`, `archetype.ts`, `roles.ts` | Strong. Typed, shared, consistent. |
| Card scoring | `src/lib/scoreEngine.ts`, `scoring.ts`, `competitivePower.ts`, `powerScore.ts` | Medium. Grown complex, coupling to multiple config sources. |
| Generator pipeline | `src/lib/` (generator/ subdir implied by imports in seedAnalyzer) | High risk. Monolithic, not stage-interfaced. |
| Synergy analysis | `src/lib/analysis/seedAnalyzer.ts`, `synergyGraph.ts` | Medium. Logic is sound but graph is not cached or worker-isolated. |
| AI integration | `src/lib/ai/{aiGenerator, provider, factory, openai, ollama, llamacpp, resolver, digest, models}.ts` | High risk. No output validation layer confirmed in audit. |
| Data / DB | `src/lib/db.ts`, `scryfall.ts`, `deckParser.ts`, `deckImportSources.ts`, `persistence.ts` | Medium risk. Schema versioning undocumented. |
| Mana & legality | `src/lib/mana.ts`, `manaBase.ts`, `karsten.ts`, `landSources.ts`, `hypergeometric.ts`, `legality.ts` | Good. Pure math, tested in `__tests__/`. |
| Deck utilities | `src/lib/deckComposition.ts`, `deckCompare.ts`, `deckExporter.ts`, `sideboardPlan.ts`, `bo3.ts` | Tested. `bo3.test.ts`, `consistencyReport.test.ts` exist. |
| State | `src/store/` | Zustand single store, risk of coupling as features grow. |
| Hooks | `src/hooks/` | Likely mixing computation and orchestration. |
| AI tests | `src/lib/ai/__tests__/` (directory exists) | Content unknown — likely sparse or absent. |
| Workers | `src/workers/` | Import worker confirmed. Generator offload unknown. |
| UI | `src/components/`, `src/App.tsx` | Functional, polish deferred. |
| PWA | `public/sw.js`, `public/manifest.webmanifest` | Present, strategy undocumented. |

### 1.2 Confirmed Existing Test Coverage

From `src/lib/__tests__/` (confirmed 16 test files):

| Test File | Covers |
|---|---|
| `archetype.detector.test.ts` | Archetype classification |
| `archetypeVocab.consistency.test.ts` | Vocabulary consistency |
| `bo3.test.ts` | Best-of-3 sideboard logic |
| `companion.test.ts` | Companion legality constraints |
| `competitivePower.test.ts` | Competitive power scoring |
| `consistencyReport.test.ts` | Consistency reporting |
| `deckParser.test.ts` | Deck parsing |
| `handSimulator.test.ts` | Hand simulation |
| `hypergeometric.test.ts` | Mathematical probability |
| `karsten.test.ts` | Karsten mana source calculations |
| `legality.test.ts` | Format legality rules |
| `mana.test.ts` | Mana computation |
| `manaBase.test.ts` | Mana base construction |
| `scryfall.test.ts` | Scryfall API / data handling |
| `search.test.ts` | Card search |
| `synergy.integration.test.ts` | Synergy integration (scope unknown) |

**Gap:** No confirmed tests for `scoreEngine.ts`, `seedAnalyzer.ts`, the full generator pipeline, or AI output parsing/validation. The `ai/__tests__/` directory exists but content was not confirmed as non-empty.

### 1.3 Risk Register

| ID | Area | Risk Description | Severity | Likelihood |
|----|------|-----------------|----------|-----------|
| R-01 | Generator pipeline | Monolithic stages with implicit config dependencies — config change silently shifts all outputs | **High** | High |
| R-02 | AI integration | No `validateAIProposal()` function — illegal/nonsensical decks displayed as suggestions | **High** | High (confirmed AI audit) |
| R-03 | AI prompt prompts | Embedded in TS logic; prompt changes require code surgery with no structured diff | **Medium** | High |
| R-04 | Synergy graph | Computed eagerly, no caching by seed hash, no worker isolation | **Medium** | Medium |
| R-05 | Bulk import | Full JSON parse in memory, likely unbatched writes, no chunked progress UX | **Medium** | Medium |
| R-06 | IndexedDB schema | No formal `db.ts` version documentation or migration test coverage | **Medium** | Medium |
| R-07 | Main thread | Generator optimizer runs on main thread; >100ms on full Standard pool → UI freeze | **Medium** | Medium |
| R-08 | Zustand store | Flat monolithic state; no slice discipline; selector breadth causes re-renders | **Low-Med** | Growing |
| R-09 | Hooks | `useConsistencyReport`, `useCardPool` likely mix computation with orchestration | **Low-Med** | Growing |
| R-10 | PWA caching | No documented cache strategy — stale clients, quota exhaustion possible post-deploy | **Low** | Low |
| R-11 | Configuration | Coefficient interactions undocumented; no calibration harness to observe config change impact | **High** | High |
| R-12 | Score engine tests | `scoreEngine.ts` has zero known test coverage despite being a critical path | **High** | High |
| R-13 | AI mock provider | No confirmed `MockAIProvider` for CI; AI tests require live endpoint or are absent | **High** | High |
| R-14 | First-time UX | No onboarding flow for new users; empty state is undefined | **Medium** | High (first impressions) |
| R-15 | Accessibility | No confirmed ARIA audit or keyboard nav coverage | **Medium** | Unknown |

---

## Part 2 — Product Definition and Release Criteria

### 2.1 V1 Product Promise

> _Intimidation-Tactics v1 is an offline-first, AI-augmented deck builder for MTG Arena (Standard format). It accepts seed cards from a user, infers the deck's strategic intent, constructs a synergy-aware 60-card main deck and 15-card sideboard, and optionally refines that deck using a local or cloud AI model. Every deck it outputs is format-legal. Every score it produces is deterministic for the same inputs and config version._

**In scope for v1:**
- Standard format (enforcing current ban list from imported card data)
- Seed-driven analysis: archetype inference, synergy graph, role compose
- Deterministic offline generator with calibrated scoring pipeline
- AI-assisted refinement (OpenAI, Ollama, llama.cpp) with full output validation
- Scryfall bulk import with chunked progress UX
- PWA: installable, offline-capable after first import
- Basic first-time user onboarding

**Explicitly deferred to v1.x:**
- Additional formats (Pioneer, Explorer, Historic, Limited)
- Real-time meta API feeds
- Match tracker and Bo3 deep analytics (infrastructure exists, UX deferred)
- Advanced visualization of synergy graphs
- Multi-language support

### 2.2 Hard Release Criteria (Exit Gates)

Every criterion below must be true before any public launch. These are binary: pass or fail.

#### Correctness
- [ ] **RC-01** — Every deck output (generator or AI) passes `validateDeck(deck, pool, format)`: correct card counts, no banned cards, no cards absent from imported pool, legal duplicate limits, companion constraints where applicable.
- [ ] **RC-02** — `seedAnalyzer` produces deterministic output for identical inputs (no non-seeded randomness in critical path).
- [ ] **RC-03** — Hypergeometric and Karsten calculations match reference values within 0.001 absolute error (test suite enforces).
- [ ] **RC-04** — AI fallback to offline generator is triggered on: API error, parse failure, validation failure after 2 retries. User sees informative message, not a broken deck.

#### Performance
- [ ] **RC-05** — Full Standard pool import (≥10,000 cards) completes on a 4GB RAM browser tab without crash. Memory profiled during test.
- [ ] **RC-06** — Generator run on 2,000-card filtered pool completes in <500ms on main thread OR is executed in a worker with loading state shown before 300ms.
- [ ] **RC-07** — Initial app load to interactive state: ≤3s on broadband, ≤8s on 3G (Lighthouse or WebPageTest measured).
- [ ] **RC-08** — Synergy graph for a 10-seed set completes in <200ms. Cached by seed deck hash for subsequent calls.

#### Reliability
- [ ] **RC-09** — All 16 existing unit tests pass on CI with no skips.
- [ ] **RC-10** — `scoreEngine.ts` has ≥80% branch coverage via new tests.
- [ ] **RC-11** — `seedAnalyzer.ts` has ≥80% branch coverage via new tests.
- [ ] **RC-12** — AI parsing/validation layer tested via `MockAIProvider` across ≥8 output shapes (valid, illegal card, bad count, truncated, empty, JSON malformed, banned card, oversized sideboard).
- [ ] **RC-13** — Calibration harness runs on 5 curated pools and produces stable score snapshots stored as fixtures. No unreviewed regression between fixture versions.

#### PWA and Offline
- [ ] **RC-14** — App loads from cache after first import (tested with DevTools offline mode).
- [ ] **RC-15** — New service worker version shows "Update available" banner. Old worker does not silently stay active post-deploy.
- [ ] **RC-16** — Storage quota error is surfaced with actionable message (not silent crash).

#### UX and Accessibility
- [ ] **RC-17** — All interactive elements reachable by keyboard (verified by Tab-through audit).
- [ ] **RC-18** — All form controls and icon buttons have `aria-label` or visible label.
- [ ] **RC-19** — Error messages for all failure paths are specific (naming what failed and suggesting action), not generic.
- [ ] **RC-20** — First-time user lands on screen that explains what the app does and what to do next.

---

## Part 3 — Gap Analysis by Component

### 3.1 Generator and Scoring Pipeline

**Current state:** Seven modules form a coupled pipeline with no typed stage interfaces. `scoreEngine.ts`, `competitivePower.ts`, `scoring.ts`, and generator-internal modules share configuration via imports rather than explicit injection.

**What is missing:**
1. Typed stage interfaces (`PoolBuilder`, `RoleTargeter`, `ColorWeighter`, `SynergyWeighter`, `Optimizer`, `SideboardPlanner`) with explicit input/output types.
2. Dependency injection for `scoringConfig` and `archetypeProfiles` — stages should receive config as parameters, not import globals.
3. `scoreEngine.ts` test suite: currently zero confirmed coverage of the most critical scoring path.
4. Calibration harness: a Node script that runs the full pipeline over 5–10 curated pools and diffs score breakdown outputs between runs/config changes.
5. Documentation of coefficient interactions in `scoringConfig.ts`.

**Required work:**
- Define `PipelineStageInput<T>` / `PipelineStageOutput<T>` generics in `src/lib/generator/types.ts`.
- Refactor `weights.ts`, `scoreEngine.ts`, and meta-aware modules to accept explicit config/context parameters.
- Add `src/lib/__tests__/scoreEngine.test.ts` targeting all score components with controlled card stubs.
- Add `src/lib/__tests__/seedAnalyzer.test.ts` covering all archetype inference branches, null seeds, > max seeds, and conflicting axes.
- Create `scripts/calibrate.ts` — runnable with `npx tsx scripts/calibrate.ts`, outputs JSON score fixtures for stored pools.
- Document each `scoringConfig.ts` constant with inline JSDoc: purpose, valid range, interaction notes.

### 3.2 AI Integration Layer

**Current state:** `aiGenerator.ts` composes prompts, calls providers (OpenAI, Ollama, llama.cpp via the `provider.ts` abstraction), and parses responses. The `ai/__tests__/` directory exists but its contents are not confirmed to cover parsing or validation.

**What is missing:**
1. `validateAIProposal(proposal: AIDeckProposal, pool: CardRecord[], format: Format): ValidationResult` function.
2. Retry loop with corrective re-prompting (max 2 retries) before fallback.
3. Explicit fallback strategy: if validation fails after retries → run offline generator → display with "AI unavailable" notice.
4. Structured output schema: prompts must request a specific JSON shape, and the parser must validate against that schema.
5. `MockAIProvider` with version-controlled fixture responses keyed by prompt hash.
6. AI test suite covering ≥8 output shapes (see RC-12).
7. Prompt templates extracted to `src/lib/ai/prompts/` as typed string templates.
8. Structured logging of AI call outcomes: provider, model, success/failure, validation errors, latency.

**Required work:**
- Create `src/lib/ai/validateProposal.ts` implementing full legality + structural validation.
- Create `src/lib/ai/prompts/analyzeDeck.ts` and `refineDeck.ts` with typed context interfaces.
- Update `aiGenerator.ts` to use prompt templates and wrap calls in retry + fallback scaffold.
- Create `src/lib/ai/__tests__/validateProposal.test.ts` and `aiGenerator.test.ts` using `MockAIProvider`.
- Create `src/test/fixtures/ai/` with 8+ fixture files.
- Add AI call telemetry to `src/lib/ai/digest.ts` or a new `src/lib/ai/telemetry.ts`.

### 3.3 Scryfall Bulk Import

**Current state:** `src/workers/` contains at least one import worker. `src/lib/scryfall.ts` handles API/data concerns. `src/lib/db.ts` manages Dexie.

**What is missing:**
1. Chunked JSON processing (avoid whole-file `JSON.parse` into memory).
2. Batched Dexie writes (500–1,000 cards per transaction using `bulkPut`).
3. Sub-second progress reporting from worker to main thread (cards processed / total / ETA).
4. Storage quota error detection and user-facing messaging.
5. Schema version documentation in `db.ts` and a `docs/DATABASE_SCHEMA.md`.
6. Migration test using `fake-indexeddb`.

**Required work:**
- Audit `src/workers/importWorker.ts` (or equivalent) and refactor to chunked reads + batched Dexie transactions.
- Add progress message type to worker message protocol.
- Add quota detection via `navigator.storage.estimate()` before starting import with user warning if <200MB remains.
- Write `docs/DATABASE_SCHEMA.md` documenting all Dexie tables, key paths, indexes, and current version.
- Add `src/lib/__tests__/db.migration.test.ts` using `fake-indexeddb` to seed v(n-1) data and verify v(n) upgrade.

### 3.4 Performance and Worker Offloading

**Current state:** Generator pipeline confirmed to run on main thread. Synergy graph built eagerly without caching.

**What is missing:**
1. Generator pipeline execution time profile on a 2,000-card pool.
2. Conditional worker execution: if pipeline exceeds 100ms, route through `generatorWorker`.
3. Synergy graph caching keyed by seed deck hash.
4. Loading state with 300ms threshold in UI for any operation >300ms.

**Required work:**
- Add `performance.mark()` / `performance.measure()` annotations around pipeline stages; capture in development mode.
- If profile shows >100ms for 2,000-card pool: create `src/workers/generatorWorker.ts` implementing the same stage interface as the main-thread pipeline.
- Add cache map in `synergyGraph.ts` (or `seedAnalyzer.ts`): `Map<string, SynergyGraph>` keyed by `JSON.stringify(sortedSeedIds)`.
- Establish a `useAsyncOperation(label, fn)` hook that sets store loading state, handles errors, and clears on completion.

### 3.5 IndexedDB Schema Versioning

**Current state:** `src/lib/db.ts` uses Dexie. Schema version history is not confirmed as documented or tested.

**What is missing:**
1. Documented schema version (current version N, history of changes).
2. Upgrade functions for every non-trivial schema change.
3. Migration tests.

**Required work:**
- Audit `db.ts` and document the current version, tables, and indexes in `docs/DATABASE_SCHEMA.md`.
- Ensure every `db.version(N).stores(...)` call has an `.upgrade()` handler documented with comment.
- Create `src/lib/__tests__/db.migration.test.ts`.

### 3.6 State Management and Hooks

**Current state:** Single Zustand store in `src/store/`. Multiple hooks in `src/hooks/`. Likely computation mixed into hooks.

**What is missing:**
1. Store slice structure (deck, generator, ai, matchHistory, ui).
2. Selector-only access in components (no full-store destructuring).
3. Heavy computation moved from hooks to `src/lib/` pure functions.
4. Memoization of expensive derived values.

**Required work:**
- Audit `src/store/` files and group state into logical slices.
- Audit `src/hooks/` files; identify and externalize non-trivial computations to `lib/`.
- Add `immer` middleware to the Zustand store if not already present.
- Add `src/store/__tests__/` with slice action tests.
- Enforce selector access pattern via ESLint rule or code convention documented in `CONTRIBUTING.md`.

### 3.7 PWA Service Worker and Lifecycle

**Current state:** `public/sw.js` and `public/manifest.webmanifest` exist. No documented caching strategy.

**What is missing:**
1. Documented cache strategy per content type (static assets vs. dynamic data vs. card database).
2. Cache versioning with stale-cache eviction on new deploy.
3. "Update available" notification to clients when new SW is installed.
4. Offline fallback for pre-import state (show "Import card data to use offline" instead of broken blank screen).
5. `docs/PWA_STRATEGY.md` documenting all of the above.

**Required work:**
- Rewrite or annotate `public/sw.js` with explicit cache name versioning, cache-first for static assets, stale-while-revalidate for Scryfall metadata.
- Add `postMessage` update notification: when the waiting SW installs, post `{type: 'SW_UPDATE_AVAILABLE'}` to clients.
- Handle this message in `src/pwa.ts` and surface a dismissible update banner in the UI.
- Create `docs/PWA_STRATEGY.md`.
- Test offline scenario: DevTools → Offline → reload → verify correct fallback screen.

### 3.8 Documentation and Governance

**Current state:** Rich docs exist but ADR directory is absent. Engineering tracker is a chronological log with no stabilization mechanism.

**What is missing:**
1. `docs/adr/` directory with at least 5 seed ADRs for key architectural decisions.
2. Periodic tracker curation policy.
3. `docs/DATABASE_SCHEMA.md`.
4. `docs/PWA_STRATEGY.md`.
5. `CONTRIBUTING.md` with dev setup, test commands, and PR expectations.
6. Updated `README.md` with current architecture and setup instructions.

**Required work:**
- Create `docs/adr/` with the following initial ADRs:
  - `001-offline-first-dexie.md` — why Dexie over raw IDB
  - `002-zustand-state.md` — why Zustand, slice conventions
  - `003-ai-provider-abstraction.md` — why multi-provider abstraction
  - `004-log-compressed-synergy.md` — why synergy scores use log compression
  - `005-meta-adjustment-bounds.md` — why ±30% meta caps
- Curate `ENGINEERING_LIVE_TRACKER.md`: archive completed items, extract stable conclusions into ADRs.
- Create `CONTRIBUTING.md`.
- Update `README.md`.

### 3.9 UX, Onboarding, and Accessibility

**Current state:** Functional UI. First-time experience and accessibility status are unknown.

**What is missing:**
1. Empty states for all major views (no seeds, no import, no results).
2. First-time user guidance (import prompt, what seeds do, how AI works).
3. Keyboard navigation audit.
4. ARIA labels on all interactive elements.
5. Consistent error message copy across all failure paths.
6. "AI generating…" progress state with cancel option.

**Required work:**
- Audit all major views for empty state and add informative empty state components.
- Add onboarding: if card database is not imported, show a welcoming "Get Started" screen.
- Tab-through every form and interactive element; fix any missing focus or label.
- Add `aria-label` attributes to all icon buttons and non-obvious controls.
- Review all `throw new Error(...)` and `.catch()` paths to ensure they propagate user-visible messages.
- Add `useAsyncOperation` loading/error pattern to AI suggestion, generator run, and import views.

---

## Part 4 — Phased Execution Plan

### Phase 1 — Consolidation and Scope Lock
**Duration estimate:** 2–3 days  
**Exit criterion:** Written scope doc, unified risk register, all phase 2–6 tasks itemized in tracker.

| Task | Owner Area | Priority |
|------|-----------|---------|
| Finalize V1 product promise (Section 2.1 above) | Product | Blocker |
| Confirm all 16 existing tests pass on CI | Engineering | Blocker |
| Audit `src/lib/ai/__tests__/` and report actual coverage | Engineering | Blocker |
| Audit `src/store/` and `src/hooks/` — map what exists | Engineering | High |
| Audit `src/workers/` — confirm import worker implementation | Engineering | High |
| Write `docs/DATABASE_SCHEMA.md` stub | Engineering | High |
| Create `docs/adr/` and write 5 seed ADRs | Engineering | Medium |
| Lock V1 feature/format scope formally | Product | Blocker |

---

### Phase 2 — Generator and Scoring Hardening
**Duration estimate:** 5–8 days  
**Exit criterion:** Stage interfaces defined; `scoreEngine` and `seedAnalyzer` at ≥80% test coverage; calibration harness producing stable fixtures; config documented.

| Task | Files Affected | Risk Addressed |
|------|---------------|----------------|
| Define `PipelineStageInput<T>` / `PipelineStageOutput<T>` generics | `src/lib/generator/types.ts` | R-01 |
| Refactor generator stages to accept explicit config/context params | `weights.ts`, `scoreEngine.ts`, `metaScoring.ts` | R-01 |
| Write `src/lib/__tests__/scoreEngine.test.ts` | New file | R-12 |
| Write `src/lib/__tests__/seedAnalyzer.test.ts` | New file | R-12 |
| Create `scripts/calibrate.ts` calibration harness | New file | R-11 |
| Document all `scoringConfig.ts` constants with JSDoc interactions | `scoringConfig.ts` | R-11 |
| Run calibration harness on 5 curated pools; store fixtures | `src/test/fixtures/calibration/` | R-11, R-13 |
| Profile generator pipeline on 2,000-card pool; record baseline | Profiling script / notes | R-07 |
| If profile >100ms: create `src/workers/generatorWorker.ts` | New file | R-07 |
| Add synergy graph caching by seed deck hash | `src/lib/analysis/synergyGraph.ts` | R-04 |
| Update `ENGINEERING_LIVE_TRACKER.md` with phase 2 conclusions | Docs | Process |

---

### Phase 3 — AI Integration Hardening
**Duration estimate:** 4–6 days  
**Exit criterion:** `validateAIProposal` live; retry+fallback scaffold tested; MockAIProvider with 8+ fixtures; AI telemetry logging; all AI tests pass on CI.

| Task | Files Affected | Risk Addressed |
|------|---------------|----------------|
| Create `src/lib/ai/validateProposal.ts` | New file | R-02 |
| Extract prompt templates to `src/lib/ai/prompts/` | New files | R-03 |
| Update `aiGenerator.ts` with retry loop (max 2) + fallback to offline generator | `aiGenerator.ts` | R-02 |
| Create `src/lib/ai/telemetry.ts` for structured AI call logging | New file | R-02 |
| Create `MockAIProvider` in `src/lib/ai/mock.ts` | New file | R-13 |
| Create `src/test/fixtures/ai/*.json` — 8+ response shapes | New files | R-13 |
| Write `src/lib/ai/__tests__/validateProposal.test.ts` | New file | R-13, R-02 |
| Write `src/lib/ai/__tests__/aiGenerator.test.ts` | New file | R-13 |
| Add AI loading/error state to UI via `useAsyncOperation` | `src/hooks/`, `src/components/` | R-14 |
| Test RC-04 manually: kill network mid-AI call → verify fallback | Manual test | R-02 |

---

### Phase 4 — Data, Performance, and PWA Hardening
**Duration estimate:** 4–5 days  
**Exit criterion:** Import worker is chunked+batched; DB schema documented and migration-tested; generator worker exists if needed; PWA update notification works; offline fallback tested.

| Task | Files Affected | Risk Addressed |
|------|---------------|----------------|
| Audit + refactor `src/workers/importWorker.ts` for chunked parse + batched writes | `importWorker.ts`, `db.ts` | R-05 |
| Add `navigator.storage.estimate()` pre-import quota check | `importWorker.ts` or import hook | R-05 |
| Add sub-second progress messages from import worker | `importWorker.ts`, `src/hooks/useImport` | R-05 |
| Write `docs/DATABASE_SCHEMA.md` (full version) | New file | R-06 |
| Write `src/lib/__tests__/db.migration.test.ts` using `fake-indexeddb` | New file | R-06 |
| Annotate all `db.version().stores().upgrade()` calls with intent comments | `src/lib/db.ts` | R-06 |
| Rewrite `public/sw.js` with versioned cache names + eviction on activate | `public/sw.js` | R-10 |
| Add SW update notification via `postMessage` + banner in `src/pwa.ts` | `public/sw.js`, `src/pwa.ts` | R-10 |
| Create `docs/PWA_STRATEGY.md` | New file | R-10 |
| Test offline scenario manually (RC-14, RC-15, RC-16) | Manual test | R-10 |

---

### Phase 5 — State, UX, Accessibility, and Documentation
**Duration estimate:** 4–6 days  
**Exit criterion:** Store sliced; heavy hook computations extracted; all RC-17–RC-20 pass; onboarding screen exists; all ADRs written; CONTRIBUTING.md and README.md complete.

| Task | Files Affected | Risk Addressed |
|------|---------------|----------------|
| Slice Zustand store into deck / generator / ai / ui / matchHistory | `src/store/` | R-08 |
| Add `immer` middleware to store if absent | `src/store/index.ts` | R-08 |
| Audit hooks; extract computations to `lib/` pure functions | `src/hooks/`, `src/lib/` | R-09 |
| Add `src/store/__tests__/` with slice action tests | New files | R-08 |
| Keyboard Tab-through audit; fix all gaps | `src/components/` | R-15 |
| Add `aria-label` to all icon buttons and controls | `src/components/` | R-15 |
| Add empty state components for all major views | `src/components/` | R-14 |
| Add first-time onboarding screen (import prompt + feature intro) | `src/components/` | R-14 |
| Standardize error message copy across all failure paths | `src/components/`, `src/hooks/` | R-14 |
| Finalize `docs/adr/` with all 5 seed ADRs | `docs/adr/` | Process |
| Write `CONTRIBUTING.md` | Root | Process |
| Update `README.md` | Root | Process |
| Final docs curation: archive completed tracker items | `docs/ENGINEERING_LIVE_TRACKER.md` | Process |

---

### Phase 6 — Beta Validation and Public Launch
**Duration estimate:** 3–5 days  
**Exit criterion:** All RC-01 through RC-20 pass; beta feedback addressed; deploy confirmed stable; monitoring live.

| Task | Notes |
|------|-------|
| Code freeze for non-critical features | Only P0/P1 bugs permitted |
| Run full CI suite including calibration harness | All tests green |
| Deploy to staging; run manual RC checklist | Document pass/fail per RC |
| Invite beta testers (ideally 3–5 mythic-level players) | Structured feedback form |
| Address all critical beta findings | Triage and fix or defer explicitly |
| Add error logging service (Sentry or equivalent) | Required before public |
| Add basic analytics (PostHog or Plausible) | Privacy-respecting, minimal |
| Tag release (semver `v1.0.0`) | Git tag on main |
| Deploy to production | Confirm SW update banner works |
| Monitor error rates and performance for 48h post-launch | Alert threshold: >1% error rate |
| Publish public announcement | Only after 48h stable period |

---

## Part 5 — CI Pipeline Requirements

The following CI jobs must exist and all pass as a hard gate on every merge to `main`:

```yaml
# Required CI jobs (GitHub Actions or equivalent)

1. type-check        — npx tsc --noEmit
2. lint              — npx eslint --max-warnings 0 src/
3. test:unit         — npx vitest run
4. test:calibration  — npx tsx scripts/calibrate.ts --check-fixtures
5. build             — npx vite build
```

**Notes:**
- `test:calibration` compares current pipeline output to stored fixtures and exits non-zero if any score delta exceeds 5% without a documented config change.
- AI tests use `MockAIProvider` exclusively; no live network calls in CI.
- Coverage thresholds enforced: `scoreEngine.ts` ≥80%, `seedAnalyzer.ts` ≥80%, `validateProposal.ts` 100%.

---

## Part 6 — Key New Files to Create

The following files do not yet exist and must be created before public release:

| File | Purpose |
|------|---------|
| `src/lib/ai/validateProposal.ts` | AI output legality + structure validation |
| `src/lib/ai/mock.ts` | `MockAIProvider` for deterministic CI tests |
| `src/lib/ai/prompts/analyzeDeck.ts` | Typed prompt template for deck analysis |
| `src/lib/ai/prompts/refineDeck.ts` | Typed prompt template for deck refinement |
| `src/lib/ai/telemetry.ts` | Structured logging for AI call outcomes |
| `src/lib/__tests__/scoreEngine.test.ts` | Unit tests for composite scoring |
| `src/lib/__tests__/seedAnalyzer.test.ts` | Unit tests for seed intent inference |
| `src/lib/__tests__/db.migration.test.ts` | Migration tests with `fake-indexeddb` |
| `src/lib/ai/__tests__/validateProposal.test.ts` | AI validation tests |
| `src/lib/ai/__tests__/aiGenerator.test.ts` | AI generator tests with mock provider |
| `src/test/fixtures/ai/valid-deck.json` | MockAI fixture: well-formed legal deck |
| `src/test/fixtures/ai/illegal-card.json` | MockAI fixture: nonexistent card name |
| `src/test/fixtures/ai/bad-count.json` | MockAI fixture: >4 copies non-basic |
| `src/test/fixtures/ai/truncated.json` | MockAI fixture: incomplete output |
| `src/test/fixtures/ai/empty.json` | MockAI fixture: empty response |
| `src/test/fixtures/ai/banned-card.json` | MockAI fixture: banned card included |
| `src/test/fixtures/ai/oversized-sideboard.json` | MockAI fixture: >15 sideboard cards |
| `src/test/fixtures/ai/malformed-json.json` | MockAI fixture: syntactically invalid JSON |
| `src/test/fixtures/calibration/pool-aggro.json` | Calibration fixture: aggro pool |
| `src/test/fixtures/calibration/pool-control.json` | Calibration fixture: control pool |
| `src/test/fixtures/calibration/pool-midrange.json` | Calibration fixture: midrange pool |
| `src/test/fixtures/calibration/pool-combo.json` | Calibration fixture: combo pool |
| `src/test/fixtures/calibration/pool-ramp.json` | Calibration fixture: ramp pool |
| `scripts/calibrate.ts` | Calibration harness script |
| `docs/DATABASE_SCHEMA.md` | Dexie schema version history |
| `docs/PWA_STRATEGY.md` | Cache strategy, update flow, offline UX |
| `docs/adr/001-offline-first-dexie.md` | ADR: Dexie over raw IDB |
| `docs/adr/002-zustand-state.md` | ADR: Zustand slice conventions |
| `docs/adr/003-ai-provider-abstraction.md` | ADR: Multi-provider AI interface |
| `docs/adr/004-log-compressed-synergy.md` | ADR: Synergy log compression rationale |
| `docs/adr/005-meta-adjustment-bounds.md` | ADR: ±30% meta adjustment caps |
| `CONTRIBUTING.md` | Dev setup, test commands, PR policy |

---

## Part 7 — Dependency Additions Required

| Package | Purpose | Install command |
|---------|---------|----------------|
| `fake-indexeddb` (devDep) | IndexedDB migration testing | `npm i -D fake-indexeddb` |
| `immer` (dep, if absent) | Zustand immutable updates | `npm i immer` |
| Error monitoring (Sentry or equivalent) | Production error tracking | `npm i @sentry/browser` |
| Analytics (Plausible or PostHog lightweight) | Usage analytics, privacy-respecting | Choose at launch time |

> **Note:** Check if `immer` is already in `package.json` before installing. Sentry and analytics should only be added in Phase 6 once privacy policy is finalized.

---

## Part 8 — Quick Reference: Release Blockers vs. Nice-to-Haves

### Absolute Blockers (cannot ship without)
- [ ] `validateAIProposal` + AI fallback to offline generator
- [ ] `scoreEngine.test.ts` and `seedAnalyzer.test.ts` with ≥80% coverage
- [ ] AI `MockAIProvider` + 8 fixture shapes in CI
- [ ] Chunked Scryfall import (memory-safe on 4GB device)
- [ ] DB schema documented in `db.ts` with upgrade handlers
- [ ] Synergy graph caching
- [ ] "Update available" PWA banner
- [ ] At least 3 of the 5 ADRs written
- [ ] RC-01 through RC-05 verified

### Should-Ship (strong recommendation)
- Calibration harness with stable fixtures
- All 5 ADRs
- CONTRIBUTING.md + README update
- Zustand store sliced
- Empty state components + onboarding screen
- Keyboard nav audit complete

### Post-Launch (can defer to v1.x)
- Generator worker (only needed if profiling confirms >100ms)
- Advanced synergy graph visualization
- Full Bo3 match tracker UX
- Pioneer / Explorer format support
- Prompt template externalization (nice to have but not blocking)

---

## Appendix A — Cross-Reference Map

| This Document Section | Source Document |
|-----------------------|-----------------|
| Risk R-01 (pipeline coupling) | ENGINEERING_ASSESSMENT §2.1 |
| Risk R-02 (AI validation) | ENGINEERING_ASSESSMENT §3.1; SYNERGY_CHAIN_AUDIT §Phase 2 findings |
| Risk R-04 (synergy graph) | ENGINEERING_ASSESSMENT §2.3 |
| Risk R-05 (bulk import) | ENGINEERING_ASSESSMENT §4.1 |
| Risk R-06 (schema versioning) | ENGINEERING_ASSESSMENT §4.3 |
| Risk R-07 (main thread) | ENGINEERING_ASSESSMENT §4.2 |
| Risk R-08 (Zustand) | ENGINEERING_ASSESSMENT §5.1 |
| Risk R-11 (config calibration) | ENGINEERING_ASSESSMENT §2.2 |
| AI fixture shapes | ENGINEERING_ASSESSMENT §3.2 |
| Stage interfaces diagram | ENGINEERING_ASSESSMENT §2.1 recommendation |
| Calibration harness | ENGINEERING_ASSESSMENT §2.2 recommendation |
| PWA lifecycle docs | ENGINEERING_ASSESSMENT §7.3 |
| ADR directory | ENGINEERING_ASSESSMENT §7.2 |
| Smoke test → executable harness | SEED_ANALYZE_SMOKE_TEST_PLAN.md |
| Mythic viability bar | SYNERGY_CHAIN_AUDIT introduction |

---

## Appendix B — Success Definition

This project is **ready to release publicly** when:

1. A mythic-level MTG player can install the PWA, import a Scryfall bulk data file, add 5–8 seed cards, click Analyze, and receive a legal, synergy-coherent 60/15 deck within 3 seconds, with or without AI enabled.
2. That same player can repeat the workflow 10 times across different seeds and archetypes with consistent, predictable results — no crashes, no illegal decks, no silent failures.
3. A developer making a change to `scoringConfig.ts` or `aiGenerator.ts` cannot ship that change to production without CI detecting any score regression or AI validation failure.
4. An operator getting paged at 2am can diagnose and roll back any production issue using documented playbooks without requiring author knowledge.
5. A first-time user with no context can become productive in under 3 minutes without reading external documentation.

When all six phases are complete and all 20 release criteria are checked, that definition is met.

---

_This document supersedes all previous informal launch plans. It should be treated as the authoritative V1 release specification. All new work should reference phase tasks or risk IDs from this document in commits and PRs._
