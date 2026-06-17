# Contributing to Intimidation-Tactics

Thanks for your interest in contributing! This document covers everything you need to go from zero to a merged pull request.

---

## Table of Contents

1. [Prerequisites](#prerequisites)
2. [Getting Started](#getting-started)
3. [Project Structure](#project-structure)
4. [Development Workflow](#development-workflow)
5. [Coding Standards](#coding-standards)
6. [Testing](#testing)
7. [Commit Convention](#commit-convention)
8. [Pull Request Process](#pull-request-process)
9. [Architecture Decision Records](#architecture-decision-records)

---

## Prerequisites

| Tool | Minimum version | Notes |
|------|----------------|-------|
| Node.js | 18.x LTS | 20.x recommended |
| npm | 9.x | ships with Node 18 |
| Git | 2.30+ | |

No global installs required beyond Node + npm. All tooling (Vite, Vitest, ESLint, TypeScript) is in `devDependencies`.

---

## Getting Started

```bash
# 1. Fork the repo, then clone your fork
git clone https://github.com/<your-username>/Intimidation-Tactics.git
cd "Intimidation-Tactics"

# 2. Install dependencies
npm install

# 3. Start the dev server (auto-opens http://localhost:5173)
npm run dev

# 4. Run the test suite
npm test
```

> **Note:** The dev server unregisters all Service Workers and clears all caches on load. This is intentional — see [PWA_STRATEGY.md](./docs/PWA_STRATEGY.md).

---

## Project Structure

```
src/
├── App.tsx                  # Root component
├── main.tsx                 # Entry point, SW registration
├── pwa.ts                   # Service Worker registration helper
├── components/              # React UI components
├── hooks/                   # Custom React hooks
├── store/                   # Zustand global state stores
├── workers/                 # Web Workers (heavy computation off main thread)
└── lib/
    ├── db.ts                # Dexie (IndexedDB) schema and helpers
    ├── types.ts             # Shared TypeScript types (CardRecord, etc.)
    ├── scoreEngine.ts       # V2 composite scoring pipeline
    ├── analysis/
    │   ├── seedAnalyzer.ts  # Seed intent inference (analyzeSeeds)
    │   └── synergyGraph.ts  # Seed synergy graph builder (cached)
    ├── ai/
    │   ├── aiGenerator.ts   # AI deck generation + validateAIProposal
    │   └── resolver.ts      # AI card name → CardRecord resolver
    └── __tests__/           # Unit tests for lib/
        ├── scoreEngine.test.ts
        └── seedAnalyzer.test.ts

docs/
├── adr/                     # Architecture Decision Records
├── DATABASE_SCHEMA.md       # Dexie schema reference
├── PWA_STRATEGY.md          # Service Worker + offline strategy
└── ENGINEERING_ASSESSMENT.md

public/
├── sw.js                    # Service Worker (hand-authored, not bundled)
└── manifest.webmanifest     # PWA manifest
```

---

## Development Workflow

### Running the Dev Server

```bash
npm run dev
```

HMR is enabled. The TypeScript checker runs in a separate process via `vite-plugin-checker` so you get type errors in the terminal without blocking hot reloads.

### Building for Production

```bash
npm run build
```

Output goes to `dist/`. Preview the production build locally:

```bash
npm run preview
```

### Linting

```bash
npm run lint
```

ESLint is configured in `eslint.config.js` with the TypeScript and React plugins. Fix lint errors before pushing.

---

## Coding Standards

### TypeScript

- Strict mode is enabled (`tsconfig.json`). No `any` without a comment explaining why.
- Prefer `interface` over `type` for object shapes exported from a file.
- Use `readonly` on immutable data structures (especially in `lib/`).
- All exported functions in `lib/` must have JSDoc comments with `@param` and `@returns`.

### React

- Functional components only — no class components.
- Keep components small and single-purpose. Extract logic to hooks.
- Use `React.memo` / `useMemo` / `useCallback` when profiling shows re-render overhead, not as a default.
- Tailwind CSS for all styling. No inline styles.

### State Management (Zustand)

- One store per domain concern (see `src/store/`).
- Stores must not import from each other directly — communicate via events or shared types.
- Async actions go inside the store using `set` with `async` functions; don't call `useStore.getState()` inside React components.

### Pure Functions in `lib/`

- All functions in `src/lib/analysis/` and `src/lib/scoreEngine.ts` must be **pure** and **deterministic**.
- No side effects (no `console.log`, no `db.*` calls, no `fetch`).
- These are the hottest code paths — profile before adding complexity.

---

## Testing

The project uses [Vitest](https://vitest.dev/) with `jsdom`.

### Running Tests

```bash
# Run all tests once
npm test

# Watch mode
npm run test:watch

# With coverage
npm run test:coverage
```

### Writing Tests

- Test files live in `src/lib/__tests__/` (for lib code) or alongside components (`*.test.tsx`).
- Use the `makeCard` helper pattern (see existing tests) to construct minimal `CardRecord` fixtures.
- Every new exported function in `lib/` requires at least these test cases:
  - Happy path with typical input
  - Edge case: empty / zero / null input
  - Boundary conditions (min/max values)

### Coverage Requirements

PRs that touch `src/lib/` must not decrease statement coverage below **80%**.

```bash
npm run test:coverage -- --reporter=text --coverage.thresholds.statements=80
```

---

## Commit Convention

We follow [Conventional Commits](https://www.conventionalcommits.org/):

```
<type>(<scope>): <short description>

[optional body]
[optional footer]
```

**Types:**

| Type | When to use |
|------|------------|
| `feat` | New feature visible to users |
| `fix` | Bug fix |
| `perf` | Performance improvement |
| `test` | Adding or fixing tests |
| `docs` | Documentation only |
| `refactor` | Code change with no behaviour change |
| `chore` | Build system, dependencies, CI |

**Examples:**

```
feat(ai): add validateAIProposal sanity check before deck acceptance
fix(sw): bump cache name to mtg-builder-v3 to purge stale assets
test(scoreEngine): add castability penalty monotonicity assertions
perf(synergyGraph): add module-level LRU cache for buildSeedSynergyGraph
docs(adr): add ADR-003 ai-provider-abstraction
```

---

## Pull Request Process

1. **Branch from `main`** — `git checkout -b feat/your-feature`
2. **One concern per PR** — don't bundle refactors with new features
3. **Update tests** — new code needs new tests; changed behaviour needs updated tests
4. **Run the full suite locally** before pushing: `npm test && npm run lint && npm run build`
5. **Fill in the PR template** — describe what changed and why, link any related issues
6. **Request review** from at least one maintainer
7. **Squash and merge** — the merge commit message becomes the changelog entry

### PR Checklist (auto-filled in template)

- [ ] `npm test` passes with no failures
- [ ] `npm run lint` passes with no errors  
- [ ] `npm run build` produces a clean `dist/` with no type errors
- [ ] New or updated exports have JSDoc comments
- [ ] `CHANGELOG.md` updated under `[Unreleased]`
- [ ] If schema changed: `docs/DATABASE_SCHEMA.md` updated

---

## Architecture Decision Records

Significant decisions about the codebase are recorded as ADRs in `docs/adr/`. Before making a large architecture change, check if an existing ADR covers it. If you're proposing a new approach that contradicts an existing ADR, write a new ADR that supersedes it.

ADR format: [Michael Nygard's template](https://cognitect.com/blog/2011/11/15/documenting-architecture-decisions)

Current ADRs:

| ID | Title |
|----|-------|
| [ADR-001](./docs/adr/001-offline-first-dexie.md) | Offline-First with Dexie/IndexedDB |
| [ADR-002](./docs/adr/002-zustand-state.md) | Zustand for Global State |
| [ADR-003](./docs/adr/003-ai-provider-abstraction.md) | AI Provider Abstraction Layer |
| [ADR-004](./docs/adr/004-log-compressed-synergy.md) | Log-Compressed Synergy Scoring |
| [ADR-005](./docs/adr/005-meta-adjustment-bounds.md) | Meta Adjustment Bounds |

---

## Questions?

Open a [GitHub Discussion](https://github.com/Celeannora/Intimidation-Tactics/discussions) for design questions, or file an [Issue](https://github.com/Celeannora/Intimidation-Tactics/issues) for bugs.
