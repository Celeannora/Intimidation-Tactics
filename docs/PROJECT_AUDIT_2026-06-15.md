# Intimidation-Tactics — Full Project Audit (Code-Grounded, Corrected)

> **Date:** 2026-06-15
> **Scope:** Whole repository — engineering quality AND product/competitive readiness
> **Method:** Direct source review + running the test suite (308/308 pass) + tracing the generator, scoring, AI, and meta paths to real code.
> **Note on revision:** This version **corrects two wrong claims** from my first pass (I asserted "no AI validation/fallback" and "thin/inverted test coverage" without running the suite — both were wrong). It also adds the thing the first pass missed entirely: **product readiness ≠ engineering readiness.**

---

## The honest headline

If the question is *"would an experienced Standard player trust this to build competitive decks today?"* — **no.**

Not because the engineering is bad (it's genuinely good), but because the product's **"intelligence" is heuristic and EDH-derived, not Standard-competitive**, and **nothing in the system validates that a generated deck is actually *good* — only that it's *legal and structurally sane*.** An experienced player judges by output quality; this tool can't yet demonstrate output quality, and its scoring would visibly misvalue cards.

**Two separate verdicts:**
- **Engineering readiness: 🟢 strong.** Clean architecture, 317 passing tests, real math, robust AI parsing/fallback.
- **Competitive-product readiness: 🟡 in progress.** Phase 1 of the remediation (competitive-data scoring anchor) is now shipped; meta-awareness and deck-quality acceptance remain.

---

## Remediation status (live)

| Phase | Scope | Status |
|---|---|---|
| **P1 — Competitive scoring anchor** | Bundled competitive snapshot (`standard-snapshot.json`) → `competitivePower.ts` → blended `computePowerScore` (`0.8·competitive + 0.2·heuristic`) wired into `scoreEngine.ts` | ✅ **Shipped** — 9 new tests, **317/317 pass**, typecheck + lint clean. Heuristic retained as fallback for cards absent from the snapshot. |
| **P2 — Meta subsystem** | Wire `metaTargets` into scoring, replace placeholder counter-analysis `score: 1`, implement remote snapshot refresh | ⏳ Planned |
| **P3 — Deck-quality acceptance** | Generator-on-real-pool tests asserting curve/interaction/skeleton overlap + scoring golden file | ⏳ Planned |
| **P4 — In-app honesty** | Label scoring/meta as "experimental" in the UI | ⏳ Planned |

> **Note on P1:** The bundled snapshot ships as an honest *sample* (see its `source` field) and must be replaced/augmented with aggregated top-decklist data to be fully trustworthy. The mechanism — real competitive signal dominating the dominant scoring term, with safe heuristic fallback — is now in place and tested.

---


## Corrections to my earlier audit (owning the mistakes)

| Earlier claim | Reality (verified) |
|---|---|
| "No enforced AI output validation / fallback" | **Wrong.** `aiGenerator.ts` `buildResultFromAIResponse()` parses JSON, strips code fences, resolves names against the pool, **drops hallucinated cards**, and hands picks to the deterministic generator which **gap-fills to a legal 60**. Smoke tests prove: *"hallucinated names → dropped, gap-filled to legal 60"* and *"malformed/truncated JSON → does not crash, still legal 60."* |
| "Thin / inverted test coverage" | **Overstated.** 308 tests across 26 files, including hypergeometric (26), legality (28), Karsten, mana, hand simulator, generator pipeline, and AI-with-mock-provider. The real gap isn't *quantity* — it's that tests assert **legality/structure, never competitiveness**. |
| "Green-Amber, ship-capable" | **Misleading.** That graded engineering hygiene and silently implied product readiness. Corrected above. |

---

## What's genuinely strong (verified)

- **Math is tested against known values:** `hypergeometric.test.ts` (26), `karsten.test.ts`, `mana.test.ts`, `handSimulator.test.ts` (19). Probability/mana math appears trustworthy.
- **Legality engine is well-covered:** `legality.test.ts` (28 tests) — companions, copy limits, format checks.
- **AI path is robust, not fragile:** validates, drops hallucinations, gap-fills to legal 60, degrades gracefully on malformed output.
- **Tests run on a real (trimmed) Standard pool:** `src/test/fixtures/standard-pool.json` ≈ 420 real Standard-legal cards (via the app's own `toCardRecord` mapper), with W/U/B/R/G all represented.
- **Architecture/tooling:** clean lib/UI split, strict CI (typecheck-before-build, zero-warning lint), worker-based import, AI provider abstraction.

---

## The real problems an experienced player would hit

### P1 — Card "power" scoring is heuristic guesswork with no competitive anchor *(this is the dealbreaker)*
`powerScore.ts` computes quality from: `gameChanger` flag (+12), rarity (mythic +10…), `edhrecRank` (<500 → +12…), and generic cmc/type bonuses. The file header admits it's heuristics over `edhrecRank, rarity, game_changer, cmc, type line`.
- **`edhrecRank` is Commander popularity**, not Standard power. **Rarity ≠ power.** `gameChanger` is an EDH-oriented flag.
- Consequence: the engine **overrates big-stat mythics and generically "splashy" cards**, and **underrates format-defining commons/uncommons whose power lives in subtle text** (efficient removal, cheap interaction, enablers). An experienced player will spot nonsense valuations within minutes.
- The layer that *could* add real signal (the meta subsystem) is **never wired in** (passed `undefined`).
→ **Recommendation:** Anchor scoring to real competitive signal (play-rate / top-decklist presence per format), even as a bundled dataset; stop using EDHREC/rarity as power proxies for Standard; validate scores against a handful of known top decks.

### P2 — Meta-awareness is a documented no-op scaffold
Per `docs/META.md` and code: `metaTargets` is a **no-op** (writes a reasoning line only); counter-analysis posture is a "naive speed/macro heuristic" returning placeholder `score: 1`; the metagame is a **hand-edited JSON snapshot** with a `null`-returning remote-refresh stub — stale the moment a set or ban lands.
→ **Recommendation:** Either finish it (wire `metaTargets` into scoring, implement real counter-analysis and refresh) or **stop advertising "meta-aware"** until it does something.

### P3 — "Valid deck" means *legal*, not *good*
Smoke/generator tests assert deck-size, legality, color/curve sanity — **never power or win-rate**. "Generates a valid deck — Aggro mono-R / Midrange BG / Control WU" = 60 legal cards with a plausible curve, not a deck a competitive player would sleeve.
→ **Recommendation:** Add output-quality benchmarks — generate against the real pool and diff results against known-good archetype skeletons; have a strong player score sample outputs; treat that as the real acceptance test.

### P4 — The "AI" largely defers to the deterministic generator
The AI proposes cards, but `generateOffline()` does the real construction and gap-filling. So AI quality is bounded by the same heuristic engine; the "AI" is partly a flavor layer over heuristic deckbuilding. Honest, but worth not over-selling.

---

## Engineering issues still worth doing (unchanged, lower urgency)

- **`GeneratorPanel.tsx` ~1,637 lines** — extract logic to `lib/`, split components.
- **Main-thread heavy work** — generator/synergy graph run on the UI thread; the locked-spine test took ~3.4s, a hint that real-pool generation is non-trivial. Profile; consider a worker.
- **Bulk import** reads whole file (`importWorker.ts:24,34`) + single `clear()`+`bulkPut` transaction (`db.ts`) — chunk + batch for low-RAM devices.
- **DB schema** versioned (v1–v3) but undocumented; add `DATABASE_SCHEMA.md` + migration tests.
- **Security:** API keys in `localStorage`, sent Bearer from the browser — disclose + CSP.
- **Tooling:** verify `globals: "^17.6.0"` resolves (`package.json:39`); add `engines` for Node 18+.
- **Docs:** PWA lifecycle + ADRs.

---

## Bottom line

- **Trust today:** legality checking, mana/probability math, hand simulation. These are tested and sound.
- **Don't trust yet:** card power scores, "meta" targeting/counters, and the claim that a generated deck is competitive.
- **To earn an experienced player's trust:** anchor scoring to real format data, finish or remove the meta subsystem, and add output-*quality* acceptance tests — not just legality invariants.

The engineering is good enough to *support* a competitive tool. It is not yet a competitive tool.
