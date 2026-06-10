# MTG Generative Deck Builder — Execution Plan

> **Status:** Decision-complete. Hand off to coding agent / `/start-work`.
> **Source spec:** `plan_v2.md` (827-line design doc). This plan resolves 7 audit defects from that spec and adds the execution scaffolding it lacked (waves, acceptance criteria, agent-executable QA, Definition of Done).
> **Greenfield:** Repo scan (`E:\Scripts`) confirmed zero pre-existing MTG code. We build from scratch under `Bloomburrow/mtg_deck_builder/`.

---

## 0. Goals & Non-Goals

### Goals
- Offline-first MTG deck builder (Python 3.11+) that runs without network after install.
- Validate decks across **Commander, Standard, Modern, Pauper** (all four — not just claimed).
- Score card synergy via a local GGUF LLM with a **heuristic fallback** so the app works even with no model.
- Gradio web UI; export to MTGGoldfish/Archidekt/MTGA/PDF.

### Non-Goals (scope guards — do NOT do these)
- Multiplayer netplay, online deck sharing, account system.
- Live price storefront (prices in bulk data are stale; use for trends only).
- PyQt6 desktop client is **OPTIONAL/stretch** — not on the critical path.
- All MTG layouts. Implement first-class support for `normal`, `split`, `transform`, `modal_dfc`, `meld`; treat `flip`/`leveler`/`class`/`case` as `normal` for v1 validation; explicitly filter out `token`/`emblem`/`scheme`/`planar`/`vanguard`/`art_series`/`double_faced_token` at ingestion.

---

## 1. Authoritative Facts (verified this session, cited)

These were fetched directly from source on 2026-05-30. The plan depends on them; do not re-derive.

### 1.1 Scryfall Bulk Data API
- Endpoint: `GET https://api.scryfall.com/bulk-data` returns `{object:"list", data:[bulk_data...]}`.
- Use **`oracle_cards`** (~173 MB) as PRIMARY source — one row per unique Oracle ID, no printing dupes. Best fit for deck building.
- `default_cards` (~539 MB) is the fallback if per-printing data is needed (it isn't, for v1).
- Each `bulk_data` object has `download_uri` like `https://data.scryfall.io/oracle-cards/oracle-cards-<TIMESTAMP>.json` — **always timestamped, never hardcode**.
- `content_encoding: gzip` — must stream-decompress.
- Source: https://scryfall.com/docs/api/bulk-data

### 1.2 Rate Limits (https://scryfall.com/docs/api/rate-limits)
- `api.scryfall.com`: **10 req/sec** general; **2 req/sec** for `/cards/search`, `/named`, `/random`, `/collection`.
- **`*.scryfall.io` file origin: NO rate limit** → bulk downloads are unthrottled.
- HTTP 429 → 30s lockout; repeated abuse → permanent ban.
- **Throttle API calls** (100ms general, 500ms search) and cache data ≥24h.
- **Prices stale after 24h** — never use bulk prices for transactions; trend/estimate only.

### 1.3 Layouts (https://scryfall.com/docs/api/layouts)
- `layout` field is the programmatic key for shape of the card object.
- `split`, `flip`, `transform`, `double_faced_token` → ALWAYS have `card_faces[]`.
- `meld` → ALWAYS has `all_parts[]`.
- `modal_dfc` (MDFC) → has `card_faces[]`.
- For color-identity / cmc / type_line sourcing per layout:
  - `transform` & `meld`: **front face only** for color identity & cmc (back face contributes to color identity only via rules text for some cards — v1 uses front face).
  - `modal_dfc`: **both faces** contribute to color identity; cmc = front face cmc.
  - `split`: one card, two halves; color identity = union of both faces; cmc = sum.
  - `adventure` (layout): treat as `normal` for identity; both halves' mana costs exist but the card itself has one cmc.

### 1.4 MTG Format Construction Rules

| Format | Total deck | Min | Max | Singleton | Max copies (non-basic) | Sideboard | Commander req | Color-identity req | Rarity restriction |
|---|---|---|---|---|---|---|---|---|---|
| **Commander** | **100 (99 + 1 commander)** | 100 | 100 | YES | 1 | 0 | YES (legendary creature or planeswalker w/ "can be your commander") | YES — all cards' color identity must be subset of commander's | none |
| **Standard** | ≥60 | 60 | none | NO | 4 | 0 or 15 (exactly) | NO | NO | none |
| **Modern** | ≥60 | 60 | none | NO | 4 | 0 or 15 (exactly) | NO | NO | none |
| **Pauper** | ≥60 | 60 | none | NO | 4 | 0 or 15 (exactly) | NO | NO | YES — every card must have been printed at **common** rarity in *at least one* paper set on MTGO (Scryfall flag = `card.rarity == "common"` in any printing; for `oracle_cards` we instead use the `legalities.pauper` flag which already encodes this) |

- **Banlist source:** Scryfall's per-card `legalities` object (keys: `standard`, `modern`, `commander`, `pauper`; values: `legal`, `not_legal`, `banned`, `restricted`) IS the authoritative banlist for v1 — no separate `banlist` table needed. Drop the `banlist` table from plan_v2's schema.
  - One nuance Scryfall does NOT encode: Commander's "Companion" mechanic (need 6+ unique cards satisfying the companion's condition) — must be validated separately.
- Companion validation rule: card has "Companion —" in `oracle_text` → if chosen, the rest of the deck must satisfy the stated condition.

### 1.5 Library Version Guidance (as-of plan)
- Python 3.11 minimum, 3.12 recommended.
- `llama-cpp-python` 0.2.x grammar API: `LlamaGrammar.from_string(text)` + pass `grammar=` to model call. 0.3.x is similar; pin to a known working version after a smoke test in W0-T2.
- `gradio` 4.x supports `yield`-based streaming via generator handlers. Avoid `gr.update(...)` for streaming partials; just `yield` the new value.
- `duckdb`, `plotly`, `networkx`, `reportlab`: pin to latest stable at install time (W0-T2 task locks the actual pins via `pip freeze`).

---

## 2. Audit Fixes (from plan_v2.md review — MUST be honored)

| # | Defect in plan_v2 | Fix |
|---|---|---|
| 1 | Commander size = `min_size:99, max_size:99` (line 169) | **`total_size: 100`** including the commander. Validator accepts `library == 99 AND commander present`. |
| 2 | Modern + Pauper claimed but undefined | §1.4 table above is the source of truth. Pauper uses `legalities.pauper`. |
| 3 | Hallucination test loads real 2.5GB GGUF | Split into TWO tests: unit test (`test_validate_card_names_rejects_unknown`) stubs out the LLM and exercises `validate_card_names` directly; integration test marked `@pytest.mark.integration` runs only when `MTG_RUN_INTEGRATION=1` env var is set. |
| 4 | Data ingestion undefined | §1.1 fully specifies. Task W1-T1 below implements the downloader. |
| 5 | Stale pinned deps (`gradio==4.0.0`, etc.) | W0-T2 installs latest stable and locks via `pip freeze > requirements.txt`. |
| 6 | Cache key bug (memory sorts, disk doesn't) | Normalize to `tuple(sorted([a, b]))` on BOTH read and write, in memory AND disk layers. Disk schema MUST store the sorted form. |
| 7 | No execution scaffolding | This entire document. Waves, acceptance criteria, QA. |

---

## 3. Architecture (locked from plan_v2 §1 with fixes)

```
Bloomburrow/
└── mtg_deck_builder/
    ├── engine/
    │   ├── __init__.py
    │   ├── card_db.py          # SQLite schema + ingestion + DuckDB views
    │   ├── deck_rules.py       # Format validation (all 4) + color identity + companion
    │   ├── synergy_scorer.py   # Heuristic (LLM-free) scorer
    │   └── mana_engine.py      # Curve + color-source math
    ├── llm/
    │   ├── __init__.py
    │   ├── local_llm.py        # llama-cpp wrapper, GBNF, fallback orchestration
    │   ├── prompt_templates.py # Synergy + deck-gen prompts (anti-hallucination)
    │   └── response_parser.py  # JSON extract + validate_card_names guardrail
    ├── performance/
    │   ├── __init__.py
    │   └── cache_manager.py    # SynergyCache (LRU mem + SQLite disk, sorted keys)
    ├── ui/
    │   ├── __init__.py
    │   └── gradio_app.py       # 5-tab UI
    ├── exporters/
    │   ├── __init__.py
    │   ├── text_formats.py     # MTGGoldfish, Archidekt, MTGA
    │   └── pdf_export.py       # reportlab
    ├── data/
    │   ├── raw/                # Downloaded Scryfall JSON (gitignored)
    │   └── cache/              # Synergy + LLM response caches (gitignored)
    ├── tests/
    │   ├── conftest.py         # Shared fixtures (tiny test DB)
    │   ├── fixtures/
    │   │   └── 50_real_cards.json
    │   ├── test_card_db.py
    │   ├── test_deck_rules.py
    │   ├── test_synergy_guardrails.py     # UNIT — stubs LLM
    │   ├── test_cache.py
    │   ├── test_integration_llm.py        # @pytest.mark.integration
    │   └── test_performance.py            # @pytest.mark.slow
    ├── config.yaml
    ├── requirements.txt
    ├── install.py
    └── README.md
```

---

## 4. Execution Waves & TODOs

Each task is atomic, has explicit acceptance criteria, and an agent-executable verification step.
**Wave Wn depends on all earlier waves.** Tasks within a wave are parallelizable unless noted.

### Wave 0 — Project Bootstrap

#### W0-T1 — Repo scaffold
**Goal:** Create directory tree + empty `__init__.py` files + `.gitignore` + initial `README.md`.
**Files created:** All directories from §3; empty `__init__.py` in each package; `.gitignore` (ignore `data/raw/`, `data/cache/`, `models/`, `*.db`, `__pycache__/`, `.venv/`); skeleton `README.md`.
**Acceptance:** `python -c "import mtg_deck_builder.engine, mtg_deck_builder.llm, mtg_deck_builder.ui, mtg_deck_builder.performance, mtg_deck_builder.exporters"` exits 0.
**QA:** `Bash("python -c 'import mtg_deck_builder.engine'")` → exit 0. `Bash("git status")` shows the new tree.

#### W0-T2 — Pin dependencies & install.py
**Goal:** Write `requirements.txt` with latest-stable pins, plus a working `install.py` that creates a venv and installs deps.
**Spec:**
- Install: `gradio`, `llama-cpp-python`, `duckdb`, `plotly`, `networkx`, `reportlab`, `requests`, `pyyaml`, `pytest`, `pytest-asyncio`, `huggingface_hub`.
- `install.py` flow: detect venv → create if missing → `pip install -r requirements.txt` → check disk space → optionally download Phi-3-mini GGUF (~2.5 GB) on user confirm → print next-step instructions.
- `requirements.txt` MUST be the output of `pip freeze` after a clean install (locked, reproducible).
- README must call out: "`llama-cpp-python` requires a C++ build toolchain on Windows (MSVC build tools) — if install fails, install Visual Studio Build Tools with the C++ workload."
**Acceptance:** `python install.py` in a clean checkout produces a working `.venv` and `pip list` includes every required package.
**QA:** `Bash(".venv\Scripts\pip.exe check")` → exit 0 (no dependency conflicts).

#### W0-T3 — `config.yaml`
**Goal:** Single config file with model paths, format definitions (mirroring §1.4 table), and budget defaults.
**Acceptance:** Loadable with `yaml.safe_load`; has top-level keys `models`, `formats`, `budget`, `paths`.
**QA:** `Bash("python -c 'import yaml; yaml.safe_load(open(\"config.yaml\"))'")` → exit 0.

---

### Wave 1 — Card Database (depends on W0)

#### W1-T1 — Scryfall bulk downloader (`engine/card_db.py::download_bulk`)
**Goal:** Implement bulk-data fetch per §1.1 — discover, download, decompress.
**Behavior:**
1. `GET https://api.scryfall.com/bulk-data` (with `User-Agent: mtg_deck_builder/0.1` and `Accept: application/json`).
2. Parse `data[]`, find `type == "oracle_cards"`, read its `download_uri`.
3. Compare `updated_at` to `data/raw/.last_updated`; skip if <24h old AND file exists (unless `force=True`).
4. Stream-download the gzip JSON to `data/raw/oracle_cards.json.gz`.
5. Decompress to `data/raw/oracle_cards.json`.
6. Write `data/raw/.last_updated` with current ISO timestamp.
**Acceptance:** After running, `data/raw/oracle_cards.json` exists and is valid JSON whose top level is an array of card objects; second invocation within 24h returns early without re-downloading.
**QA:** Unit test mocks `requests.get` for the two URLs; integration test (marked) hits the live API.

#### W1-T2 — SQLite schema + ingestion (`engine/card_db.py::MagicCardDB`)
**Goal:** Define schema and ingest oracle_cards JSON.
**Schema:**
```sql
CREATE TABLE IF NOT EXISTS cards (
    oracle_id TEXT PRIMARY KEY,
    name TEXT UNIQUE NOT NULL,
    mana_cost TEXT,
    cmc REAL,
    type_line TEXT,
    oracle_text TEXT,
    colors TEXT,               -- JSON array as TEXT, e.g. '["U","B"]'
    color_identity TEXT,       -- JSON array as TEXT
    power TEXT,                -- string (can be "*")
    toughness TEXT,
    loyalty TEXT,
    keywords TEXT,             -- JSON array
    layout TEXT NOT NULL,
    set_code TEXT,
    rarity TEXT,
    prices_usd REAL, prices_usd_foil REAL, prices_eur REAL, prices_tix REAL,
    edhrec_rank INTEGER,
    legalities TEXT NOT NULL,  -- JSON object {standard:"legal", commander:"banned", ...}
    card_faces TEXT,           -- JSON or NULL
    all_parts TEXT,            -- JSON or NULL
    last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);
CREATE INDEX IF NOT EXISTS idx_color_identity ON cards(color_identity);
CREATE INDEX IF NOT EXISTS idx_cmc ON cards(cmc);
CREATE INDEX IF NOT EXISTS idx_type ON cards(type_line);
CREATE INDEX IF NOT EXISTS idx_layout ON cards(layout);
CREATE INDEX IF NOT EXISTS idx_name_lc ON cards(LOWER(name));
```
**Ingestion rules:**
- Use `PRAGMA journal_mode=WAL`.
- **Filter out** layouts: `token`, `emblem`, `scheme`, `planar`, `vanguard`, `art_series`, `double_faced_token`.
- Store `colors`, `color_identity`, `keywords`, `legalities`, `card_faces`, `all_parts` as JSON-encoded TEXT.
- Use `INSERT OR REPLACE` keyed on `oracle_id`.
- Batch in transactions of 1000 rows.
**Acceptance:** After ingesting a known fixture (`tests/fixtures/50_real_cards.json`), `SELECT COUNT(*) FROM cards` returns 50 (or fewer if any are filtered layouts — document expected count in test).
**Note:** NO separate `banlist` table — legalities live on the card row (audit fix #2).

#### W1-T3 — DuckDB analytic views (`engine/card_db.py::_init_duckdb_views`)
**Goal:** Attach SQLite DB to DuckDB and create 4 views.
**Views:** `vw_cards_by_color`, `vw_cards_by_cmc`, `vw_legendary_creatures`, `vw_planeswalkers`.
**Acceptance:** `duck.execute("SELECT COUNT(*) FROM vw_legendary_creatures").fetchone()[0] > 0` after ingestion.

#### W1-T4 — Card-DB query helpers
**Goal:** Method API on `MagicCardDB` for the rest of the app: `get_by_name(name)`, `search(query_string)` (basic Scryfall-ish syntax: `c:ub t:creature cmc<=4`), `all_names() -> Set[str]` (memoized).
**Acceptance:** Unit tests cover each helper against the fixture.

---

### Wave 2 — Rule Engine (depends on W1)

#### W2-T1 — `engine/deck_rules.py::FORMAT_RULES`
**Goal:** Encode §1.4 table verbatim. Fix audit defect #1.
**Spec:**
```python
FORMAT_RULES = {
    "commander": {
        "total_size": 100,           # library 99 + commander 1
        "library_size": 99,
        "singleton": True,
        "max_copies": 1,
        "sideboard_size": 0,
        "needs_commander": True,
        "color_identity_strict": True,
        "rarity_restriction": None,
    },
    "standard": {"total_size": None, "min_size": 60, "max_copies": 4, "sideboard_size": 15, "needs_commander": False, "color_identity_strict": False, "rarity_restriction": None},
    "modern":   {"total_size": None, "min_size": 60, "max_copies": 4, "sideboard_size": 15, "needs_commander": False, "color_identity_strict": False, "rarity_restriction": None},
    "pauper":   {"total_size": None, "min_size": 60, "max_copies": 4, "sideboard_size": 15, "needs_commander": False, "color_identity_strict": False, "rarity_restriction": "common"},
}
```

#### W2-T2 — `validate_deck(cards, format, commander=None, sideboard=None) -> ValidationResult`
**Goal:** Implement all four formats with the rules from §1.4.
**Must handle:**
- Size check (Commander uses `library_size + (1 if commander else 0) == total_size`).
- Singleton + max_copies (basic lands exempt — `type_line` contains "Basic Land").
- Commander color identity subset rule, using `card_faces[]` per §1.3 (front face for transform/meld; both faces for MDFC; union for split).
- Format legality via `legalities[format]` (must be `"legal"`; `"banned"`/`"restricted"`/`"not_legal"` → error).
- Pauper rarity: every card row must have `legalities.pauper == "legal"` (Scryfall already encodes "common in some printing" via this flag).
- Companion validation (audit gap — Scryfall doesn't encode this).
**ValidationResult dataclass:** `is_valid: bool, errors: List[str], warnings: List[str], manacurve: Dict[int,int], color_pie: Dict[str,int], mana_sources: Dict[str,int]`.
**Acceptance:** See QA below.

#### W2-T3 — Mana curve & color-source math (`engine/mana_engine.py`)
**Goal:** Compute CMC distribution and required color sources per Frank Karsten's table (e.g. casting `BB` on turn 2 needs ~18 black sources in a 60-card deck, scaled for commander to ~22). Hardcode the lookup table; cite source in code comment.
**Acceptance:** Given a deck dict, returns dict like `{"sources_required": {"B": 18}, "sources_actual": {"B": 16}, "color_screw_risk": {"B": "medium"}}`.

---

### Wave 3 — Synergy: Heuristic + Cache (depends on W1)

#### W3-T1 — `performance/cache_manager.py::SynergyCache`
**Goal:** Two-layer cache with normalized sorted keys (audit fix #6).
**Spec:**
- `__init__(db_path, memory_size=10000, ttl=300)`.
- Internal helper `_norm(a, b) -> Tuple[str,str]: return tuple(sorted([a,b]))`.
- Disk schema stores cards in **sorted order**: `PRIMARY KEY (card_a, card_b)` where `card_a < card_b` is an enforced invariant. Add a `CHECK (card_a <= card_b)` constraint.
- `get_synergy(a, b)`: normalize → mem hit (with TTL check) → disk hit → None. On disk hit, promote to memory.
- `cache_synergy_batch(results)`: normalize EVERY entry before insert; use `INSERT OR REPLACE`.
- Thread-safe via `threading.Lock`.
**Acceptance:** Unit test inserts `(B, A)` then queries `(A, B)` → returns the same entry. (This is the bug plan_v2 had.)

#### W3-T2 — `engine/synergy_scorer.py::HeuristicScorer`
**Goal:** LLM-free pair scorer per plan_v2 §4.5 with the rules already specified there (type/keyword/cmc/color overlap → score 0–1).
**Acceptance:** Unit tests for shared-color, ramp pair, keyword overlap.

---

### Wave 4 — LLM Integration (depends on W3)

#### W4-T1 — `llm/local_llm.py::OfflineMagicLLM`
**Goal:** Wrap llama-cpp-python with: GGUF load (lazy), batched synergy analysis, GBNF-constrained generation, streaming, fallback to heuristic on ANY exception.
**Behavior:**
- `__init__(model_path, n_ctx=4096, n_gpu_layers=0)` — accept `None` model_path → mark as `disabled`, always fall back.
- `analyze_synergy_batch(pairs, batch_size=100)`: cache check → uncached chunk → LLM call inside `try/except` → on success, `validate_card_names` → cache; on failure, `HeuristicScorer.score_batch` → cache.
- Wrap model call with a per-call timeout (e.g. 60s) — kill the call rather than hanging the UI.
- Use the GBNF grammar from W4-T2.

#### W4-T2 — GBNF grammar (in `llm/local_llm.py` or `llm/grammars.py`)
**Goal:** Constrain output to JSON `{"synergies": [{card_a, card_b, score, reason}, ...]}`.
**Acceptance:** Unit test (no model) parses grammar with `LlamaGrammar.from_string`.

#### W4-T3 — Prompt builder (`llm/prompt_templates.py::SynergyPromptBuilder`)
**Goal:** Per plan_v2 §4.3 — include a "known cards" allowlist filtered against the DB to discourage hallucination; instruct model to emit `UNKNOWN_CARD` if uncertain.

#### W4-T4 — Response guardrail (`llm/response_parser.py::validate_card_names`)
**Goal:** Replace any card name not in DB with `"UNKNOWN_CARD"` and force score to 0.0. Clamp scores to [0, 1]. Audit fix #3 → this function is the **unit-test target**.
**Acceptance:** `test_validate_card_names_rejects_unknown` (unit) passes; `test_integration_llm.py::test_real_model` runs only with `MTG_RUN_INTEGRATION=1`.

---

### Wave 5 — UI (depends on W2 + W4)

#### W5-T1 — `ui/gradio_app.py` — Command Center + Card Search tabs
**Goal:** Tabs 1–2 of the 5-tab layout. Use Gradio 4.x `yield`-based streaming.
**Spec:**
- **Command Center**: format dropdown, commander textbox (conditional on Commander), budget slider, deck size counter, color-pie chart (Plotly), curve chart (Plotly), validation banner.
- **Card Search**: search box + results table; live re-query on input.
- Async pattern: long-running LLM work runs in a worker thread; UI yields `(loading=True, ...)` until result, then yields the result.
**Acceptance:** App launches with `python -m mtg_deck_builder.ui.gradio_app`, both tabs render, search returns results.

#### W5-T2 — Synergy Map + Budget Tool + Export tabs
**Goal:** Tabs 3–5.
- **Synergy Map**: NetworkX graph rendered via Plotly.
- **Budget Tool**: budget slider auto-filters search results; warns (not blocks) on over-budget.
- **Export**: dropdown for format (MTGGoldfish/Archidekt/MTGA/PDF) → "Download" button.

#### W5-T3 — UI states
**Goal:** Empty, partial, error, loading states per plan_v2 §5 question 4. No blank screens; always show something.

---

### Wave 6 — Exporters (depends on W2)

#### W6-T1 — Text exporters (`exporters/text_formats.py`)
**Goal:** Pure functions: `to_mtggoldfish(deck) -> str`, `to_archidekt(deck) -> str`, `to_mtga(deck) -> str`. Each format documented in a docstring with format spec citation.
**Acceptance:** Round-trip test for each format produces a string that includes every card.

#### W6-T2 — PDF exporter (`exporters/pdf_export.py`)
**Goal:** reportlab-based PDF with deck list + curve chart + color pie.
**Acceptance:** Generates a valid PDF >2KB containing all card names.

---

### Wave 7 — Tests (runs throughout but blocking for handoff)

#### W7-T1 — Test fixture
**Goal:** `tests/fixtures/50_real_cards.json` — 50 real Scryfall objects covering: basic land, mono-color creature, multicolor, MDFC, transform, split, planeswalker, instant, sorcery, artifact, enchantment, legendary creature (a viable commander, e.g. Atraxa).
**Acceptance:** Loads with `json.load`; passes a schema check (every object has `oracle_id`, `name`, `layout`, `legalities`).

#### W7-T2 — Unit suite
- `test_card_db.py`: ingestion, query helpers, layout filtering.
- `test_deck_rules.py`: each format has at minimum (a) valid deck passes, (b) over-size fails, (c) banned card fails, (d) commander color-identity violation fails, (e) Pauper non-common fails, (f) companion violation fails.
- `test_synergy_guardrails.py`: `validate_card_names` rejects unknowns; clamps scores; stub LLM in/out.
- `test_cache.py`: includes the **specific regression test for audit fix #6** — insert `(B,A)`, query `(A,B)`, expect hit.
**Acceptance:** `pytest -m "not integration and not slow"` → all pass, runtime <30s on a developer laptop.

#### W7-T3 — Integration & performance suites (opt-in)
- `test_integration_llm.py`: marked `@pytest.mark.integration`; runs when `MTG_RUN_INTEGRATION=1`. Loads a small GGUF, checks `analyze_synergy_batch` on 5 known pairs.
- `test_performance.py`: marked `@pytest.mark.slow`. Times validation of a 100-card Commander deck (<1s heuristic, <30s LLM); times pair-synergy on 4950 pairs.

---

### Final Verification Wave — F1–F4

Each F-task produces an explicit **APPROVE / REJECT** verdict.

#### F1 — Goal & constraint verification (oracle)
**Question:** Does the implementation honor every "MUST" and "MUST NOT" in §0, §1.4, §2 of THIS plan? Especially: Commander = 100 incl. commander; all 4 formats validate; cache key normalization fix in place.
**Pass:** All boxes in §0–§2 demonstrably satisfied by code + tests.

#### F2 — Code quality review (oracle)
**Question:** Any stubs, TODO/FIXME, anti-patterns (`except: pass`, `print` debugging, hardcoded paths, secrets)? Does it follow `engine/` vs `llm/` vs `ui/` separation?
**Pass:** Zero TODO/FIXME outside docs; zero bare excepts; LLM never imported from `engine/`.

#### F3 — QA execution
**Question:** Does `pytest -m "not integration and not slow"` pass on a clean checkout after `python install.py`? Does `python -m mtg_deck_builder.ui.gradio_app` launch and serve a working UI on localhost?
**Pass:** Both yes; screenshot/log of running UI captured.

#### F4 — Audit-defect verification
**Question:** Each of the 7 audit defects from §2 has a corresponding test or explicit code location proving it's fixed.
**Pass:** Reviewer can cite line numbers for all 7 fixes.

---

## 5. Definition of Done

The build is DONE when ALL of these are true:
1. ✅ Every W-task above is complete with its acceptance criterion met.
2. ✅ All four F-tasks return APPROVE.
3. ✅ `pytest -m "not integration and not slow"` passes in <30s on a clean install.
4. ✅ `python install.py` on a clean Windows machine produces a working environment.
5. ✅ `python -m mtg_deck_builder.ui.gradio_app` launches a 5-tab UI without errors.
6. ✅ A user can: pick Commander format → enter "Atraxa, Praetors' Voice" → set budget $100 → click Generate → receive a deck → validate it → export to MTGA format → download a PDF.
7. ✅ With NO model present (`MTG_NO_LLM=1`), the app still launches and the heuristic scorer drives synergy — no crash.
8. ✅ All 18 edge cases from plan_v2.md §9 either have a test or an explicit, documented "deferred to v2" note in README.

---

## 6. Edge-Case Coverage Map

| plan_v2 §9 case | Where handled |
|---|---|
| MDFC front/back | W2-T2 (front face for cmc; both for color identity per §1.3) |
| Companion | W2-T2 explicit check |
| Split cards | W2-T2 (union for color identity, sum for cmc) |
| Token generators | W1-T2 ingestion filter excludes tokens; generators are normal cards |
| Basic land type granted by non-basic (Urborg) | W2-T3 mana-source counter checks `type_line` for granted types |
| Colorless cards | W2-T2 allowed in any deck; tracked as `"C"` in color pie |
| Hybrid mana | W2-T2 contributes to both colors for identity |
| Phyrexian mana | W2-T2 counted as the card's color + generic |
| Planeswalker uniqueness (post-MKM) | W2-T2 allows duplicates with different names |
| Legendary rule | W2-T2 warns, doesn't block |
| Budget overrides | W5-T2 warns, doesn't block |
| Empty search | W5-T3 empty-state UI |
| LLM crash mid-generation | W4-T1 try/except → heuristic fallback |
| Hallucinated names | W4-T4 `validate_card_names` |
| DB corruption | W1-T2 WAL mode; periodic checkpoint deferred to v2 (document) |
| Decks >200 | W2-T2 cap at 250; warning |
| Special chars in names | All SQL is parameterized; JSON encoder handles unicode |
| Unicode / foreign names | Stored as-is; display localized when available (v2) |

---

## 7. Handoff Checklist (for the next agent / `/start-work`)

- [ ] Confirm Python 3.11+ is available on the build machine.
- [ ] Confirm MSVC C++ build tools available (for `llama-cpp-python`); else document install path in README.
- [ ] Start at W0-T1; each wave's tasks may run in parallel; do NOT skip waves.
- [ ] Append findings (gotchas, version mismatches, decisions) to `.sisyphus/notepads/mtg-deck-builder/learnings.md`.
- [ ] Run `pytest -m "not integration and not slow"` after EVERY wave.
- [ ] Final Wave (F1–F4) only after all W-waves complete.

---

## 8. Open Questions (none blocking — defaults assumed)

| Q | Default assumed |
|---|---|
| Use `oracle_cards` or `default_cards` bulk? | `oracle_cards` (smaller, one row per gameplay card). Switch later if per-printing data is needed. |
| LLM model default? | Phi-3-mini Q4_K_M (~2.5 GB; runs on 4 GB VRAM or CPU). Configurable via `config.yaml`. |
| PyQt6 desktop client? | Excluded from v1. Add as v2. |
| Pioneer / Legacy / Vintage / Brawl formats? | Excluded from v1 (user picked the four). Easy to add — just extend `FORMAT_RULES`. |
| Deck win-rate predictor / EDHREC integration beyond rank? | v2. |
