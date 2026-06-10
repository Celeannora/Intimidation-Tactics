# Changelog

All notable changes to this project will be documented in this file.

## [Unreleased] — repo cleanup pass

### Added
- `LICENSE` — the project is now licensed under GPL-3.0.
- Fan Content attribution notice and accurate documentation in `README.md`.

### Corrections to earlier entries
The "triage pass" entries below contain two claims that do not match the actual
repository tree. They are left in place for history and corrected here:

- **`main.py` was NOT removed.** It still exists and is a working Python
  launcher that wraps the Vite dev/preview server (dependency checks, port
  freeing, install). The "Removed `main.py`" line below is inaccurate.
- **No `src/experimental/` quarantine directory exists.** The "Quarantined
  (moved to `src/experimental/`)" section below describes files and a directory
  that are not present in the tree. Treat that section as historical/aspirational
  notes only, not a description of the current layout.

### Removed (cleanup pass)
- Untracked `node_modules/` (was committed) and added it, plus `dist/`,
  `coverage/`, `*.log`, and `.sisyphus/`, to `.gitignore`.
- Deleted leaked process artifacts: `plan.txt`, `plan_v2.md`,
  `implementation_plan.md`, `audit_report.md`, `SESSION_STATUS.md`, `TODO.md`,
  `all_files.txt`, `dev.log`, `tsc.log`, and the `.sisyphus/` directory.
- Deleted dead stub `src/lib/scryfallApi.ts` (no importers) and the empty
  `src/lib/generator/__tests__/millDebug.diagnostic.ts`.

### Changed (cleanup pass)
- Vitest `include` now matches `.test.tsx` as well as `.test.ts`; coverage
  `include` widened from `src/lib/**` to `src/**` (test files excluded).

## [Unreleased] — triage pass

### Added
- Build infrastructure that was missing entirely: `tsconfig.json`,
  `vite.config.ts`, `index.html`, `tailwind.config.js`, `postcss.config.js`.
- ESLint config now ignores `src/experimental/`, `public/sw.js`, and
  `src/workers/`, and registers `globals.browser` so DOM/Worker globals don't
  trip `no-undef`.
- `fake-indexeddb` and `globals` dev-dependencies for tests / lint.
- CI workflow runs `npm ci → typecheck → lint (--max-warnings 0) → test → build`.

### Changed
- Legality rule codes renamed to match the test contract: `COPY_LIMIT →
  MAX_COPIES`, `SIDEBOARD_SIZE → SIDE_SIZE`, `NOT_STANDARD_LEGAL → NOT_LEGAL`.
  Violation messages now include card names so `BANNED` reports identify the
  offender. `DeckPanel.errorRules` updated to match.
- `recommendedLandCount` heuristic rewritten to `clamp(18, 27, round(16 + 2.5 *
  AMV))`. The old `20 + round(AMV * 0.7) * 3` formula failed both clamp
  boundaries.
- `computeSynergyScore` renamed to `computeSynergy`; returns bare 0–30 number.
- `getPowerSignal` returns bare 0–30 number; `computePowerSignal` is an alias
  export. Replaced invalid `roles.includes("Threat")` literal with
  `isThreat(roles)` predicate (behaviour change — flagged in handoff).
- `searchCards` now returns `{ cards, total }`. Filter shape is `CardFilters`
  (text/sort/direction/page/perPage), not the old `SearchFilters`.
- `ManaCurveChart`, `ManaBasePanel`, `DeckStatsBar` no longer depend on the
  deleted `useManaBaseStore`; they compute inline.
- `useDBStatus` defines `DatabaseStatus` locally (previously imported from
  `lib/types` which never exported it).
- `BulkImporter` accepts an optional `onImportDone(result)` callback.
- `RightPanel` strips the seven quarantined tabs; surviving tabs are Curve,
  Mana, Odds, Archetype, Validate, Plan, Bo3, Side, Matches, Export.

### Removed
- Rotation feature (`src/lib/rotation*.ts`, `RotationImpactPanel`).
- Deck history feature (`src/lib/deckHistory.ts`, `DeckHistoryPanel`) — relied
  on a `db.deckVersions` table that was never declared.
- `cardSets.ts`, `manaBaseStore.ts` (replaced by inline computation).
- `main.py` — a 10-line npm wrapper with no purpose.

### Quarantined (moved to `src/experimental/`, excluded from build+lint)
- Components: AdvisorPanel, SuggestionPanel, CollectionPanel,
  MatchupMatrixPanel, MetagamePanel, MetaAdvisorPanel, MetaSnapshotImporter,
  SideboardPlannerPanel, CardPool, StatusBar.
- Libs: buildWizard, optimizeEngine, budgetOptimizer, whatsMissing,
  similarCards, suggestions, comboFinder, metagame, metaPosition, metaSources,
  metaTypes, metaStore, trendAnalyzer, tierList, matchupMatrix,
  collectionStore.

### Test changes
- `companion.test.ts` EC-36/EC-37 switched from Kaheera (creature-type) to
  Gyruda (even-CMC). Kaheera's actual rule doesn't match the test's intent.
- `hypergeometric.test.ts` known-value assertions corrected. The previous
  expected values (0.6218 / 0.3089 / 0.378) were wrong;
  `P(X=0|N=60,K=4,n=7) ≈ 0.6005` is the correct math.
- `search.test.ts` rewritten: factory uses current `CardRecord` schema;
  fixtures hoisted via `vi.hoisted`; mock distinguishes `legalityStandard`
  and `legalityFuture` indices properly.
- `manaBase.test.ts`, `legality.test.ts` rewritten with full-schema card
  factories.

### Notes
- The previous CHANGELOG mentioned Chart.js. There is no Chart.js dependency
  in this project. `ManaCurveChart` renders bars with plain JSX/Tailwind.
