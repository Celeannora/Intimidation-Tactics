# Intimidation-Tactics Scoring Engine – Engineering Live Tracker (Handoff)

## 0. Document Purpose

This document is the orchestration-level handoff for further engineering work on the Intimidation-Tactics MTG deckbuilder. Its primary consumers are the engineering team and the DeepSeek coding model. It describes:

- The overarching goal of the current initiative
- Work already completed in this branch of the project
- Key design decisions and rationale
- Remaining workstreams, broken down into concrete tasks
- Risks, constraints, and "do not undo" directives
- Status tracking per task

The intention is that an engineer or AI coding agent can read this document and continue implementation without needing to reconstruct the entire context from scratch.

---

## 1. Task Goal

The goal is to evolve the deck scoring and generation engine from a strong heuristic baseline into a mythic-capable, meta-aware system that consistently produces competitive decks for constructed MTG formats.

More formally, the engine should:

1. Evaluate decks and cards using a multi-component objective that balances role-weighted raw power, synergy, mana reliability, curve fit, role coverage, synergy engine redundancy, and meta positioning.
2. Expose interpretable diagnostics so that both humans and LLMs can understand why a deck scores well or poorly.
3. Guide the generator and LLM orchestration toward decks that match the structural and probabilistic properties of mythic-level decks (reliable mana, tuned curves, robust interaction suites, strong engines) rather than just "reasonable" lists.
4. Be configurable and calibratable for different formats and environments, and maintainable by future contributors.

---

## 2. Work Completed So Far

### 2.1 Centralized Scoring Configuration

**File:** `src/lib/config/scoringConfig.ts`

- Introduced `ScoringProfile` abstraction (card, castability, deck, penalty, meta).
- Encapsulated all major numeric coefficients and thresholds.
- Defined format- and environment-aware profiles for Standard (Bo1 and Bo3) and Commander, with a default fallback profile.
- Rebalanced:
  - Directional synergy scaling: reduced base scalar, added log-compression, added hard cap.
  - Castability penalties: increased max penalty and made the penalty function convex in probability.
  - Deck-level multipliers: increased curve and mana penalties, added new multipliers for role profile loss, redundancy, and meta performance.

### 2.2 Archetype Role and Curve Profiles

**File:** `src/lib/config/archetypeProfiles.ts`

- Defined `RoleProfile` for each macro archetype (`Aggro`, `Tempo`, `Midrange`, `Control`, `Combo`, `Ramp`, `Prison`, `Unknown`).
- Each profile includes role bucket windows, CMC curve ranges per bin, and land count ranges.
- Implemented:
  - `rolesToBuckets(roles, cmc)` — maps `CardRole` to profile buckets.
  - `cmcToCurveBin(cmc)` — bins mana values into curve slots.
  - `computeProfileLoss(...)` — scalar loss for archetype profile deviation.
  - `computeRedundancyScore(axisProfiles)` — redundancy score (0–20).

### 2.3 Card-Level Scoring Rebalancing

**File:** `src/lib/scoreEngine.ts`

- Config-driven directional contribution with log-compression and hard cap.
- Config-driven castability penalty with convex growth (max 10 vs. prior 5).
- Config-driven role power linear cap and log slope.
- Composition bonus scaled by configurable scalar.
- New helper functions: `computeDirectionalContribution`, `computeCastabilityPenalty`.

### 2.4 Deck-Level Scoring Enhancements

**File:** `src/lib/generator/weights.ts`

- `cardScoreDetail` uses config for role power, directional, efficiency, flexibility, ladder contributions.
- `DeckScore` expanded with `profileLoss`, `redundancyScore`, `curvePenalty`, `manaPenalty`, `profilePenalty`, `redundancyContribution`.
- New helpers: `computeDeckRoleProfile`, `computeDeckRedundancy`.
- `deckScore` integrates cardScoreSum + redundancy contributions - all penalties.

### 2.5 Score Breakdown and Diagnostics

**File:** `src/lib/generator/types.ts`

- `ScoreBreakdown.totals` now includes `profilePenalty` and `redundancyContribution`.
- `buildScoreBreakdown` delegates to `deckScore` for deck-level metrics.

### 2.6 Meta-Aware Scoring Components

**File:** `src/lib/meta/metaScoring.ts`

- `MetaContext` interface with card-level and archetype-level meta statistics.
- `MetaStatsManager` class for loading and querying meta data.
- `computeMetaAdjustedPower(card, meta)` — adjusts power score by meta impact.
- `computeMetaAdjustedRole(card, archetype, meta)` — adjusts role multiplier by meta context.
- `computeMetaPerformance(entries, targets, meta)` — scores deck against target archetypes.

### 2.7 Seed Analyze Intent Workflow

**Files:** `src/lib/analysis/seedAnalyzer.ts`, `src/lib/analysis/synergyGraph.ts`, `src/lib/ai/aiGenerator.ts`, `docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md`

- Added `analyzeSeeds()` to infer color identity, macro archetype candidates, synergy axes, role counts, speed, spell ratio, confidence, and narrative from small seed pools.
- Added `buildSeedSynergyGraph()` to produce explainable source→payoff and shared-axis relationships between seed cards.
- Updated `buildAIPrompts()` so the LLM sees deterministic seed intent analysis and synergy graph context before proposing a nonland core.
- Documented the full “4 seed cards → Analyze → LLM plan → offline optimized deck → refinement loop” smoke test strategy and release criteria.
- Verified `npx tsc --noEmit` and `npm test` pass after integration.

---

## 3. Key Design Decisions and Rationale

1. **Purity and composability preserved:** The scoring pipeline remains pure and composable, with individual components clamped and log-shaped. This maintains interpretability and makes future calibration feasible.
2. **Synergy constrained:** Synergy is still first-class but brought into line with power and mana terms so it cannot dominate. This matches real-world priorities for mythic-level decks.
3. **Mana and curve enforced strongly:** Penalties are now config-driven and substantial, ensuring decks meet structural requirements.
4. **Role coverage and redundancy as first-class metrics:** These are essential for deck-level structural correctness that mimics mythic-competitive decks.
5. **Centralized configuration:** All coefficients live in `scoringConfig.ts`, making the system calibratable without code changes.
6. **Meta-awareness is modular:** Meta data is injected via a context object and integrated into power and role weights, not baked irreversibly into logic.

---

## 4. Task Tracking Table

| ID | Status | Area | Title | Description | Priority | Notes |
|----|--------|------|-------|------------|----------|-------|
| T1 | ✅ | Meta | Define MetaContext and meta data schema | `MetaContext` type, `CardMetaStats`, `ArchetypeMetaStats`, `MetaStatsManager` class, JSON loader | High | `src/lib/meta/metaScoring.ts` |
| T2 | ✅ | Meta | Integrate metaImpact into computePowerScore | `computeMetaAdjustedPower()` — adds bounded meta impact to power score | High | Uses `MetaContext` from T1 |
| T3 | ✅ | Meta | Meta-aware roleMultiplier adjustments | `computeMetaAdjustedRole()` — applies small multipliers for meta-valuable roles | High | Bounded to ±30% adjustment |
| T4 | ✅ | Meta | Operationalize metaTargets | `computeMetaPerformance()` — scores deck vs target archetypes using matchup proxies | High | Integrated into `DeckScore` |
| T5 | ✅ | LLM | Extend aiGenerator prompts with seed intent metrics | `aiGenerator.ts` now injects seed summary and synergy graph context into Analyze prompts | High | Still needs richer post-deck diagnostics in refinement loop |
| T6 | ⬜ | LLM | Refine LLM refinement loop | Multi-pass refinement with per-dimension focus (mana/curve → interaction → engine → meta) | High | Depends on T5 |
| T7 | ⬜ | LLM | Feasibility checks for LLM proposals | Validation layer rejecting decks that violate structural thresholds | Medium | Prevents reward hacking |
| T8 | 🚧 | Synergy | Pluggable co-occurrence synergy provider | Interface design and config scaffolding for data-driven synergy | Medium | Seed synergy graph implemented; data-driven provider still future work |
| T9 | ⬜ | Synergy | Prototype co-occurrence from deck corpus | Offline tool to build synergy index from decklists | Low | Deferred to next release |
| T10 | 🚧 | Eval | Build evaluation harness | Tool to run known decks through engine and compute calibration metrics | Medium | Smoke test plan documented in `docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md`; executable harness still pending |
| T11 | ⬜ | Eval | Calibrate scoring coefficients | Tune `scoringConfig.ts` using real deck data and regression | Medium | Depends on T10 |
| T12 | ⬜ | UX | Surface new diagnostics in UI | Update panels to display role coverage, redundancy, mana grade, meta performance | Medium | User-facing polish |
| T13 | ⬜ | Release | Expand tests and release checklist | Unit tests for new modules, integration smoke tests, release checklist | High | Pre-release requirement |

**Legend:** ✅ = Done | 🚧 = In Progress | ⬜ = Not Started | ⏸️ = Blocked

---

## 5. Constraints and "Do Not Undo" Notes

1. **Do not revert scoring configuration centralization.** All new coefficients and thresholds must continue to be defined in `scoringConfig.ts` or adjacent config modules.
2. **Do not reintroduce unchecked multiplicative synergy.** Directional synergy must remain log-compressed and capped.
3. **Do not relax mana/curve penalties.** These are intentional to avoid non-games and must remain strong.
4. **Do not remove role profile loss and redundancy metrics.** These are essential for deck-level structural correctness.
5. **When integrating meta data, avoid hard-coding.** Always route meta information through `MetaContext` and config-driven coefficients.
6. **Preserve backward compatibility of public APIs** where possible; deprecate rather than remove.

---

## 6. Next-Agent Instructions

1. Read this document fully and skim the key files: `scoringConfig.ts`, `archetypeProfiles.ts`, `scoreEngine.ts`, `generator/weights.ts`, `generator/types.ts`, `meta/metaScoring.ts`, `analysis/seedAnalyzer.ts`, `analysis/synergyGraph.ts`, and `docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md`.
2. Next focus should be the executable smoke-test harness for the seed Analyze workflow: fixture seeds, expected archetypes/axes, prompt snapshot checks, and final deck viability predicates.
3. Continue improving the LLM refinement loop (T6–T7) by feeding post-generation diagnostics back to the model: profile penalty, redundancy contribution, curve/mana failures, and original seed intent.
4. Build the evaluation harness and calibration scripts (T10–T11) in parallel.
5. Finalize UI surfacing (T12) for seed intent, synergy graph, role coverage, redundancy, mana grade, and meta performance.
6. Complete release hardening (T13) with tests and a release checklist.

**If multiple sessions or agents work on this project, update the task table above as tasks are started and completed.**

---

## 7. File Reference Map

| File | Purpose | Status |
|------|---------|--------|
| `src/lib/config/scoringConfig.ts` | Centralized scoring coefficients | ✅ Complete |
| `src/lib/config/archetypeProfiles.ts` | Archetype role/curve targets | ✅ Complete |
| `src/lib/scoreEngine.ts` | Card-level composite scoring | ✅ Rebalanced |
| `src/lib/generator/weights.ts` | Deck-level scoring and breakdown | ✅ Enhanced |
| `src/lib/generator/types.ts` | Type definitions for scoring | ✅ Updated |
| `src/lib/meta/metaScoring.ts` | Meta-aware scoring components | ✅ Complete |
| `src/lib/analysis/seedAnalyzer.ts` | Seed intent inference for Analyze workflow | ✅ Complete |
| `src/lib/analysis/synergyGraph.ts` | Explainable seed source→payoff graph | ✅ Complete |
| `src/lib/ai/aiGenerator.ts` | LLM orchestration | 🚧 Seed intent wired; refinement diagnostics remain |
| `src/lib/generator/generator.ts` | Offline deck generator | 🚧 Needs wiring |
| `docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md` | Seed Analyze smoke test plan and release criteria | ✅ Complete |
| `docs/ENGINEERING_LIVE_TRACKER.md` | This document | ✅ Complete |