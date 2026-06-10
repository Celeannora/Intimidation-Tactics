# MTG Generative Deck Builder — Build Plan (Offline + Local-LLM)

> **Document type:** Engineering build plan. This is a specification/plan only — nothing here is executed.
> **Goal:** A modular, offline-first Magic: The Gathering deck builder in Python that validates decks across formats, scores card synergy with a local LLM (with a heuristic fallback), and ships with a Gradio UI.

---

## 1. Architecture Overview

**Stack**

| Concern | Choice |
|---|---|
| Language | Python 3.11+ |
| Card store | SQLite (transactional) + DuckDB (in-memory analytics) |
| Local LLM | `llama-cpp-python` loading a GGUF quantized model |
| UI | Gradio (web); optional PyQt6 desktop client |
| Charts | Plotly (curve, color pie); NetworkX (synergy graph) |
| Export | reportlab (PDF) + plain-text formats |

**Models by hardware profile**

| VRAM | Recommended GGUF |
|---|---|
| 2 GB | `phi-3-mini-4k-instruct.Q3_K_M` |
| 4 GB | `mistral-7b-instruct.Q4_K_M` |
| 8 GB+ | `llama-3-8b-instruct.Q5_K_M` |

**Modes of operation**

- **Offline-Only** — no LLM; heuristic synergy scoring only.
- **Hybrid** — LLM for deck generation, heuristic for real-time validation.
- **Full** — LLM for everything, GPU acceleration enabled.

**Project layout**

```
mtg_deck_builder/
├── engine/
│   ├── card_db.py          # SQLite schema, import, query (+ DuckDB views)
│   ├── deck_rules.py       # Format validation, banlist, color identity, curve
│   ├── synergy_scorer.py   # Heuristic (LLM-free) synergy scoring
│   └── mana_engine.py      # Curve optimization, color-source math
├── llm/
│   ├── local_llm.py        # llama-cpp wrapper, GGUF mgmt, batching, fallback
│   ├── prompt_templates.py # System/user prompts with anti-hallucination guardrails
│   └── response_parser.py  # JSON extraction + card-name validation
├── performance/
│   └── cache_manager.py    # Two-layer synergy cache (LRU memory + SQLite disk)
├── ui/
│   ├── gradio_app.py       # Primary web interface
│   ├── pyqt_app.py         # Optional desktop client
│   └── components/         # commander_tab.py, budget_tool.py, deck_viewer.py
├── data/
│   ├── raw/                # Downloaded Scryfall/MTGJSON bulk JSON
│   └── cache/              # Embedding / response caches
├── tests/
│   ├── test_card_db.py
│   ├── test_synergy.py
│   └── test_performance.py
├── config.yaml             # Model paths, format defs, budget defaults
├── requirements.txt
├── install.py
└── setup.py
```

---

## 2. Phase 1 — Data Foundation & Card Database

**Design questions**

1. Schema indexing every attribute deck building needs: `name, mana_cost, cmc, type_line, oracle_text, colors, color_identity, legalities, power, toughness, loyalty, keywords, set_name, rarity, prices (USD/EUR/TIX), edhrec_rank`. Separate tables for banlists and commander precons.
2. Incremental updates: per-card `last_updated`, diff against new Scryfall JSON, partial reloads without dropping the DB.
3. DuckDB materialized views for sub-second analytics over 25k+ cards: `vw_cards_by_color`, `vw_cards_by_cmc`, `vw_legendary_creatures`, `vw_planeswalkers`.

**Schema (`engine/card_db.py`)**

```python
import sqlite3
import duckdb
import json
from typing import List, Dict, Optional

class MagicCardDB:
    def __init__(self, db_path: str = "mtg_cards.db"):
        self.conn = sqlite3.connect(db_path)
        self.conn.execute("PRAGMA journal_mode=WAL")
        self.duck = duckdb.connect(":memory:")
        self._init_schema()

    def _init_schema(self):
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS cards (
                id TEXT PRIMARY KEY,
                name TEXT UNIQUE NOT NULL,
                mana_cost TEXT,
                cmc REAL,
                type_line TEXT,
                oracle_text TEXT,
                colors TEXT,
                color_identity TEXT,
                power TEXT,
                toughness TEXT,
                loyalty TEXT,
                keywords TEXT,
                set_name TEXT,
                rarity TEXT,
                prices_usd REAL,
                prices_usd_foil REAL,
                prices_eur REAL,
                edhrec_rank INTEGER,
                legality_standard TEXT,
                legality_commander TEXT,
                legality_modern TEXT,
                legality_pauper TEXT,
                last_updated TIMESTAMP DEFAULT CURRENT_TIMESTAMP
            );

            CREATE TABLE IF NOT EXISTS banlist (
                format TEXT,
                card_name TEXT,
                banned_since TEXT,
                PRIMARY KEY (format, card_name)
            );

            CREATE TABLE IF NOT EXISTS synergies (
                card_a TEXT,
                card_b TEXT,
                synergy_type TEXT,
                confidence REAL,
                UNIQUE(card_a, card_b)
            );

            CREATE INDEX IF NOT EXISTS idx_color_identity ON cards(color_identity);
            CREATE INDEX IF NOT EXISTS idx_cmc ON cards(cmc);
            CREATE INDEX IF NOT EXISTS idx_type ON cards(type_line);
        """)
```

---

## 3. Phase 2 — Rule Engine & Deck Validation

**Design questions**

1. `DeckRules` validates: format legality (Standard/Commander/Modern/Pauper), color-identity constraints (100-card singleton for Commander, 60-card minimum constructed), copy limits (max 4 outside basics), banlists, and set rotations by date.
2. Edge cases: Companion (6+ unique cards meeting condition), split cards (one card, two colors), MDFC (front face only for color identity), basic land types from non-basics (e.g. Urborg), token generators (tokens not required in deck).
3. Mana-curve analyzer: CMC distribution, color-source requirements (e.g. `2BB` needs ~22 black sources), color-screw risk, land-count recommendation from average CMC + ramp count.

**Validator (`engine/deck_rules.py`)**

```python
from dataclasses import dataclass
from typing import List, Set, Dict

@dataclass
class ValidationResult:
    is_valid: bool
    errors: List[str]
    warnings: List[str]
    manacurve: Dict[int, int]       # cmc -> count
    color_pie: Dict[str, int]       # color -> count
    mana_sources: Dict[str, int]    # color -> source count

class DeckRules:
    FORMAT_RULES = {
        "commander": {
            "min_size": 99, "max_size": 99, "max_copies": 1,
            "needs_commander": True, "color_identity_strict": True, "sideboard_size": 0,
        },
        "standard": {
            "min_size": 60, "max_size": None, "max_copies": 4,
            "color_identity_strict": False, "sideboard_size": 15,
        },
    }

    def validate_deck(self, cards: List[Dict], format: str, commander: str = None) -> ValidationResult:
        errors: List[str] = []
        warnings: List[str] = []

        # Companion condition
        if self._has_companion(cards):
            companion = self._get_companion(cards)
            condition = self._extract_companion_condition(companion)
            if not self._check_companion_condition(cards, condition):
                errors.append(f"Companion {companion['name']} condition not met")

        # MDFC back faces / token generators are accounted for separately
        self._count_mdfc_backfaces(cards)
        [c for c in cards if self._is_token_generator(c)]

        # Color identity (Commander)
        if commander:
            commander_colors = self._parse_color_identity(commander)
            for card in cards:
                card_colors = self._parse_color_identity(card)
                if not card_colors.issubset(commander_colors):
                    if self._is_mdfc_front(card):
                        front_colors = self._get_mdfc_front_colors(card)
                        if not front_colors.issubset(commander_colors):
                            errors.append(
                                f"Color identity violation: {card['name']} "
                                f"front face {front_colors} not in {commander_colors}"
                            )
                    else:
                        errors.append(
                            f"Color identity violation: {card['name']} "
                            f"({card_colors}) not in commander's ({commander_colors})"
                        )

        return ValidationResult(
            is_valid=len(errors) == 0,
            errors=errors,
            warnings=warnings,
            manacurve=self._compute_curve(cards),
            color_pie=self._compute_color_pie(cards),
            mana_sources=self._compute_mana_sources(cards),
        )

    def _compute_mana_sources(self, cards: List[Dict]) -> Dict[str, int]:
        """Color sources including fixing lands and mana rocks (fractional for multi-color)."""
        sources = {"W": 0.0, "U": 0.0, "B": 0.0, "R": 0.0, "G": 0.0, "C": 0.0, "multi": 0.0}
        for card in cards:
            tline = card.get("type_line", "")
            if "Land" in tline:
                produced = self._get_land_colors(card)
                for color in produced:
                    sources[color] += 1.0 / max(len(produced), 1)
            if ("Artifact" in tline or "Enchantment" in tline) and self._is_mana_source(card):
                colors = card.get("colors", "")
                if colors:
                    sources[colors[0]] += 1.0 if len(colors) == 1 else 0.5
        return {k: int(v) for k, v in sources.items()}
```

---

## 4. Phase 3 — Offline-First LLM Integration

This is the core of the project: the `llm/` package plus the synergy cache and heuristic fallback. Assumes `engine/` is already in place.

### 4.1 Design answers

- **Model management** — `llama_cpp.Llama` with `n_ctx=4096` (phi-3-mini) or `8192` (mistral); `n_gpu_layers` for GPU offload; `use_mmap=True` for fast load. Stream tokens through a thread-safe queue so the UI never blocks.
- **Structured output** — A GBNF grammar forces exactly `{"synergies":[{"card_a":str,"card_b":str,"score":float,"reason":str}, ...]}` and rejects free text. Anti-synergy is requested via scores `< 0.3` for conflicting cards.
- **Batching / caching / fallback** — Up to 100 pairs per call. Check the two-layer cache first; on any LLM failure (timeout, bad output) fall back to the keyword heuristic scorer.
- **Anti-hallucination** — Prompt includes only known card names from the DB; explicit "do not invent cards" instruction; post-process every returned name against the DB and replace unknowns with `UNKNOWN_CARD` (score `0.0`); GBNF constrains characters.

### 4.2 LLM wrapper (`llm/local_llm.py`)

```python
import json
import queue
import threading
from typing import List, Dict, Optional, Tuple

from llama_cpp import Llama
from llama_cpp.llama_grammar import LlamaGrammar

from .prompt_templates import SynergyPromptBuilder
from .response_parser import validate_card_names
from ..performance.cache_manager import SynergyCache
from ..engine.card_db import MagicCardDB

class OfflineMagicLLM:
    def __init__(
        self,
        model_path: str = "models/phi-3-mini-4k-instruct.Q4_K_M.gguf",
        db_path: str = "mtg_cards.db",
        cache_path: str = "cache/synergies.db",
        n_ctx: int = 4096,
        n_threads: int = 8,
        n_gpu_layers: int = 35,   # offload to GPU when available
    ):
        self.db = MagicCardDB(db_path)
        self.cache = SynergyCache(cache_path)
        self.prompt_builder = SynergyPromptBuilder()
        self.model = Llama(
            model_path=model_path,
            n_ctx=n_ctx,
            n_threads=n_threads,
            n_gpu_layers=n_gpu_layers,
            verbose=False,
            use_mmap=True,
        )
        self.grammar = self._load_grammar()
        self.response_queue: queue.Queue = queue.Queue()
        self.lock = threading.Lock()

    def _load_grammar(self) -> LlamaGrammar:
        """GBNF grammar that forces structured synergy JSON."""
        grammar_text = r'''
            root ::= "{" ws "\"synergies\"" ws ":" ws "[" ws synergy_pair ("," ws synergy_pair)* ws "]" ws "}"
            synergy_pair ::= "{" ws "\"card_a\"" ws ":" ws string ws "," ws "\"card_b\"" ws ":" ws string ws "," ws "\"score\"" ws ":" ws float ws "," ws "\"reason\"" ws ":" ws string ws "}"
            string ::= "\"" [^"]* "\""
            float ::= "-"? [0-9]+ "." [0-9]+
            ws ::= [ \t\n\r]*
        '''
        return LlamaGrammar.from_string(grammar_text)

    def analyze_synergy_batch(
        self, card_pairs: List[Tuple[str, str]], batch_size: int = 100
    ) -> List[Dict]:
        """Batch analysis: cache → LLM → heuristic fallback."""
        results: List[Dict] = []
        for i in range(0, len(card_pairs), batch_size):
            batch = card_pairs[i:i + batch_size]

            cached = [self.cache.get_synergy(a, b) for a, b in batch]
            valid_cached = [r for r in cached if r is not None]
            results.extend(valid_cached)

            cached_keys = {(r["card_a"], r["card_b"]) for r in valid_cached}
            uncached = [(a, b) for a, b in batch if (a, b) not in cached_keys]

            if uncached:
                try:
                    llm_results = self._llm_analyze(uncached)
                    self.cache.cache_synergy_batch(llm_results)
                    results.extend(llm_results)
                except Exception as e:
                    print(f"LLM analysis failed: {e}. Falling back to heuristic.")
                    heuristic = self._heuristic_analyze(uncached)
                    self.cache.cache_synergy_batch(heuristic)
                    results.extend(heuristic)
        return results

    def _llm_analyze(self, pairs: List[Tuple[str, str]]) -> List[Dict]:
        prompt = self.prompt_builder.build_synergy_prompt(pairs, self.db)
        response = ""
        for token in self.model(prompt, grammar=self.grammar, stream=True):
            response += token["choices"][0]["text"]
            if len(response) > 4000:   # safety limit
                break
        parsed = self._parse_json(response)
        if parsed is None:
            raise ValueError("LLM output could not be parsed as JSON")
        return validate_card_names(parsed, self.db)

    @staticmethod
    def _parse_json(text: str) -> Optional[Dict]:
        """Extract the first JSON object, tolerating trailing text."""
        start, end = text.find("{"), text.rfind("}")
        if start == -1 or end == -1 or end <= start:
            return None
        try:
            return json.loads(text[start:end + 1])
        except json.JSONDecodeError:
            return None

    def _heuristic_analyze(self, pairs: List[Tuple[str, str]]) -> List[Dict]:
        from ..engine.synergy_scorer import HeuristicScorer
        return HeuristicScorer(self.db).score_batch(pairs)
```

### 4.3 Prompt builder (`llm/prompt_templates.py`)

```python
import json
from typing import List, Tuple

from ..engine.card_db import MagicCardDB

class SynergyPromptBuilder:
    def build_synergy_prompt(self, pairs: List[Tuple[str, str]], db: MagicCardDB) -> str:
        """Build a prompt containing only known card names to prevent hallucination."""
        all_names = {name for pair in pairs for name in pair}
        valid_cards = self._get_known_cards(list(all_names), db)

        sys_msg = (
            "You are a Magic: The Gathering deck synergy analyzer. "
            "You ONLY analyze cards from this exact list (do not invent any cards):\n\n"
            f"Known cards: {json.dumps(valid_cards)}\n\n"
            "Analyze these card pairs for synergy (0.0 = no synergy, 1.0 = perfect synergy). Consider:\n"
            "- Combo potential (infinite combos, two-card combos)\n"
            "- Tribal synergy (shared creature type)\n"
            "- Mana curve interaction\n"
            "- Color fixing needs\n"
            "- Theme alignment (graveyard, artifacts, spellslinger, etc.)\n"
            "Assign anti-synergy a score below 0.3. Provide a brief reason.\n\n"
        )
        user_msg = (
            f"Pairs to analyze:\n{json.dumps(pairs)}\n\n"
            "Respond ONLY with valid JSON matching this exact schema (no other text):\n"
            '{"synergies": [{"card_a": string, "card_b": string, "score": float, "reason": string}, ...]}\n\n'
            "IMPORTANT: If a card name is NOT in the provided list, use 'UNKNOWN_CARD' and assign score 0.0."
        )
        # llama.cpp chat format (Mistral / Phi)
        return f"<s>[INST] {sys_msg}\n{user_msg} [/INST]"

    @staticmethod
    def _get_known_cards(names: List[str], db: MagicCardDB) -> List[str]:
        if not names:
            return []
        placeholders = ",".join("?" for _ in names)
        cursor = db.conn.execute(
            f"SELECT name FROM cards WHERE name IN ({placeholders})", names
        )
        known = {row[0] for row in cursor.fetchall()}
        return [n for n in names if n in known]   # preserve order
```

### 4.4 Response validation (`llm/response_parser.py`)

```python
from typing import Dict, List, Set

from ..engine.card_db import MagicCardDB

def validate_card_names(parsed: Dict, db: MagicCardDB) -> List[Dict]:
    """Replace hallucinated names with UNKNOWN_CARD and clamp scores to [0, 1]."""
    real_names = _get_all_card_names(db)
    validated: List[Dict] = []

    for item in parsed.get("synergies", []):
        card_a = item.get("card_a", "UNKNOWN_CARD")
        card_b = item.get("card_b", "UNKNOWN_CARD")
        score = item.get("score", 0.0)
        reason = item.get("reason", "")

        if card_a not in real_names:
            card_a, score = "UNKNOWN_CARD", 0.0
        if card_b not in real_names:
            card_b, score = "UNKNOWN_CARD", 0.0

        score = max(0.0, min(1.0, float(score)))
        validated.append(
            {"card_a": card_a, "card_b": card_b, "score": score, "reason": reason}
        )
    return validated

def _get_all_card_names(db: MagicCardDB) -> Set[str]:
    """All card names, memoized on the function object."""
    if not hasattr(_get_all_card_names, "cache"):
        cursor = db.conn.execute("SELECT name FROM cards")
        _get_all_card_names.cache = {row[0] for row in cursor.fetchall()}
    return _get_all_card_names.cache
```

### 4.5 Heuristic fallback (`engine/synergy_scorer.py`)

```python
from typing import List, Dict, Tuple, Optional

from ..engine.card_db import MagicCardDB

class HeuristicScorer:
    def __init__(self, db: MagicCardDB):
        self.db = db

    def score_batch(self, pairs: List[Tuple[str, str]]) -> List[Dict]:
        return [
            {"card_a": a, "card_b": b, "score": self._pair_score(a, b),
             "reason": "Heuristic fallback"}
            for a, b in pairs
        ]

    def _pair_score(self, a: str, b: str) -> float:
        card_a, card_b = self._get_card(a), self._get_card(b)
        if not card_a or not card_b:
            return 0.0

        score = 0.0
        # Shared creature type (tribal)
        if set(card_a.get("type_line", "").split()) & set(card_b.get("type_line", "").split()):
            score += 0.3
        # Keyword overlap
        if set(card_a.get("keywords", "").split()) & set(card_b.get("keywords", "").split()):
            score += 0.2
        # Ramp synergy: one low CMC, one high CMC
        cmc_a, cmc_b = card_a.get("cmc", 0), card_b.get("cmc", 0)
        if abs(cmc_a - cmc_b) >= 3 and min(cmc_a, cmc_b) <= 2:
            score += 0.2
        # Color compatibility
        colors_a, colors_b = set(card_a.get("colors", "")), set(card_b.get("colors", ""))
        if colors_a and colors_a == colors_b:
            score += 0.1
        return min(score, 1.0)

    def _get_card(self, name: str) -> Optional[Dict]:
        cursor = self.db.conn.execute(
            "SELECT name, type_line, cmc, colors, keywords FROM cards WHERE name=?", (name,)
        )
        row = cursor.fetchone()
        if not row:
            return None
        return {"name": row[0], "type_line": row[1], "cmc": row[2],
                "colors": row[3], "keywords": row[4]}
```

### 4.6 Synergy cache (`performance/cache_manager.py`)

Two layers: an in-memory LRU (10k entries, 5-min TTL) over a persistent SQLite store.

```python
import sqlite3
import threading
import time
from collections import OrderedDict
from typing import Optional, Dict, List, Tuple

class SynergyCache:
    def __init__(self, db_path: str = "cache/synergies.db",
                 memory_size: int = 10000, ttl: int = 300):
        self.conn = sqlite3.connect(db_path, check_same_thread=False)
        self.conn.executescript("""
            CREATE TABLE IF NOT EXISTS synergy_cache (
                card_a TEXT, card_b TEXT, score REAL, reason TEXT,
                cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
                PRIMARY KEY (card_a, card_b)
            );
            PRAGMA journal_mode=WAL;
        """)
        self.lock = threading.Lock()
        self.memory_cache: "OrderedDict[Tuple[str, str], Dict]" = OrderedDict()
        self.memory_size = memory_size
        self.ttl = ttl

    def get_synergy(self, card_a: str, card_b: str) -> Optional[Dict]:
        key = tuple(sorted([card_a, card_b]))

        # Memory layer
        if key in self.memory_cache:
            entry = self.memory_cache[key]
            if time.time() - entry["time"] < self.ttl:
                self.memory_cache.move_to_end(key)
                return entry["data"]
            del self.memory_cache[key]

        # Disk layer
        with self.lock:
            cursor = self.conn.execute(
                "SELECT score, reason FROM synergy_cache WHERE card_a=? AND card_b=?",
                (card_a, card_b),
            )
            row = cursor.fetchone()
            if row:
                data = {"card_a": card_a, "card_b": card_b, "score": row[0], "reason": row[1]}
                self._add_to_memory(key, data)
                return data
        return None

    def cache_synergy_batch(self, results: List[Dict]):
        with self.lock:
            self.conn.executemany(
                "INSERT OR REPLACE INTO synergy_cache (card_a, card_b, score, reason) "
                "VALUES (?, ?, ?, ?)",
                [(r["card_a"], r["card_b"], r["score"], r["reason"]) for r in results],
            )
            self.conn.commit()
        for r in results:
            self._add_to_memory(tuple(sorted([r["card_a"], r["card_b"]])), r)

    def _add_to_memory(self, key: Tuple[str, str], data: Dict):
        if len(self.memory_cache) >= self.memory_size:
            self.memory_cache.popitem(last=False)   # evict oldest
        self.memory_cache[key] = {"data": data, "time": time.time()}
```

---

## 5. Phase 4 — UI / UX (Gradio)

**Design questions**

1. Tabs: **Command Center** (deck summary, colors, curve chart), **Card Search** (Scryfall-like syntax `c:ub t:creature pow>3 cmc<=4`), **Synergy Map** (NetworkX graph), **Budget Tool** (price slider/auto-filter), **Export** (MTGGoldfish, Archidekt, MTGA, PDF). Dark mode + keyboard shortcuts.
2. Real-time validation: on add/remove, update errors, curve chart, color pie, and budget total via async callbacks so LLM work never blocks the UI.
3. **Smart Builder** flow: format + commander + budget + playstyle → query candidate cards → LLM produces 3–5 decklists with synergy explanations → user "locks" cards and requests partial regeneration.
4. UI states to handle: empty (no results), partial (half a deck), error (model crash → heuristic fallback), loading (skeleton placeholders).

**Interface skeleton (`ui/gradio_app.py`)**

```python
import asyncio
import queue
import threading

import gradio as gr

class DeckBuilderUI:
    def __init__(self, engine, llm):
        self.engine = engine
        self.llm = llm
        self.current_deck = []
        self.lock = threading.Lock()

    def build_interface(self):
        with gr.Blocks(theme=gr.themes.Soft(), title="MTG Deck Builder") as app:
            gr.Markdown("# Magic: The Gathering Deck Builder (Offline)")
            with gr.Tabs():
                with gr.TabItem("Command Center"):
                    with gr.Row():
                        format_dropdown = gr.Dropdown(
                            ["Commander", "Standard", "Modern", "Pauper"],
                            label="Format", value="Commander",
                        )
                        commander_input = gr.Textbox(
                            label="Commander (Commander format)",
                            placeholder="e.g., Atraxa, Praetors' Voice",
                        )
                        budget_slider = gr.Slider(0, 500, value=100, label="Budget ($)")
                    deck_size = gr.Number(label="Current Deck Size", value=0)
                    generate_btn = gr.Button("Generate Decks")

            # Streaming Smart Builder: run generation off-thread, yield progress to UI.
            async def generate_decks(fmt, commander, budget, playstyle, theme):
                result_queue: queue.Queue = queue.Queue()

                def worker():
                    try:
                        result_queue.put(self.llm.generate_deck_lists(
                            format=fmt, commander=commander, budget=budget,
                            playstyle=playstyle, theme=theme, num_options=3,
                        ))
                    except Exception as e:
                        result_queue.put(f"ERROR: {e}")

                thread = threading.Thread(target=worker)
                thread.start()
                while thread.is_alive():
                    yield gr.update(visible=True)   # loading indicator
                    await asyncio.sleep(0.5)
                decks = result_queue.get()
                yield decks

        return app
```

---

## 6. Phase 5 — Testing & Edge-Case Coverage

**Goals**

1. **Integration** — load a subset of real cards, build a valid Commander deck (e.g. Atraxa), confirm it passes, then mutate it to fail on color identity, deck size, and copy limits.
2. **Hallucination** — feed fake card names and assert `UNKNOWN_CARD` + score `0.0` for 100% of fakes.
3. **Performance** — validation time for a 100-card deck; full pair-synergy time (4,950 pairs); memory at 4k context; search speed over 25k cards.

**Hallucination & validation tests (`tests/test_synergy.py`)**

```python
import pytest

from llm.local_llm import OfflineMagicLLM
from engine.card_db import MagicCardDB
from engine.deck_rules import DeckRules

class TestHallucination:
    @pytest.fixture
    def llm(self):
        return OfflineMagicLLM(
            model_path="models/phi-3-mini-4k-instruct.Q4_K_M.gguf", n_gpu_layers=0
        )

    @pytest.fixture
    def db(self, tmp_path):
        db = MagicCardDB(str(tmp_path / "test.db"))
        db.import_bulk("tests/fixtures/50_real_cards.json")
        return db

    def test_all_fake_pairs_return_unknown(self, llm, db):
        pairs = [("Totally Real Card", "Another Fake One"), ("Fake1", "Fake2")]
        results = llm.analyze_synergy_batch(pairs)
        assert len(results) == 2
        for r in results:
            assert r["card_a"] == "UNKNOWN_CARD" or r["card_b"] == "UNKNOWN_CARD"
            assert r["score"] == 0.0

    def test_mixed_real_fake(self, llm, db):
        db.conn.execute("INSERT INTO cards (id, name, type_line) VALUES ('x','Black Lotus','Artifact')")
        results = llm.analyze_synergy_batch([("Black Lotus", "FakeCard")])
        r = results[0]
        assert r["card_a"] == "Black Lotus"
        assert r["card_b"] == "UNKNOWN_CARD"
        assert r["score"] == 0.0

class TestDeckValidation:
    def test_edge_cases(self, tmp_path):
        from tests.helpers import make_card
        rules = DeckRules()

        # Empty deck fails on size
        result = rules.validate_deck([], "commander")
        assert not result.is_valid
        assert any("size" in e.lower() for e in result.errors)

        # Companion (Lutri) requires a singleton deck; duplicate Counterspell breaks it
        deck = [
            make_card(name="Lutri, the Spellchaser", type="Creature", colors="UR"),
            make_card(name="Counterspell", type="Instant", colors="U"),
            make_card(name="Counterspell", type="Instant", colors="U"),
        ]
        result = rules.validate_deck(deck, "commander", commander="Lutri, the Spellchaser")
        assert not result.is_valid
        assert "companion" in result.errors[0].lower()
```

**Performance benchmark (`tests/test_performance.py`)**

```python
import time

from llm.local_llm import OfflineMagicLLM
from engine.card_db import MagicCardDB

def test_synergy_100_card_deck():
    db = MagicCardDB("mtg_cards.db")   # full ~25k DB
    llm = OfflineMagicLLM()
    cursor = db.conn.execute("SELECT name FROM cards ORDER BY RANDOM() LIMIT 100")
    deck = [row[0] for row in cursor.fetchall()]
    pairs = [(deck[i], deck[j]) for i in range(len(deck)) for j in range(i + 1, len(deck))]

    start = time.time()
    results = llm.analyze_synergy_batch(pairs, batch_size=100)
    elapsed = time.time() - start

    assert len(results) == 4950   # C(100, 2)
    print(f"Synergy analysis of 100-card deck (4950 pairs): {elapsed:.2f}s")
```

---

## 7. Phase 6 — Performance & Deployment

- **DuckDB analytics** — load the SQLite card DB into DuckDB at startup; materialize aggregations (avg color use in winning commander decks, top-archetype curves); cache results ~5 minutes.
- **Quantization strategy** — pick GGUF by VRAM (see §1); always stream tokens off the UI thread.
- **Caching layers** — LRU for synergy results (10k entries, auto-evict), disk cache for LLM responses (`cache/llm_responses.db`), query cache for expensive DB queries.

---

## 8. Phase 7 — Packaging & Distribution

**Dependencies (pinned for reproducibility)**

```
gradio==4.0.0
llama-cpp-python==0.2.26
duckdb==0.9.0
plotly==5.17.0
networkx==3.1
reportlab==4.0
requests-cache==1.1
pandas==2.1.0
```

**One-shot installer (`install.py`)** — creates a venv, installs pinned deps (note: `llama-cpp-python` may need C++ build tools), downloads the default GGUF model, and prompts to seed the card DB.

```python
#!/usr/bin/env python3
"""One-shot installer for MTG Deck Builder."""
import subprocess
import sys
from pathlib import Path

def main():
    print("Installing MTG Deck Builder...")

    venv = Path(".venv")
    if not venv.exists():
        subprocess.run([sys.executable, "-m", "venv", str(venv)], check=True)
        print("Virtual environment created")

    requirements = [
        "gradio==4.0.0", "llama-cpp-python==0.2.26", "duckdb==0.9.0",
        "plotly==5.17.0", "networkx==3.1", "reportlab==4.0",
        "requests-cache==1.1", "pandas==2.1.0",
    ]
    pip = venv / ("Scripts/pip.exe" if sys.platform == "win32" else "bin/pip")
    subprocess.run([str(pip), "install", *requirements], check=True)
    print("Dependencies installed")

    model_dir = Path("models")
    model_dir.mkdir(exist_ok=True)
    model_path = model_dir / "phi-3-mini-4k-instruct.Q4_K_M.gguf"
    if not model_path.exists():
        print("Downloading default LLM model (Phi-3-mini Q4, ~2.5GB)...")
        from huggingface_hub import hf_hub_download
        hf_hub_download(
            repo_id="microsoft/Phi-3-mini-4k-instruct-gguf",
            filename="Phi-3-mini-4k-instruct.Q4_K_M.gguf",
            local_dir=str(model_dir),
        )
        print("Model downloaded")

    if not Path("data/raw").exists():
        print("Run 'python mtg_deck_builder/engine/card_db.py --download' to seed the card database.")

    print("\nInstallation complete. Run 'python mtg_deck_builder/ui/gradio_app.py' to start.")

if __name__ == "__main__":
    main()
```

---

## 9. Edge-Case Checklist

| Edge case | Handling |
|---|---|
| MDFC front/back face | Only front face counts for color identity and deck size |
| Companion mechanic | Validate companion condition against the entire deck |
| Split cards | Count as one card; both colors contribute |
| Token generators | Tokens not required in deck; generators count as cards |
| Basic land type in non-basics (Urborg) | Mana-source calculator accounts for granted land types |
| Colorless cards | Allowed in any deck; counted as "C" |
| Hybrid mana symbols | Contribute to both colors for identity |
| Phyrexian mana | Counted as the card's color and generic |
| Planeswalker uniqueness | Allow duplicates with different names (post-MKM rules) |
| Legendary rule | Warn on duplicate legends; do not block (player choice) |
| Budget overrides | Priority: viability > budget — warn, don't block |
| Empty search results | Show "No cards found" with suggestions |
| LLM crash mid-generation | Return partial results + heuristic fallback |
| Hallucinated card names | DB lookup → replace with `UNKNOWN_CARD` |
| DB corruption on power loss | WAL mode + periodic checkpoints |
| Very large decks (>200) | Cap at 250; show performance warning |
| Special symbols in names | Escape for SQL and JSON |
| Unicode / foreign names | Store as-is; display localized when available |

---

## 10. Summary Brief (for an AI coding agent)

1. Build a modular, offline-first MTG deck builder in Python with 7 core modules: card DB (SQLite + DuckDB), rule engine (format validation, color identity, mana curve), LLM integration (`llama-cpp-python`, GBNF grammar, hallucination guardrails), synergy analyzer (batching, caching, heuristic fallback), UI (Gradio, 5 tabs), exporter (multiple formats), and a test suite (integration, hallucination, performance).
2. Implement real-time validation that updates as cards change, supporting Commander, Standard, Modern, and Pauper, and handling the 18 edge cases in §9.
3. Use the LLM for intelligent generation: playstyle analysis, synergy scoring, anti-synergy detection, budget optimization. Cache all results (SQLite + LRU). Fall back to the keyword heuristic when the LLM is unavailable.
4. Ensure every UI component handles loading / empty / error / partial states, streams LLM output without blocking, and exports to MTGGoldfish, Archidekt, MTGA, and PDF.
