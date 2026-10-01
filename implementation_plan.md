# Offline Deck Generator, Synergy Pipeline, and Tooling Improvement Plan

## Overview

Improve the offline-first deck generator as a coherent, deterministic, testable pipeline. Prioritize deck correctness and legality; make synergy signals robust and useful to selection; validate inputs at CLI boundaries; and provide reproducible playtest and calibration evidence. Preserve the existing React + Vite + TypeScript architecture, exported API compatibility where practical, and dependency-free offline operation. No new packages are planned.

The generator already has identifiable pool, role-fill, mana-base, optimizer, sideboard, and result-assembly stages, as well as role scoring, synergy constraints, scenario metrics, legality rules, and simulator utilities. The improvements should build on those facilities rather than introduce a parallel engine or hard-code card/deck-specific behavior.

## Goals and non-goals

### Goals

- Produce the requested mainboard size and a format-appropriate sideboard whenever the available pool permits it.
- Report final legality and structural/synergy problems explicitly instead of silently presenting an invalid build as valid.
- Make offline generation and all simulation/calibration runs reproducible from recorded seeds.
- Validate CLI arguments, card pools, seed lists, and decklists before work begins; fail clearly on malformed required inputs.
- Ensure optimizer scoring and replacement decisions use consistent canonical role and scoring semantics.
- Make synergy analysis resilient to malformed card metadata and useful in candidate selection and diagnostics.
- Add focused tests, a deterministic evaluation corpus, and runnable calibration/playtest workflows.

### Non-goals

- Reworking AI providers or adding a remote service to the offline path.
- Introducing external dependencies, card-name-specific special cases, or hidden network I/O in generation.
- Claiming win-rate prediction from heuristic scores or fixtures that lack provenance and real match data.
- Splitting the generator into a new architecture before its contracts and correctness are established.

## Implementation sequence

### 1. Establish baseline behavior and pipeline contracts

- Review the existing public generator APIs, `GeneratorStage` contracts, stage-order assertion, legality API, current tests, and script conventions before edits.
- Add or extend contract tests to make stage order, option defaults, copy-count handling, and entry board labels explicit.
- Record baseline `npm run typecheck`, `npm run lint`, and full test results; distinguish existing failures/timeouts from regressions.
- Keep all working changes scoped to the offline generator, relevant synergy utilities, and the named CLI/evaluation scripts.

### 2. Generator correctness, input and final-result validation

- Validate numeric generation options at the generator boundary: mainboard sizes, optimizer iteration counts, variant counts, and any newly introduced random seed. Reject non-finite, out-of-range, and unsafe values with actionable errors; preserve documented defaults.
- Review seed, focus, and preferred-entry quantities, format legality, color identity, duplicate oracle IDs, and copy limits before they can produce invalid intermediate state. Where current seed policies intentionally relax a rule, represent the exception explicitly and report it.
- Run the existing `validateDeck` against the final assembled result using the selected format. Attach a structured validation report to generation results and explain each violation in diagnostics; do not relabel a failed validation as a legal deck.
- Retain synergy-constraint and Rule-of-Nine warnings as diagnostics, but distinguish advisory strategy feedback from hard format-legality failures.
- Add regression tests for short/oversized lists, copy-limit violations, illegal-format cards, invalid seeds, empty pools, out-of-identity cards, and builds that cannot satisfy targets.

### 3. Reproducibility and seeded offline generation

- Add an optional, documented `randomSeed` to offline generation options while retaining the existing default sequence when callers omit it.
- Derive each variant seed deterministically from the base seed; expose the actual seed in each result for reproductions and reports.
- Thread the same seed contract to the seed-build CLI, playtest CLI, goldfish trials, and any sampling in calibration. Repeated runs with identical inputs and seeds must produce identical entries, scores, and simulation summaries.
- Ensure there is no unseeded `Math.random`, time-based PRNG, or iteration-order dependency in generator-critical or evaluation-critical paths. Keep intentionally nondeterministic UI identifiers out of this rule.
- Add tests that assert same-seed equality, different-seed variation where stochastic choices exist, stable variant derivation, and invalid-seed rejection.

### 4. Optimizer objective, correctness, and efficiency

- Inspect the optimizer’s simulated-annealing acceptance path. Track the current accepted score independently from the global best score; compute candidate deltas against the current state, update the global best only on improvement, and always return the best-scoring deck encountered.
- Report the number of iterations actually executed, including early exits, rather than the requested budget when no work was performed.
- Precompute repeated candidate ranks/role assignments where safe; avoid recomputing constant card-level values for every sort comparison.
- Base optimizer role buckets on the shared `assignRoles` / threat semantics, retaining the dedicated support bucket for synergy glue. Avoid a second divergent card-role classifier.
- Add tests for accepted downhill annealing moves followed by subsequent decisions, best-state preservation, zero iterations, no swappable cards, locked entries, dual-role replacements, and deterministic RNG consumption.
- Profile representative pools before tuning iterations, bucket sizes, or score weights. Treat any speed optimization as valid only if selected decks and score ordering remain covered by tests.

### 5. Synergy pipeline resilience and measurable integration

- Audit parsing and regular-expression scans in role assignment, synergy profiles, constraints, seed analysis, and graph construction. Treat missing, malformed, or wrong-shaped serialized keywords/identities as empty typed data rather than crashing generation.
- Normalize shared Oracle-text/keyword inputs once per candidate where practical; keep role/synergy pattern semantics centralized or covered by agreement tests to prevent classifier drift.
- Review synergy-pair validation for board filtering, duplicate printings/oracle identities, quantities, and archetype applicability. Mainboard sources/payoffs must not be accidentally satisfied by sideboard cards.
- Use the existing graph, directional scoring, and seed-synergy context only where their meanings are defined. Add a bounded, explainable optimizer signal for verified multi-card links only if tests establish that it improves complete-package selection without overpowering role, curve, mana, and legality objectives.
- Do not treat shared tags or a seed-only relationship as proof of a functioning combo. Surface source, payoff, edge kind/confidence, and missing-support details in diagnostics where available.
- Add robustness tests for malformed JSON, empty profiles, no-op constraints, cross-board contamination, ambiguous source/payoff matches, multiple printings sharing an Oracle ID, and generic non-fixture seed packages.
- Preserve existing golden corpus behavior unless a changed result is justified by a documented correctness defect and a reviewed expected-output update.

### 6. Mana base, sideboard, and format-aware behavior

- Verify land budgets against nonland card count, selected identity, pip demands, tapped/fixing lands, and seed lands. Preserve the existing role and land-floor guards; diagnose infeasible targets instead of silently padding into a broken deck.
- Confirm every supported constructed format’s sideboard rules are respected: formats with no sideboard produce none; formats with sideboards use their configured size rather than a duplicated Standard-only constant.
- Enforce combined mainboard-plus-sideboard copy limits, format legality, color identity, and exclusion of mainboard cards from the sideboard.
- Keep sideboard entries on the canonical `DeckEntry.board` label and add tests for the CLI’s output filtering so sideboard quantities are not omitted.
- Exercise empty/small pools and pools with fewer than the target number of legal, unique sideboard candidates. Report a shortfall instead of manufacturing cards or violating limits.

### 7. CLI robustness for deck building and playtesting

- Extract argument parsing and data validation into testable pure functions; importing a script in tests must not execute its CLI entrypoint.
- Reject missing flag values, unknown archetypes/colors/formats, malformed JSON, invalid quantities, duplicate seed lines or deck entries where the format requires consolidation, and invalid numerical settings with nonzero exit status and concise messages.
- Resolve seed names using the project’s canonical card representation, including appropriate double-faced-card handling; never silently ignore unresolved seed lines.
- Make pool loading distinguish optional files from required files: warn for intentionally optional absent files, but fail if no usable pool loads or a required file is malformed. Print loaded-card counts and sources.
- Use platform-neutral paths and sensible defaults; avoid machine-specific absolute pool paths.
- Preserve mana cost and produced-mana metadata in generated output where the hand simulator can use it. Validate that playtest input includes enough fields and a valid constructed mainboard size before allocating trials.
- Expose `--trials`, `--seed-rng`, and relevant simulation settings; cap unreasonable trial counts and echo seed/settings in the result JSON.
- Report requested goldfish targets that cannot be resolved instead of silently filtering them out. Match names case-insensitively while returning canonical card names.
- Add CLI smoke tests for help/required options, bad JSON, missing files, invalid values, absent seed cards, short decks, and successful deterministic end-to-end output.

### 8. Calibration and offline generator evaluation

- Replace the copied/legacy calibration calculation with a TypeScript harness that imports the production scorer. Avoid maintaining duplicated constants, weights, and formula replicas that drift from the application.
- Validate the known-deck fixture schema, archetypes, tiers, quantities, deck sizes, identities, and presence of examples for requested summaries. Fail with the fixture row and field when malformed.
- Explicitly identify fixture limitations (age, format, missing Oracle text/card legality/source provenance, aggregate roles) and do not emit synthetic win-rate estimates or claim predictive validity from a hand-authored tier list.
- Add a versioned generic seed-case corpus backed by checked-in card-pool fixtures, with source and provenance documented. Cover multiple archetypes/color identities without encoding a named featured deck as a special case.
- Evaluate deterministic build properties: format legality, deck size, copy counts, seed preservation, mana coverage, curve, optimizer changes, and synergy/role diagnostics. Report per-case results and summary statistics in stable machine-readable and human-readable formats.
- Keep expensive repeated full-pool generations out of normal unit tests. Use small synthetic pools for fast focused cases and a documented, bounded integration/evaluation command for full corpus runs.
- Add a calibration/golden-metric comparison that detects large unintended score changes without auto-adjusting production weights. Weight proposals, if later added, must be labeled suggestions and backed by a holdout dataset.

### 9. Verification and acceptance criteria

- `npm run typecheck` and `npm run lint` pass with the repository’s strict settings and no new warnings.
- All focused generator, optimizer, legality, synergy, CLI, playtest, and calibration tests pass.
- The complete test suite passes under the documented runner settings; any existing timeout is separately reproduced, reported, and not hidden by a global timeout increase.
- Repeated offline builds and simulations with identical seed/input are bit-for-bit stable for deck entries and numerical summaries.
- Final generated decks include an explicit validation result, and no automated path reports an invalid list as legal.
- The sideboard is canonical, format-aware, correctly sized when possible, and never exceeds shared copy or legality rules.
- Script tests can import helpers without triggering filesystem output or process termination.
- `npm run build` succeeds; any existing bundle-size warning is reported separately from correctness failures.
- `git diff --check` is clean and no new dependency is introduced.

## Suggested implementation order

1. Baseline/contract tests and edge-case fixtures.
2. Boundary validation, final legality report, and sideboard board-label/copy-limit correctness.
3. Seeded generator/playtest randomness and reproducibility assertions.
4. Optimizer current-vs-best objective correction and canonical role mapping.
5. Synergy parser resilience and focused cross-board/golden tests.
6. Testable CLI parsing and script output correctness.
7. Production-scorer calibration plus bounded offline evaluation corpus.
8. Profile, review regressions, run complete verification, and document known limitations.

## Change management

Implement one coherent step at a time and run focused tests before proceeding. Avoid broad coefficient tuning while correctness changes are in flight. Record behavior changes in tests and release notes, retain backwards-compatible defaults, and stop to revise this plan if the existing public APIs or fixture provenance contradict an assumption above.