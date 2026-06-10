# Draft: MTG Generative Deck Builder (Offline + Local-LLM)

## Source
- Derived from `plan_v2.md` (827-line spec). User wants a decision-complete EXECUTION plan that resolves audit gaps.

## Requirements (confirmed)
- Offline-first MTG deck builder, Python 3.11+
- Formats: **All four** — Commander, Standard, Modern, Pauper (must be fully specified, not just claimed)
- Data source: **Scryfall bulk JSON** (default_cards), implement a real downloader + schema mapping
- Card store: SQLite (transactional) + DuckDB (analytics)
- Local LLM: llama-cpp-python + GGUF, with heuristic fallback
- UI: Gradio (5 tabs); PyQt6 optional
- Export: MTGGoldfish, Archidekt, MTGA, PDF (reportlab)
- Synergy scoring: LLM + GBNF-constrained JSON + hallucination guardrail + heuristic fallback
- Two-layer cache (LRU mem + SQLite disk)
- Tests: integration, hallucination (unit-level on guardrail), performance

## Audit gaps to RESOLVE in plan (from review)
1. Commander size bug: must be 100 incl. commander (99 + 1), not min/max 99. FIX.
2. Modern + Pauper rules undefined though claimed — define fully (sizes, copies, Pauper commons-only, banlist source).
3. Hallucination test loads real GGUF → make it a UNIT test against `validate_card_names` with a stub; keep model-loading test as opt-in integration marker.
4. Data ingestion undefined (no URL/fetch/mapping) — specify Scryfall bulk endpoint + field mapping.
5. Stale/risky pinned deps — re-pin to current, enforce Python version, handle llama-cpp build tools.
6. Cache key bug: disk layer queries unsorted card_a/card_b while memory sorts — normalize key on BOTH layers. FIX.
7. Missing Definition of Done, dependency/wave ordering, per-task acceptance criteria + agent-executable QA.

## Technical Decisions
- Banlist: use Scryfall `legalities` object (legal/not_legal/banned/restricted) instead of hand-maintained banlist table (pending librarian confirm).
- Color-identity / size: canonical rules pending librarian confirm.
- Cache key: `tuple(sorted([a,b]))` everywhere; store normalized in disk too.

## Research Findings (pending)
- [librarian bg_f3fb690c] Scryfall bulk API shape + card fields — PENDING
- [librarian bg_0f421478] Format construction rules (all 4) + banlist sourcing — PENDING

## Open Questions
- (resolved via Question tool: intent, formats, data source)

## Scope Boundaries
- INCLUDE: all 4 formats, Scryfall ingestion, LLM + heuristic, Gradio UI, exports, tests, packaging
- EXCLUDE (default unless user says otherwise): PyQt6 desktop client = OPTIONAL/stretch, not a blocking task
