# ADR-002: Zustand for Global State Management

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Core team

---

## Context and Problem Statement

The deck builder has several interconnected pieces of global state: the currently active deck (mainboard, sideboard, pins), AI generation progress, UI preferences, and the import status of the card database. This state needs to be:

- Readable and writeable from many components at multiple levels of the tree
- Persistent across navigation within the SPA (without prop drilling)
- Serialisable to IndexedDB for deck save/load
- Testable in isolation without rendering a component tree

What state management library should we use?

---

## Decision Drivers

- Minimal boilerplate — this is a solo/small-team project; Redux ceremony would slow development
- TypeScript-first with good inference — no manual action type discrimination
- Stores must be usable outside React (e.g. in Web Worker message handlers, utility functions)
- Supports both synchronous and asynchronous state mutations
- Small bundle footprint

---

## Considered Options

### Option A: Zustand ✓ chosen

### Option B: Redux Toolkit (RTK)

### Option C: React Context + useReducer

### Option D: Jotai (atomic state)

---

## Decision Outcome

**Chosen option: Zustand**

Zustand provides a minimal, un-opinionated store that:
- Is created with `create<T>()(set, get)` — no Provider required
- Supports synchronous slices and async thunks in the same store with zero extra API
- Is fully usable outside React via `useXStore.getState()` / `useXStore.setState()`
- Has excellent TypeScript inference — store shape and actions are typed in one declaration
- Ships ~1 KB gzipped

The pattern used is **one store per domain concern** (e.g. `useDeckStore`, `useImportStore`, `useAIStore`) rather than one monolithic store. This improves code locality and makes each store independently testable.

---

## Store Architecture

```
src/store/
├── useDeckStore.ts        # Active deck: mainboard, sideboard, pins, save/load
├── useImportStore.ts      # Card import status, progress, card count
└── useAIStore.ts          # AI generation state, provider selection, progress
```

**Invariants enforced:**
- Stores do not import from each other (no circular dependencies)
- Stores do not hold `CardRecord` objects — only `oracleId` keys; card data is joined from Dexie on demand
- Async Dexie operations are invoked inside store actions, not in components

---

## Consequences

### Positive

- Zero boilerplate: no actions, reducers, or dispatchers
- Stores are plain TypeScript objects — easy to test with `vi.mock` or direct `setState` manipulation
- Subscriptions are fine-grained: components only re-render on the slices they subscribe to
- Devtools integration via `zustand/middleware` `devtools()` wrapper

### Negative

- No built-in time-travel debugging (Redux DevTools time-travel does not work)
- No enforced unidirectional data flow — discipline required to prevent spaghetti state mutations
- Store state is ephemeral by default; Dexie persistence must be wired up manually

### Neutral

- Zustand is not opinionated about immutability; mutations via `immer` middleware are optional but not required at this scale

---

## Pros and Cons of Rejected Options

### Option B — Redux Toolkit

- ✓ Excellent devtools, time-travel debugging, huge ecosystem
- ✗ Even with RTK, slice/action/reducer boilerplate is unavoidable
- ✗ `thunk`/`createAsyncThunk` pattern is more verbose than Zustand async functions
- ✗ Full RTK adds ~10 KB gzipped vs ~1 KB for Zustand

### Option C — React Context + useReducer

- ✓ Zero dependencies, built into React
- ✗ Context updates re-render the entire subtree unless memoised carefully
- ✗ Async state requires manual effect/dispatch coordination
- ✗ Not usable outside React (e.g. in Web Workers or utility libs)

### Option D — Jotai

- ✓ Atomic, fine-grained reactivity; excellent for forms and derived state
- ✗ Atom-per-field pattern fragments state that should be transactional (e.g. deck mainboard + sideboard + pins must update together)
- ✗ Cross-atom derived state requires `atom(get => ...)` chains that are harder to reason about at scale

---

## More Information

- [Zustand documentation](https://docs.pmnd.rs/zustand/getting-started/introduction)
- [Zustand comparison with Redux](https://docs.pmnd.rs/zustand/getting-started/comparison)
