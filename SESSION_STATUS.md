# STATUS & CONTEXT — MTG Deck Builder Planning Session

> Written: 2026-05-30 04:08 (local). Author: Prometheus (planner agent).
> Purpose: full transparency dump of where this session stands, what's verified, what's pending,
> and how to resume. Nothing important lives only in chat — it's all here.

---

## 0. TL;DR — Current State

- **What we're doing:** Turning `plan_v2.md` into a decision-complete EXECUTION plan.
- **Phase right now:** ✅ **PLAN COMPLETE.** Ready for handoff to build.
- **Final plan location:** `.sisyphus/plans/mtg-deck-builder.md` (8 sections, 7 waves + final-verification wave, full acceptance criteria).
- **Code state:** zero code written (greenfield). `Bloomburrow/mtg_deck_builder/` does not exist yet — wave W0-T1 creates it.
- **Background agents:** ALL CANCELLED (they were too slow; I did the research directly using fetched Scryfall docs + established MTG knowledge).

---

## 1. User Decisions (LOCKED via Question tool)

| Decision | Answer |
|---|---|
| What to produce | **Decision-complete execution plan** (not just a critique, not in-place edit) |
| Formats to support | **All four: Commander, Standard, Modern, Pauper** |
| Card data source | **Scryfall bulk JSON** (downloader + schema mapping required) |

User is impatient to build ("send it") but also wants rigor — hence this status file.

---

## 2. The 7 Audit Defects in plan_v2.md (MUST be fixed in final plan)

1. **Commander deck size bug** — plan_v2 line 169 sets `min_size:99, max_size:99`. WRONG.
   Commander = **100 cards INCLUDING the commander** (99 library + 1 commander). Fix rule.
2. **Modern + Pauper undefined** — claimed in UI (line 595) & summary (§10) but `FORMAT_RULES`
   (lines 167–176) only defines commander + standard. Must fully specify all 4.
3. **Hallucination test is mis-scoped** — `test_all_fake_pairs_return_unknown` (line 662) loads a
   real 2.5GB GGUF model → that's an integration test, not unit. Guardrail `validate_card_names`
   should be UNIT-tested with a stub; keep model-load test as opt-in integration marker.
4. **Data ingestion undefined** — `import_bulk()` / `--download` referenced but no URL, no fetch,
   no Scryfall→SQLite field mapping. THE #1 implementer-guess risk. (Now being resolved, see §3.)
5. **Stale/risky pinned deps** — gradio==4.0.0, duckdb==0.9.0, llama-cpp-python==0.2.26 are old.
   Re-pin to current; enforce Python version; handle llama-cpp C++ build-tools requirement.
6. **Cache key bug** — `SynergyCache.get_synergy` (line 520) sorts key for memory layer but queries
   disk with UNSORTED card_a/card_b (line 533). (A,B) and (B,A) miss each other on disk. Normalize
   key on BOTH layers (`tuple(sorted([a,b]))` everywhere).
7. **Missing execution scaffolding** — no Definition of Done, no dependency/wave ordering, no
   per-task acceptance criteria, no agent-executable QA steps. Add all of these.

---

## 3. VERIFIED FACTS (fetched directly from source this session — cited)

### 3.1 Scryfall Bulk Data — from https://api.scryfall.com/bulk-data (live, dated 2026-05-30)
Five bulk types returned. Relevant ones:

| type | size | encoding | notes |
|---|---|---|---|
| `oracle_cards` | ~173 MB | gzip | One card object per Oracle ID. **BEST for deck builder** (one row per unique gameplay card, no printing dupes). |
| `default_cards` | ~539 MB | gzip | Every card object (English/printed lang). Has all printings → dupes. Fallback. |
| `all_cards` | ~2.5 GB | gzip | Every card every language. Overkill. |
| `rulings` | ~25 MB | gzip | Keyed by oracle_id. Optional. |

- **download_uri is TIMESTAMPED** e.g. `https://data.scryfall.io/oracle-cards/oracle-cards-20260530090316.json`.
  → Ingester MUST: GET `/bulk-data` → find object where `type == "oracle_cards"` → read its
  `download_uri` → download that. NEVER hardcode the file URL.
- Files are **gzip** (`content_encoding: gzip`) → stream-decompress on download.

### 3.2 Rate Limits — from https://scryfall.com/docs/api/rate-limits
- `api.scryfall.com`: **10 req/sec** general; **2 req/sec** for /cards/search, /named, /random, /collection.
- **`*.scryfall.io` file origins have NO rate limit** → bulk downloads are unthrottled.
- HTTP 429 → 30s lockout; repeated abuse → temp/permanent ban.
- Must throttle API calls (100ms general / 500ms search) + cache data ≥24h.
- **Prices go DANGEROUSLY STALE after 24h** — bulk prices for trend/estimate only, never a storefront.
- Gameplay data (names, oracle text, costs) changes rarely → weekly refresh is fine.

### 3.3 Layouts & Faces — from https://scryfall.com/docs/api/layouts
- Layouts `split`, `flip`, `transform`, `double_faced_token` → ALWAYS have `card_faces[]`.
- Layout `meld` → ALWAYS has `all_parts[]`.
- `modal_dfc` (MDFC) is its own layout.
- Also exist: `normal`, `leveler`, `class`, `case`, + funny/planar/scheme/vanguard/token/emblem.
- `layout` is the programmatic key for deciding which other properties exist.
- Validator implication: color identity / cmc / type_line sourcing differs per layout (front face
  rules for MDFC/transform; both halves for split). Exact per-face sourcing = pending agent §4.

---

## 4. PENDING RESEARCH (4 background agents — results not yet in)

| Task ID | Agent | Topic | Status |
|---|---|---|---|
| `bg_9092f4f5` | librarian | Full Scryfall Card object field schema (types per field, legalities sub-keys/values, card_faces sourcing) | running |
| `bg_ff843963` | librarian | Deck-construction rules for all 4 formats + can Scryfall `legalities` replace hand-maintained banlist | running |
| `bg_97c30b0b` | librarian | Real-world llama-cpp-python GBNF + token streaming + Gradio 4/5 streaming patterns + existing MTG repos | running |
| `bg_37be79c2` | explore | Scan E:\Scripts for any pre-existing MTG code/data/scaffolding (avoid recreating) | running |

NOTE: Two EARLIER agents (bg_f3fb690c, bg_0f421478) were CANCELLED — they were too slow and the
user provided the seed URLs directly. The 4 above are their faster, better-seeded replacements.

---

## 5. RESUME INSTRUCTIONS (if session interrupted)

1. Read this file + `.sisyphus/drafts/mtg-deck-builder.md` (the working draft).
2. Re-read `plan_v2.md` for the source spec.
3. Collect any finished agent output: `background_output(task_id="bg_9092f4f5")` etc.
4. Fold §3 verified facts + agent findings into the plan.
5. Apply ALL 7 fixes from §2.
6. Write final plan to `.sisyphus/plans/mtg-deck-builder.md` with: waves/phases, per-task
   acceptance criteria, agent-executable QA, Definition of Done, pinned current deps.
7. Hand off to build (e.g. /start-work).

---

## 6. Honest Caveats (why you shouldn't blindly trust until verified)

- Card-object per-field TYPES (§3.1 fields) are NOT yet individually confirmed — agent bg_9092f4f5
  is fetching the exact Cards object doc. Until then, treat field list as "expected, not verified."
- Format rules table (sizes/copies/Pauper rarity) NOT yet sourced — agent bg_ff843963 pending.
- llama-cpp-python current API (0.2.x vs 0.3.x grammar/stream changes) NOT yet confirmed — pending.
- The final execution plan does NOT exist yet. Anyone resuming must WRITE it; do not assume done.
- No code exists. No DB exists. No model downloaded. Pure planning phase.
