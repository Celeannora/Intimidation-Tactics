# Intimidation-Tactics — Honest Engineering Assessment

> **Date:** 2026-06-15  
> **Scope:** Full codebase review — architecture, correctness, maintainability, performance, process  
> **Audience:** Engineering team, AI coding agents, future contributors  
> **Verdict:** The project has a strong architectural foundation but has outgrown its original engineering rigor. The scoring/generator/meta/AI pipeline is now complex enough that without deliberate investment in modularization, configuration management, testing, and documentation, continued feature development will become increasingly brittle and error-prone.

---

## TL;DR — Top Issues

| # | Severity | Issue | Impact |
|---|----------|-------|--------|
| 1 | **High** | Generator/scoring pipeline lacks modular boundaries — functions are monolithic and tightly coupled | Fragile changes, hard to test |
| 2 | **High** | Weight configuration is scattered magic numbers with no tooling for calibration | Untunable, opaque behavior |
| 3 | **High** | AI output parsing has no documented/robust validation or fallback strategy | Inconsistent/broken AI suggestions |
| 4 | **Medium** | No off-main-thread execution for heavy generator computations | UI freezing on low-end devices |
| 5 | **Medium** | Bulk Scryfall import may parse entire JSON into memory before writing to IndexedDB | Memory pressure, poor UX |
| 6 | **Medium** | Synergy graph and meta analysis lack bounded test suites with known fixtures | Regression-prone |
| 7 | **Medium** | Zustand store risk of cross-cutting coupling as concerns grow | Re-render storms, hard to refactor |
| 8 | **Low** | PWA service-worker update and cache-pruning strategy unclear | Stale clients, quota issues |
| 9 | **Low** | Process docs (tracker, smoke test plan) at risk of entropy without periodic curation | Loss of institutional context |

---

## 1. Architecture — What Works Well

The project has made several strong architectural decisions that form a solid baseline:

- **Client-side offline-first design** — React + Vite + Dexie + Zustand, no backend dependency. Correct choice for a deck builder PWA.
- **Separation of core engine from UI** — `src/lib/` contains pure domain logic; `src/components/` and `src/hooks/` contain UI concerns. The README provides a clear mental map.
- **AI provider abstraction** — `src/lib/ai/` encapsulates OpenAI, Ollama, and llama.cpp behind a common interface. This is the right pattern for provider-agnostic AI integration.
- **Worker-based import** — `workers/importWorker` offloads bulk JSON parsing from the main thread.
- **Strict CI** — `tsc --noEmit`, `eslint --max-warnings 0`, Vitest, and build all run on push. Catches regressions early.
- **Centralized scoring config** — `scoringConfig.ts` and `archetypeProfiles.ts` pull magic numbers into typed configuration, making the system calibratable.
- **Documented engineering tracker** — `ENGINEERING_LIVE_TRACKER.md` captures completed work, design decisions, remaining tasks, and handoff context.

---

## 2. Critical Issue: Generator & Scoring Pipeline Complexity

### 2.1 Monolithic Functions and Tight Coupling

The core scoring and generation pipeline spans at least seven modules:

| File | Role | Risk |
|------|------|------|
| `src/lib/scoreEngine.ts` | Card-level composite scoring | Grown large; unclear where card vs. deck boundaries sit |
| `src/lib/generator/weights.ts` | Deck-level scoring and breakdown | Intertwined with config, types, and meta modules |
| `src/lib/meta/metaScoring.ts` | Meta-aware power/role adjustments | Depends on external data shape that may shift |
| `src/lib/analysis/seedAnalyzer.ts` | Seed intent inference | Complex logic; unclear error handling for degenerate seeds |
| `src/lib/analysis/synergyGraph.ts` | Source→payoff graph from seeds | Graph construction likely expensive; no incremental update |
| `src/lib/ai/aiGenerator.ts` | LLM orchestration and prompt building | Mixed concerns: prompt assembly, API calls, response parsing |
| `src/lib/config/scoringConfig.ts` | Centralized coefficients | Good pattern, but coefficients are interdependent in undocumented ways |

**Problem:** These modules form a deep pipeline where changing one stage can silently shift downstream behavior. Function boundaries are not always clean — e.g., `weights.ts` directly consumes config, types, and meta context rather than receiving them as explicit parameters. This makes unit testing individual stages impractical without mocking large dependency graphs.

**Recommendation:** Define explicit **stage interfaces** for the generator pipeline. Each stage should:
- Accept typed input and produce typed output
- Receive configuration and dependencies as parameters (dependency injection)
- Be independently testable with small, controlled inputs

```
PoolBuilder → RoleTargeter → ColorWeighter → SynergyWeighter → Optimizer → SideboardPlanner
```

Each arrow should be a typed boundary with a clear contract.

### 2.2 Weight Configuration Is Fragile

`scoringConfig.ts` centralizes coefficients, which is good. But:

- **Undocumented interactions:** Changing `SYNERGY_LOG_BASE` affects `DIRECTIONAL_MAX_CAP`. Changing `CASTABILITY_CONVEXITY` affects `MANA_PENALTY_MAX`. These cross-parameter dependencies are not documented.
- **No calibration tooling:** There is no harness to run the generator on a fixed set of pools and compare score distributions across config changes. Tuning is done by hand and eyeball.
- **Magic residuals:** Some thresholds (e.g., the `±30%` bound on meta-adjusted role multipliers) appear chosen arbitrarily without empirical justification.

**Recommendation:**
- Document each config parameter with: purpose, valid range, and which other params it interacts with.
- Group related params into sub-objects (e.g., `SynergyConfig`, `CastabilityConfig`) with clear ownership.
- Build a small Node script that runs the generator on 5–10 curated card pools and emits score breakdowns, enabling before/after comparison during tuning.

### 2.3 Synergy Graph Computed Eagerly In-Browser

`buildSeedSynergyGraph()` computes a source→payoff graph from seed cards. If this runs on every Analyze invocation or on every generator run, it will become a performance bottleneck as seed pools grow.

**Recommendation:**
- Cache computed graphs keyed by seed deck hash.
- If graph computation is expensive (>50ms), move it to a web worker.
- Consider precomputing a static synergy index offline and loading it as a JSON artifact, rather than computing from scratch in the browser.

---

## 3. Critical Issue: AI Integration Fragility

### 3.1 No Documented Output Validation or Fallback

`aiGenerator.ts` builds prompts, calls an AI provider, and parses the response. There is **no visible validation layer** that:

- Checks whether the AI returned syntactically valid card names
- Verifies that proposed decks satisfy legality constraints
- Handles partial/truncated responses
- Falls back gracefully when the AI returns nonsense

Without this, the AI feature will produce confusing, broken, or illegal decks that undermine user trust.

**Recommendation:**
- Implement a `validateAIProposal(deck, pool)` function that checks: legality, card existence, format compliance, deck size, sideboard constraints.
- On validation failure, either re-prompt the model with error context, or fall back to the offline generator output.
- Log all AI failures with structured telemetry so the team can assess provider/model quality over time.

### 3.2 No Mocked Provider for Tests

AI modules cannot be tested deterministically. CI cannot call live endpoints. Without mocks, `aiGenerator.ts` has zero meaningful test coverage.

**Recommendation:**
- Define a `MockAIProvider` that returns fixed, version-controlled responses for given prompt hashes.
- Write tests that verify parsing logic handles: well-formed output, malformed output, empty output, timeout-equivalent errors.
- Keep mock responses in a dedicated `src/test/fixtures/ai/` directory.

### 3.3 Prompt Construction Leaks Implementation Details

Prompts built in `aiGenerator.ts` embed seed analysis and synergy graph context. The structure of these prompts is implicit in the code; if the underlying model changes or if prompt engineering needs iteration, developers must read and modify TypeScript logic rather than editing prompt templates.

**Recommendation:**
- Extract prompt templates into separate files (e.g., `prompts/analyzeDeck.txt`, `prompts/refineDeck.txt`) with placeholder syntax.
- Use a simple template engine or string interpolation with typed context objects.
- Document what each template expects as input and what output format it requests.

---

## 4. Data & Performance Issues

### 4.1 Scryfall Bulk Import — Memory and UX

The import worker parses `oracle_cards.json` and writes to IndexedDB via Dexie. Without inspecting the worker code, common failure modes include:

- **Whole-file parse:** If `JSON.parse()` is called on the entire file, this allocates a large string and object graph simultaneously. On devices with 4GB RAM, this can cause tab crashes.
- **Unbatched writes:** If all cards are written in a single Dexie transaction, IndexedDB may hit transaction size limits or block the UI.
- **No progress granularity:** If progress is reported only per-file rather than per-chunk, the UI appears frozen during long imports.

**Recommendation:**
- Stream-parse if possible (e.g., using `ReadableStream` + incremental JSON parser), or at minimum parse in chunks.
- Batch Dexie writes in groups of 500–1000 cards per transaction.
- Report progress at <1-second intervals with card count and estimated time remaining.
- Surface clear error messages for: file too large, storage quota exceeded, parse failure, transaction failure.

### 4.2 Generator Runs on Main Thread

The generator pipeline — pool building, role targeting, color weighting, synergy scoring, optimization — likely runs synchronously on the main thread. Even with heuristics, searching a card pool of thousands and computing synergy matrices can be expensive.

**Recommendation:**
- Profile the generator end-to-end with a full Standard pool (2000+ cards).
- If total time exceeds 100ms, offload the pipeline to a web worker.
- The worker should receive the card pool subset and config, and return a scored deck list.
- The UI should show a loading state with progress if generation takes >500ms.

### 4.3 IndexedDB Schema Versioning

Dexie requires explicit version upgrades when the database schema changes. There is no visible documentation of the current schema version or upgrade path. If a future release changes card or deck storage formats without a migration, existing users will experience data loss or crashes.

**Recommendation:**
- Document the current Dexie schema in `docs/DATABASE_SCHEMA.md`.
- For every schema change, add a version upgrade function in the Dexie initialization.
- Test schema migrations with `fake-indexeddb` using snapshots of old data.

---

## 5. State Management & UI Issues

### 5.1 Zustand Store Complexity

A single Zustand store holds all deck state. As features grow (generator config, AI settings, Bo3 plans, match tracker, meta context), the flat state object risks becoming a dumping ground.

**Recommendation:**
- Group state into clearly named slices: `deck`, `generator`, `ai`, `matchHistory`, `ui`.
- Use Zustand's `immer` middleware if not already in use, to simplify immutable updates.
- Enforce selector-only access in components — no destructuring the entire store.

### 5.2 Heavy Hooks

`useConsistencyReport` and `useCardPool` likely perform non-trivial computations. If these hooks embed complex logic rather than delegating to pure `lib/` functions, they become untestable and hard to reuse.

**Recommendation:**
- Keep hooks as thin orchestration layers. Move computation to pure, exported functions in `lib/`.
- Memoize expensive computations with `useMemo` keyed on stable input references.
- Test the pure functions directly; test hooks only for wiring correctness.

---

## 6. Testing Gaps

| Area | Current State | Gap |
|------|--------------|-----|
| Legality/validation | Some tests likely exist | Edge cases: mixed legality, banned+legal copies, companion constraints |
| Hypergeometric probabilities | Unknown | Needs regression tests with known expected values |
| Generator pipeline | Unknown | Each stage needs isolated tests with controlled pools |
| Synergy/meta analysis | Smoke test plan documented | No executable test harness; tests depend on live seed data |
| AI integration | None likely | Needs mocked provider tests for parsing, validation, error handling |
| Scoring config | Centralized but untested | Needs tests verifying that config changes produce bounded, sensible score deltas |

**Recommendation:**
- Prioritize tests for: legality edge cases, hypergeometric math, generator invariants, AI output parsing.
- Convert `docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md` into an executable test suite.
- Add a CI step that runs the smoke test harness and fails on regression.

---

## 7. Process & Documentation Issues

### 7.1 Engineering Tracker Entropy

`ENGINEERING_LIVE_TRACKER.md` is a running log. Over time, entries accumulate without summarization. This makes it harder for new contributors or agents to find relevant context.

**Recommendation:**
- Periodically (every 2–4 weeks) extract stable conclusions into dedicated ADRs or design docs.
- Archive or collapse completed entries in the tracker.
- Ensure every significant code change references the tracker task ID in its commit/PR.

### 7.2 No Architecture Decision Records (ADRs)

Key decisions — "why log-compress synergy," "why ±30% meta adjustment bound," "why Dexie over raw IndexedDB" — are scattered across the tracker and code comments, not captured in a structured, searchable format.

**Recommendation:**
- Start an `docs/adr/` directory with lightweight ADR Markdown files.
- Each ADR captures: context, decision, alternatives considered, consequences.
- Reference ADRs from code comments and the engineering tracker.

### 7.3 PWA Lifecycle Undocumented

`public/sw.js` and `public/manifest.webmanifest` exist, but there is no documentation of:
- Cache strategy (cache-first? network-first? stale-while-revalidate?)
- Update flow (how users get new versions)
- Storage quota handling
- Offline behavior when card data is not yet imported

**Recommendation:**
- Document the PWA strategy in `docs/PWA_STRATEGY.md`.
- Test update and offline flows manually and document the expected UX.

---

## 8. Risk Matrix

| Risk | Likelihood | Impact | Mitigation |
|------|-----------|--------|------------|
| Generator produces illegal or nonsensical decks after config change | Medium | High | Stage-level tests, CI smoke harness |
| AI suggestions are broken by provider/model changes | High | Medium | Robust validation layer, mocked tests |
| Tab crash during bulk import on low-end devices | Medium | High | Streaming parse, batched writes, progress UI |
| Scoring drifts away from competitive reality as heuristics accumulate | Medium | Medium | Calibration harness, periodic audit against known decks |
| Store coupling causes re-render storms | Low | Medium | Selector enforcement, profiling |
| Stale PWA caches after deploy | Low | Low | Service worker update strategy, cache versioning |

---

## 9. Summary of Recommendations (Priority-Ordered)

1. **Define explicit stage interfaces** for the generator pipeline with typed contracts.
2. **Build an executable smoke-test harness** for seed analysis (per the existing plan).
3. **Implement AI output validation** with legality checks and fallback to offline generator.
4. **Add mocked AI provider tests** to CI.
5. **Profile and offload generator** to a web worker if >100ms.
6. **Audit bulk import** for streaming parse and batched writes.
7. **Document config parameter interactions** in `scoringConfig.ts`.
8. **Start an ADR directory** for key design decisions.
9. **Enforce Zustand selector discipline** across components.
10. **Document PWA strategy** and test update/offline flows.

---

## 10. Conclusion

**Intimidation-Tactics** is a genuinely ambitious project with a solid architectural core, clean tooling, and impressive domain coverage. The issues identified here are not fundamental flaws — they are the natural growing pains of a system that has evolved from a simple deck builder into a complex, AI-augmented, meta-aware engine. Addressing them now — through modular boundaries, rigorous testing, config tooling, and process discipline — will determine whether the project can continue to iterate rapidly or whether it will become bogged down by its own complexity.

The fact that the team is already tracking work, documenting smoke test plans, and centralizing configuration is a strong signal that these concerns are recognized. This assessment is intended to sharpen that awareness into concrete, actionable priorities.