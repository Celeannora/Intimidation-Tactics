# MTG Standard Deck Builder

A browser-based deck builder for Magic: The Gathering Standard format. Imports
the full Scryfall bulk-data JSON locally into IndexedDB, then provides search,
filtering, deck construction, legality validation, mana-base analysis,
opening-hand simulation, and basic matchup tracking — all client-side, with no
backend.

## Status (honest)

This is a working scaffold, **not a finished product**. The original codebase
had a sprawling roadmap including metagame analysis, deck advisors, build
wizards, etc. The vast majority of that code never compiled and depended on
schemas that didn't exist. It has been triaged, deleted, or quarantined.

What follows is the truth as of this commit.

### What works

- **Bulk import** from Scryfall `oracle_cards.json` (web worker, IndexedDB)
- **Card search** with text / type / subtype / colour / CMC / rarity / set /
  keyword / price filters, sorting, pagination
- **Deck construction** (main + sideboard), per-oracle quantity limits
- **Legality validation** — `MIN_60`, `OVER_60`, `MAX_COPIES`, `SIDE_SIZE`,
  `BANNED`, `NOT_LEGAL`
- **Mana curve / pip / land recommendation** — `recommendedLandCount` heuristic,
  `colorSourceDistribution` allocator
- **Hypergeometric draw probabilities** — opening hand, by-turn castability
- **Opening-hand simulator** — keep/mulligan signal
- **Card scoring** — bare-number 0–30 synergy + 0–30 power signal, composite
  rolled up into a `ScoredCard`
- **Companion check** for Gyruda / Lurrus / Yorion / Kaheera / Obosh / Umori /
  Jegantha / Zirda
- **Archetype heuristic** — aggro / midrange / control / combo / tempo
- **Bo3 / sideboard plan** — basic shell
- **Match tracker** — local record keeping
- **PWA** — installable, offline-capable shell
- **Tests** — 145 passing across 10 suites
- **CI** — typecheck, lint (`--max-warnings 0`), test, build

### What was deleted

Removed because either nonexistent dependencies, broken schemas, or
"feature-complete" claims with zero working code:

- Rotation impact tracking (`src/lib/rotation*.ts`, components)
- Deck history / versioning (depended on a `db.deckVersions` table that was
  never declared)
- `useManaBaseStore` — replaced by inline computation in `ManaBasePanel`
- `main.py` — a 10-line npm wrapper for no reason

To recover any of these, check git history before the triage commit.

### What is quarantined

The following files compile-fail or depend on missing APIs. They live in
`src/experimental/` and are **excluded from `tsconfig.json` and lint**.
Restoring them is non-trivial and intentionally out of scope:

```
src/experimental/components/
  AdvisorPanel, SuggestionPanel, CollectionPanel,
  MatchupMatrixPanel, MetagamePanel, MetaAdvisorPanel,
  MetaSnapshotImporter, SideboardPlannerPanel,
  CardPool, StatusBar
src/experimental/lib/
  buildWizard, optimizeEngine, budgetOptimizer, whatsMissing,
  similarCards, suggestions, comboFinder, metagame, metaPosition,
  metaSources, metaTypes, metaStore, trendAnalyzer, tierList,
  matchupMatrix, collectionStore
```

Do not "fix" these without first agreeing on what they should do — most were
designed against APIs that no longer exist.

## Quick start

```bash
npm install
npm run dev          # vite dev server
npm test             # vitest, 145 tests
npm run build        # tsc --noEmit && vite build
npm run lint         # eslint, max-warnings 0
```

Then open the app and drop your local `oracle_cards.json` (downloaded from
<https://scryfall.com/docs/api/bulk-data>) onto the bulk importer in the UI.

## Stack

- **React 18.3** + **TypeScript 5.8** (strict, `noEmit`)
- **Vite 6** (ES2022 target, ES-module worker)
- **Tailwind 3.4** + PostCSS / Autoprefixer
- **Zustand 5** — single deck store
- **Dexie 4** + `dexie-react-hooks` — IndexedDB abstraction
- **Vitest 3** + `fake-indexeddb` for tests

## Key invariants (must not regress)

These are the data-shape contracts that propagate across the codebase. Changing
them is a multi-file edit:

```ts
// Deck entry — one row per (card, board)
type DeckEntry = { card: CardRecord; quantity: number; board: "main" | "side" };

// Scored card — composite is the sortable summary metric
type ScoredCard = {
  card: CardRecord;
  composite: number;
  powerScore: number;
  signalScore: number;
  synergyScore: number;
  grade: "S" | "A" | "B" | "C" | "D";
};

// Role buckets
type RoleComposition = {
  threats: number; removal: number; boardWipes: number;
  counterspells: number; cardDraw: number; ramp: number;
  lands: number; total: number;
};

// Scoring API (bare numbers, 0–30 each)
function computeSynergy(card, entries): number;
function getPowerSignal(card, entries): number;
// alias: export const computePowerSignal = getPowerSignal

// Search API — CardFilters (NOT SearchFilters)
function searchCards(filters: CardFilters): Promise<{ cards: CardRecord[]; total: number }>;
// filter keys: text, sort, direction, page, perPage  (NOT query/sortBy/sortDir/limit/offset)

// Land recommendation
function recommendLandCount(entries: DeckEntry[]): LandRecommendation;
// LandRecommendation.recommended is the number
```

## Project layout

```
src/
  App.tsx, main.tsx, pwa.ts
  components/         — surviving UI panels (Curve, Mana, Odds, Archetype,
                        Validate, Plan, Bo3, Side, Matches, Export, …)
  experimental/       — EXCLUDED from tsconfig+lint, do not touch
  hooks/              — useDBStatus, useConsistencyReport, useKeyboardShortcuts,
                        useCardPool, usePWAInstall
  lib/                — engine: search, legality, mana, manaBase, synergy,
                        powerSignal, scoring, archetype, companion, bo3,
                        sideboardPlan, matchup, deckExporter, scryfall, types
  store/              — zustand deckStore
  test/setup.ts       — fake-indexeddb
  workers/            — importWorker (ES module)
public/
  manifest.webmanifest, sw.js
```

## CI

GitHub Actions runs on push: `npm ci → typecheck → lint → test → build` on
Node 20. Lint is pinned to `--max-warnings 0`. All five Phase A config files
(`tsconfig.json`, `vite.config.ts`, `index.html`, `tailwind.config.js`,
`postcss.config.js`) are verified to exist before any step runs.

## Known UI gaps

- `CardDetailDrawer` shows a 2-tile score grid (Synergy / Signal). The old
  3-tile layout with "reasons" was dropped because the new bare-number scoring
  API doesn't return reasons.
- `CardSearchPanel` no longer renders a "reasons" list under expanded rows for
  the same reason.

## License

No license declared. Treat as all-rights-reserved.
