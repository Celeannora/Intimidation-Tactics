# Implementation Plan

[Overview]
Harden and improve the MTG deck-builder's synergy calculations and AI/API integration layer, prioritizing reliability, correctness, and token efficiency of the LLM pipeline.

The application is an offline-first React + Vite + TypeScript PWA that generates Magic: The Gathering decks. It combines a deterministic offline scoring engine (pool building, weighted card scoring, mana-base heuristics, synergy axis tagging) with an optional LLM "feed" that proposes a nonland deck spine which is then re-scored through the offline pipeline. Investigation surfaced two clusters of weaknesses. In the AI/API layer: no structured-output schema enforcement (reliance on prompt-only "return strict JSON" plus a regex salvage fallback), no retry/backoff on transient provider failures (a single 429/network error aborts a pass), weak card-name resolution (exact/prefix/substring only — one-character LLM typos silently drop cards), an unused `feasibilityChecker` module that could pre-validate AI picks, hardcoded token/timeout limits, and quadratic transcript growth in sequential mode because the full ~220-card digest is resent every step. In the synergy layer: the seed synergy graph is seed-only, has unweighted binary edges, is never consulted by the generator/optimizer, and axis-tagging logic is duplicated across `synergyModel.ts`, `seedAnalyzer.ts`, and `synergyGraph.ts` with hand-tuned magic numbers and no golden-fixture calibration.

The approach is to make focused, well-tested, backwards-compatible changes: introduce shared retry/backoff and structured-output helpers in the provider layer, adopt each provider's native structured-output mechanism (OpenAI `json_schema`, Ollama `format` JSON schema, llama.cpp guarded `json_schema`), add a Levenshtein-based fuzzy fallback to name resolution with a safe confidence threshold, wire the existing `feasibilityChecker` into the AI result pipeline as soft diagnostics, add weighted-edge scoring to the synergy graph, and reduce sequential-mode token cost with a delta digest. All changes preserve existing public function signatures and the strict JSON response shape so the extensive existing test suite continues to pass.

[Types]
Add configuration and structured-output types to the AI layer plus weighted-edge fields to the synergy graph; no breaking changes to existing exported types.

- `src/lib/ai/provider.ts`
  - Extend `AIGenerationRequest` with two optional fields:
    - `jsonSchema?: AIJsonSchema` — optional structured-output schema for providers that support it.
    - `retry?: RetryOptions` — optional per-request retry override.
  - New exported interface `AIJsonSchema { name: string; schema: Record<string, unknown>; strict?: boolean }`.
  - New exported interface `RetryOptions { maxAttempts?: number; baseDelayMs?: number; maxDelayMs?: number; jitter?: boolean }` (defaults: `maxAttempts=3`, `baseDelayMs=600`, `maxDelayMs=8000`, `jitter=true`).
  - Extend `AISettings` with optional `maxTokens?: number` and `requestTimeoutMs?: number` so the UI-configured limits replace the hardcoded `8000`/`120_000` when present. All new fields optional; `DEFAULT_SETTINGS` unchanged in shape.
- `src/lib/ai/retry.ts` (new)
  - `RetryableErrorClassifier = (err: unknown) => boolean`.
- `src/lib/ai/deckSchema.ts` (new)
  - `DECK_JSON_SCHEMA: AIJsonSchema` — the canonical `{summary, game_plan, main[], side[]}` schema object reused by all providers.
- `src/lib/analysis/synergyGraph.ts`
  - Add `weight: number` (0–1) to `SynergyGraphEdge`.
  - Add `weightedDensity: number` to `SeedSynergyGraph` (sum of edge weights / possible directed edges).
- `src/lib/ai/resolver.ts`
  - Extend `ResolvedDeckLine` with optional `matchKind?: "exact" | "prefix" | "substring" | "fuzzy"` and `matchDistance?: number` for diagnostics (optional; existing consumers unaffected).

[Files]
Create four new files and modify seven existing files; no deletions.

New files:
- `src/lib/ai/retry.ts` — generic async retry with exponential backoff + jitter and a default retryable-error classifier (network errors, HTTP 408/429/500/502/503/504; never retries `AbortError`).
- `src/lib/ai/deckSchema.ts` — exports `DECK_JSON_SCHEMA` (shared JSON schema describing the deck response shape).
- `src/lib/ai/__tests__/retry.test.ts` — unit tests for backoff, max attempts, abort passthrough, classifier.
- `src/lib/ai/__tests__/resolver.test.ts` — unit tests for fuzzy resolution (typo tolerance, threshold rejection, DFC handling, ambiguity safety).

Modified files:
- `src/lib/ai/provider.ts` — add new optional request/settings/schema types described in [Types]; keep `withTimeoutSignal` unchanged.
- `src/lib/ai/openai.ts` — use `response_format: { type: "json_schema", json_schema: DECK_JSON_SCHEMA }` when a schema is present (fallback to `json_object`); wrap `generate`/`generateStream` fetches in `withRetry`.
- `src/lib/ai/ollama.ts` — pass `format: <schema>` (Ollama structured outputs) when a schema is present; wrap in `withRetry`.
- `src/lib/ai/llamacpp.ts` — optionally send `response_format: json_schema` gated behind a settings flag (keep current safe default of NOT sending it to avoid model hangs); wrap in `withRetry`.
- `src/lib/ai/resolver.ts` — add Damerau-Levenshtein fuzzy fallback with a normalized distance threshold and ambiguity guard; annotate `matchKind`.
- `src/lib/ai/aiGenerator.ts` — thread `jsonSchema` into requests via `DECK_JSON_SCHEMA`; wire `checkFeasibility` into `buildResultFromAIResponse` as soft diagnostics appended to `reasoning`; add delta-digest support for sequential mode; respect `AISettings.maxTokens`/`requestTimeoutMs` if provided (via config).
- `src/lib/analysis/synergyGraph.ts` — compute per-edge `weight` and `weightedDensity`; surface weights in `formatSynergyGraphForPrompt` and `SynergyConstraints`.

Configuration: none of `package.json`, `tsconfig.json`, or build config change (no new runtime dependencies; fuzzy matching and retry are implemented in-repo).

[Functions]
Add new helper functions and extend a small number of existing ones without changing their external contracts.

New functions:
- `withRetry<T>(fn: (attempt: number) => Promise<T>, opts?: RetryOptions, isRetryable?: RetryableErrorClassifier): Promise<T>` in `src/lib/ai/retry.ts` — runs `fn`, retrying retryable failures with exponential backoff + optional jitter; rethrows immediately on `AbortError`/`TimeoutError` and after exhausting attempts.
- `defaultIsRetryable(err: unknown): boolean` in `src/lib/ai/retry.ts`.
- `damerauLevenshtein(a: string, b: string): number` (private) in `src/lib/ai/resolver.ts`.
- `resolveCardNameFuzzy(norm: string, allCards: CardRecord[]): { card: CardRecord; distance: number } | null` (private) in `src/lib/ai/resolver.ts`.
- `edgeWeight(kind: SynergyEdgeKind, axis: MechanicAxis): number` (private) in `src/lib/analysis/synergyGraph.ts` — assigns `mutual-engine=1.0`, `source-to-payoff=0.8`, `shared-axis=0.4`.
- `buildDeltaDigest(...)` (private) in `src/lib/ai/aiGenerator.ts` — for sequential steps ≥2, emit only newly-locked spine cards + top-N re-scored candidates instead of the full digest.

Modified functions:
- `resolveCardName(name, allCards)` in `src/lib/ai/resolver.ts` — append fuzzy fallback after the substring pass; only accept a fuzzy match when normalized distance ≤ threshold (e.g. ≤ 2 absolute and ≤ 0.2 relative to name length) AND the best match is unambiguously better than the second-best.
- `resolveLines(...)` — annotate results with `matchKind`.
- `OpenAIProvider.generate/generateStream`, `OllamaProvider.generate/generateStream`, `LlamaCppProvider.generate/generateStream` — accept the new schema/retry fields and wrap network calls in `withRetry`.
- `buildResultFromAIResponse(...)` in `src/lib/ai/aiGenerator.ts` — after computing final `entries`, call `checkFeasibility` on the mainboard and push soft violation summaries into `reasoning` (no rejection loop change; purely additive diagnostics).
- `generateDeckAI` / `generateDeckAISequential` / `refineDeckAI` — build requests with `jsonSchema: DECK_JSON_SCHEMA`; sequential steps ≥2 use `buildDeltaDigest`.
- `buildSeedSynergyGraph` / `formatSynergyGraphForPrompt` / `buildSynergyConstraints` in `src/lib/analysis/synergyGraph.ts` — populate and render edge weights and `weightedDensity`.

Removed functions: none.

[Classes]
Modify the three provider classes; no new or removed classes.

- `OpenAIProvider` (`src/lib/ai/openai.ts`) — request body conditionally uses `json_schema`; both methods wrapped in `withRetry`.
- `OllamaProvider` (`src/lib/ai/ollama.ts`) — request body uses schema-based `format`; both methods wrapped in `withRetry`.
- `LlamaCppProvider` (`src/lib/ai/llamacpp.ts`) — optional schema gated by settings; both methods wrapped in `withRetry`; existing stream-abort guidance preserved.

[Dependencies]
No new packages are introduced.

Damerau-Levenshtein and retry/backoff are implemented in-repo to keep the offline-first PWA dependency-free. Structured outputs use each provider's native HTTP fields, requiring no client libraries.

[Testing]
Add focused unit tests and re-run the full existing suite to guard against regressions.

- New: `src/lib/ai/__tests__/retry.test.ts` — verifies success-after-transient-failure, max-attempts exhaustion, no-retry on `AbortError`, and classifier behavior for HTTP status codes.
- New: `src/lib/ai/__tests__/resolver.test.ts` — verifies exact/prefix/substring precedence unchanged, single-typo fuzzy recovery, over-threshold rejection, ambiguous-match rejection, and DFC front-face handling.
- Extend `src/lib/ai/__tests__/aiGenerator.test.ts` — assert feasibility diagnostics appear in reasoning for an obviously-infeasible AI proposal, and that `DECK_JSON_SCHEMA` shape matches parser expectations.
- Add `src/lib/analysis/__tests__/synergyGraph.test.ts` (or extend existing) — assert edge weights and `weightedDensity` are computed and that `formatSynergyGraphForPrompt` includes weight info.
- Validation commands: `npm run typecheck`, `npm run test`, `npm run lint` (must pass with `--max-warnings 0`).

[Implementation Order]
Implement bottom-up so each layer's tests pass before the layer that depends on it.

1. Create `src/lib/ai/retry.ts` and its tests; run the retry tests.
2. Create `src/lib/ai/deckSchema.ts` (shared schema constant).
3. Extend types in `src/lib/ai/provider.ts` (request/settings/schema fields).
4. Update `openai.ts`, `ollama.ts`, `llamacpp.ts` to use `withRetry` and structured output.
5. Add fuzzy resolution to `resolver.ts` and its tests; run resolver tests.
6. Wire `DECK_JSON_SCHEMA` + `checkFeasibility` into `aiGenerator.ts`; extend aiGenerator tests.
7. Add delta digest for sequential mode in `aiGenerator.ts`.
8. Add weighted edges + `weightedDensity` to `synergyGraph.ts` and update prompt/constraint rendering; add/extend synergyGraph tests.
9. Run `npm run typecheck`, `npm run test`, and `npm run lint`; fix any regressions.
