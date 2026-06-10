# Intimidation-Tactics

A client-side **Magic: The Gathering** Standard-format deck builder, packaged as
an installable Progressive Web App. It imports the full Scryfall bulk-data JSON
into the browser's IndexedDB (via Dexie) and runs entirely on the client — no
backend, no API keys required for the core experience.

On top of search and deck construction it bundles two larger engines: an
**offline deck generator** that assembles a legal Standard deck from a card pool
using role targets, color weighting, and a synergy model; and an optional
**AI assistant** layer that can call OpenAI-compatible, Ollama, or llama.cpp
providers to suggest or generate decks.

## Features

- **Bulk import** from Scryfall `oracle_cards.json` (parsed in a web worker,
  stored in IndexedDB)
- **Card search** with text / type / subtype / colour / CMC / rarity / set /
  keyword / price filters, sorting, and pagination
- **Deck construction** (main + sideboard) with per-oracle quantity limits
- **Legality validation** for Standard — `MIN_60`, `OVER_60`, `MAX_COPIES`,
  `SIDE_SIZE`, `BANNED`, `NOT_LEGAL`
- **Mana analysis** — curve, pip counts, land-count recommendation, and color
  source distribution
- **Hypergeometric draw probabilities** and an **opening-hand simulator**
  (keep/mulligan signal)
- **Card scoring** — synergy + power signals rolled into a composite `ScoredCard`
- **Companion check** (Gyruda, Lurrus, Yorion, Kaheera, Obosh, Umori, Jegantha,
  Zirda)
- **Archetype heuristic** — aggro / midrange / control / combo / tempo
- **Offline deck generator** (`src/lib/generator/`) — pool building, role
  targeting, color weighting, optimization, and sideboard suggestions
- **AI providers** (`src/lib/ai/`) — OpenAI-compatible, Ollama, and llama.cpp
  backends behind a common provider interface, with a deck digest/resolver layer
- **Bo3 / sideboard plan**, **match tracker**, and **deck import/export**
- **PWA** — installable and offline-capable

## Quick start

```bash
npm install
npm run dev          # Vite dev server
npm test             # Vitest
npm run lint         # ESLint, --max-warnings 0
npm run typecheck    # tsc --noEmit
npm run build        # tsc --noEmit && vite build
```

A Python launcher is also provided as a convenience wrapper around Vite (it
checks for Node/npm, installs dependencies if needed, frees the port, and starts
the dev or preview server):

```bash
python main.py                 # dev server on http://localhost:5173/
python main.py --preview       # production preview
python main.py --port 3000     # custom port
```

Once the app is running, download `oracle_cards.json` from
<https://scryfall.com/docs/api/bulk-data> and drop it onto the bulk importer in
the UI to populate the local card database.

## Stack

- **React 18.3** + **TypeScript 5.8** (strict, `noEmit`)
- **Vite 6** (ES2022 target, ES-module worker)
- **Zustand 5** — single deck store
- **Dexie 4** + `dexie-react-hooks` — IndexedDB abstraction
- **Tailwind 3.4** + PostCSS / Autoprefixer
- **Vitest 3** + `fake-indexeddb` for tests

## Project layout

```
src/
  App.tsx, main.tsx, pwa.ts
  components/   — UI panels (search, deck, curve, mana, validation, archetype,
                  consistency, Bo3, sideboard, match tracker, import/export,
                  generator, AI settings, …)
  hooks/        — useDBStatus, useConsistencyReport, useKeyboardShortcuts,
                  useCardPool, usePWAInstall
  lib/          — core engine: search, legality, mana, manaBase, scoring,
                  synergy, powerScore, archetype, companion, bo3, sideboardPlan,
                  matchup, deckParser, deckExporter, scryfall, db, types
    lib/ai/         — AI providers (openai, ollama, llamacpp), factory, resolver,
                      digest, models, aiGenerator
    lib/generator/  — offline generator pipeline (pool, roleTargets, colorWeights,
                      weights, synergyModel, optimizer, sideboard, generator)
  store/        — Zustand deckStore
  test/setup.ts — fake-indexeddb wiring
  workers/      — importWorker (ES module)
public/
  manifest.webmanifest, sw.js
main.py         — Python launcher around Vite
```

## CI

GitHub Actions runs on push: `npm ci → typecheck → lint (--max-warnings 0) →
test → build` on Node 20.

## License

This project is licensed under the **GNU General Public License v3.0**. See
[LICENSE](LICENSE) for the full text.

## Legal / attribution

Intimidation-Tactics is unofficial Fan Content permitted under the Fan Content
Policy. Not approved/endorsed by Wizards. Portions of the materials used are
property of Wizards of the Coast. ©Wizards of the Coast LLC.
