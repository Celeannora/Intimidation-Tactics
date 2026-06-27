# Deep Planning: sonar.md → Current State Gap Analysis
**For use with an AI coding model in ACT mode**  
**Generated:** 2026-06-27  
**Scope:** Map the 9-part Perplexity research spec (sonar.md) against the Intimidation-Tactics codebase, identify every implementation gap, and produce a prioritised, self-contained task list for an AI coding agent.

---

## 0. Executive Summary

`sonar.md` is a research brief that prescribes **what a mythic-viable MTG deck generator must know and do**. The codebase has implemented a significant share of the spec — role taxonomy, synergy axes, mana base logic, archetype detection, AI pipeline, mythic viability scoring — but several high-value prescriptions from the spec are missing or only partially realised. The following sections map each sonar.md part to its implementation status and produce discrete, file-level coding tasks.

---

## 1. sonar.md Part 1 — "What Mythic Viable Actually Means"
### Spec prescriptions
- MMR math: top ~2% of Arena ladder corresponds to roughly 55–61% sustained win rate.
- Three pillars: **consistency** (drawing the right card at the right time), **redundancy** (4-ofs of key roles), **meta positioning** (choosing matchup-favourable strategy).
- Generator must target this threshold, not just "build a legal deck."

### Current implementation
- `MythicViabilityPanel.tsx` + `mythicViability` field on `GenerateResult` — badge labels (tier-1 / mythic-viable / fringe / not-viable), winRateEstimate, score/100 scale. ✅ exists
- `scoreBreakdown`, `diagnostics.deckScore` — score drives viability labelling. ✅
- Win-rate estimate is a linear interpolation from deckScore, not grounded in the actual hypergeometric/MMR math from sonar.md. ⚠️ **gap**
- Consistency is implicit in mana coverage and curve deviation but is not a first-class, displayed metric. ⚠️ **gap**
- Redundancy (4-ofs for key roles) is evaluated in `weights.ts` copy-count scoring but the generator is not explicitly required to maximise 4-ofs of role-critical cards. ⚠️ **gap**

### Tasks
**T1.1** — In `src/lib/generator/weights.ts` (or a dedicated `src/lib/generator/viabilityModel.ts`), replace the current linear `deckScore → winRate` formula with the MMR-calibrated sigmoid that maps:
- score ≤ 50 → ~45% WR
- score 65 → ~52% WR (threshold for Platinum)
- score 78 → ~56% WR (Mythic viable)
- score 90+ → ~60%+ WR (Tier 1)
Document the calibration constants and their empirical basis in a code comment.

**T1.2** — Add a `consistencyScore: number` field to `GenerateResult` (0–100), calculated from:  
`P(have a role-4-of on curve) = hypergeometric(deck=60, having≥1 of 4-of by turn N)`. For each key role slot (removal, threat, engine), compute the p(have ≥1 copy in opening 7+N draws). The consistency score is the geometric mean across role slots. Expose it in `MythicViabilityPanel`.

**T1.3** — In `src/lib/generator/generator.ts`, add a post-generation check: if any role slot (Threat, Removal, Engine per `assignRoles`) has fewer than 4 copies across all mainboard cards of that role, log a diagnostic reasoning line: `"Warning: [Role] slot has only N copies — recommend 4+ for Mythic reliability"`.

---

## 2. sonar.md Part 2 — "Universal Construction Mathematics"
### Spec prescriptions
- **Rule of 9**: 9 four-ofs is the baseline for a consistent aggressive/midrange deck.
- **Frank Karsten mana model**: for a spell with pip cost X/Y, you need at minimum `ceil(17 * X/Y)` sources of that colour in a 60-card deck.
- **Curve targets by archetype**: Aggro peaks at 1–2 CMC; Midrange at 2–3; Control at 2–4; Ramp at 1–2 + 5+.
- **Hypergeometric draw table**: probability of drawing at least 1 copy of an N-of by turn T.
- **Sideboard theory**: 3-ofs for answers to top-2 meta threats; 2-ofs for flex slots.

### Current implementation
- Mana base builder exists in `src/lib/generator/manaBase.ts` — computes land counts from colour pips. Partially implements Karsten model. ⚠️ **partial**
- Curve targets encoded in `archetypeProfiles.ts` as `curveWeights`. ✅ exists
- No hypergeometric probability calculations exposed to the user or to diagnostics. ❌ **missing**
- Sideboard generation exists (`generateSideboard` flag) but the 3-of/2-of slot theory is not implemented. ⚠️ **gap**
- Rule of 9 is not enforced or displayed anywhere. ❌ **missing**

### Tasks
**T2.1** — Create `src/lib/math/hypergeometric.ts`:
```typescript
/**
 * Probability of drawing at least `successes` copies of a card
 * that appears `copies` times in a `deckSize`-card deck,
 * after drawing `draws` cards (opening hand + N turns).
 */
export function pAtLeast(copies: number, deckSize: number, draws: number, successes = 1): number
```
Use the exact hypergeometric PMF (no approximation for small decks). Export a helper `pByCurve(copies, cmc, archetype)` that calculates P(have at least 1 copy by the card's CMC turn) for standard 60-card decks.

**T2.2** — In `src/lib/generator/manaBase.ts`, audit the source-count formula against Karsten's exact table. For a card with cost `{1}{U}{U}`, require 17 blue sources minimum (not 14 or 20). Document the formula with a code comment citing Karsten's article. Add unit tests in `src/__tests__/manaBase.test.ts` using the canonical Karsten table values (e.g., 1-pip at 1-drop needs 14 sources; 2-pip at 2-drop needs 20 sources).

**T2.3** — In `src/lib/generator/diagnostics.ts` (create if absent), add a `ruleOfNineCompliance(entries)` function that returns the count of 4-of groups in the mainboard nonland pool. Surface this as `diagnostics.fourOfGroups` on `GenerateResult` and display it in `GeneratorPanel.tsx` diagnostics grid.

**T2.4** — In the sideboard planner (wherever `generateSideboard` is implemented), enforce: if a role type (e.g., graveyard hate, enchantment removal) has ≤2 cards in the sideboard, recommend at least 3 copies. Log this as a diagnostic recommendation.

---

## 3. sonar.md Part 3 — "Core Strategic Concepts"
### Spec prescriptions
- **Tempo**: mana efficiency ratio (damage/mana or board presence/mana spent). Generator should track "tempo score."
- **Card advantage**: card parity, raw CA (2-for-1s, draw triggers), virtual CA (recursion, versatile spells). Generator weights should reflect CA premium.
- **Threat/interaction ratio**: by archetype — Aggro 20–22 threats / 12–14 interaction; Midrange 14–16 / 12–14; Control 8–10 / 22–26.

### Current implementation
- `tempoScore` field on `GenerateResult` ✅ exists (populated from `diagnostics`)
- `cardAdvantageScore` on `GenerateResult` ✅ exists
- Threat/interaction ratios enforced via `archetypeProfiles.ts` role budgets. ✅ partial
- Neither `tempoScore` nor `cardAdvantageScore` are computed from card-level oracle data — they appear to be computed from aggregate diagnostics. Unclear if they match sonar.md definitions. ⚠️ **audit needed**

### Tasks
**T3.1** — Audit `tempoScore` calculation: confirm it uses mana-efficiency data (e.g., `powerScore / cmc` weighted for creatures; instant-speed premium for interaction). If it is currently a simple aggregate, rewrite it to implement the sonar.md definition: `sum over nonlands of (powerScore / cmc) * tempoMultiplier[typeLine]`, where creatures at CMC≤2 get ×1.3 and sorceries at CMC≥4 get ×0.8.

**T3.2** — Add explicit **threat/interaction ratio validation** to the generator's post-build diagnostic pass. For each archetype, compare the built deck's actual role distribution against the sonar.md targets. If off by more than ±4 cards, append a diagnostic line: `"Interaction count N falls outside [archetype] target range [min–max] — consider adding removal"`.

---

## 4. sonar.md Part 4 — "Archetype-by-Archetype Analysis"
### Spec prescriptions
Aggro, Midrange, Control, Combo (Izzet Cauldron/Vivi case study), Delirium/Graveyard, Tempo, Tokens — each with **why specific cards are chosen** spelled out as scoring axioms, not just card lists.

### Current implementation
- `archetypeProfiles.ts` encodes role budgets per archetype. ✅
- `scoreEngine.ts` applies directional bonuses per archetype. ✅
- Combo archetype is not a first-class archetype in the generator — it falls under Midrange or custom keyword focuses. ❌ **missing**
- Delirium is not a first-class axis (it is partially covered by the "Graveyard" keyword focus). ⚠️ **gap**
- The "why" reasoning (per-card explanation) is generated in `cardReasons` on the result. ✅

### Tasks
**T4.1** — Add `"Combo"` to the `Archetype` union type and implement a Combo archetype profile in `archetypeProfiles.ts`:
- Role budget: Engine ×0.5, Enabler ×0.3, Threat ×0.1, Removal ×0.1
- Curve target: peaks at CMC 1–3 (enabler/engine package), with 2–3 finisher payoffs at CMC 4–6
- Synergy requirement: at least 1 confirmed Engine→Payoff pair from `synergyGraph`; if absent, log a warning

**T4.2** — Add `"delirium"` as a named axis in `synergyModel.ts`'s `inferPrimaryAxes`. Delirium fires when the seed pool contains ≥2 distinct permanent types AND ≥1 card with oracle text `"delirium"`. Its axis bonus should reward: Instant, Sorcery, Creature, and Enchantment type diversity.

---

## 5. sonar.md Part 5 — "Card Role Taxonomy"
### Spec prescriptions
Full tagging: Threat, Engine, Enabler, Payoff, Finisher, Interaction (Removal/Counterspell/Boardwipe), Tutor, CardDraw, Ramp.  
Secondary oracle tags: `evasive`, `flexible`, `two_for_one`, `graveyard_filling`, `looting`, `sacrifice_outlet`, `etb_value`, `token_maker`.

### Current implementation
- Primary roles: `assignRoles` in `src/lib/roles.ts` — covers Threat/Removal/BoardWipe/Counterspell/CardDraw/Ramp/Tutor. ✅ mostly complete
- `isThreat` helper. ✅
- Secondary oracle tags: partially present in `buildSynergyProfile` axes (looting, token_maker, etb). ⚠️ **incomplete**
- `Finisher`, `Engine`, `Enabler`, `Payoff` are not distinct role tags; they collapse into Threat or are detected via synergy axes. ❌ **missing distinct tags**

### Tasks
**T5.1** — In `src/lib/roles.ts`, add the following to the `Role` union type:
```typescript
| "Engine" | "Enabler" | "Payoff" | "Finisher"
```
Implement detection heuristics:
- **Engine**: oracle text contains `"whenever"` + a draw/token/counter clause, or `"at the beginning"` triggers
- **Enabler**: `"sacrifice"` outlet OR `"discard a card"` OR `"mill"` verb in oracle text
- **Payoff**: oracle text contains `"whenever you cast"` / `"whenever a creature dies"` / `"if you control"` / `"for each"` + a power bonus clause
- **Finisher**: CMC ≥ 5 AND (flying OR trample OR haste) AND power ≥ 5, or oracle text `"wins the game"` / `"loses the game"` / `"damage to each opponent"`

**T5.2** — In `buildSynergyProfile` (`src/lib/generator/synergyModel.ts`), add secondary boolean tags to the returned profile:
```typescript
evasive: boolean        // flying | menace | unblockable
flexible: boolean        // has both instant/flash AND a permanent mode, OR modal spell
two_for_one: boolean    // draws a card on ETB/death OR creates 2+ tokens
graveyard_filling: boolean // mills OR loots (draw+discard)
```
Use these in `generator.ts` to apply small directional bonuses: `flexible` cards get +0.3 in any archetype; `two_for_one` cards get +0.5 in Midrange/Control.

---

## 6. sonar.md Part 6 — "Why Cards Are Chosen Across Rotations"
### Spec prescriptions
- **5-axis evaluation model**: Power floor, Role clarity, Synergy density, Flexibility, Meta positioning
- **Keyword value matrix**: by archetype — e.g., Flying is rated High in Tempo/Control, Low in Aggro; Lifelink High in Midrange, Low in Combo; etc.
- Generator must generalise to **new sets** by evaluating oracle text, not card names.

### Current implementation
- Power scoring via `scoreEngine.ts`: role-power composite, plus synergy, directional, signal, efficiency, flexibility, ladder scores. ✅ generally implements the 5-axis model
- Keyword value matrix: partially — `keywordFocus` system applies bonuses for specific strategic axes. ⚠️ **not a formal matrix**
- New-set generalisation: already oracle-text-driven, not name-dependent. ✅

### Tasks
**T6.1** — In `src/lib/config/scoringConfig.ts`, add a typed `KEYWORD_VALUE_MATRIX`:
```typescript
export const KEYWORD_VALUE_MATRIX: Record<KeywordFocus | "Flying" | "Lifelink" | "Deathtouch", Record<Archetype, number>> = {
  "Flying":      { Aggro: 0.4, Midrange: 0.6, Control: 0.9, Tempo: 1.0, Combo: 0.3, Ramp: 0.3, Prison: 0.5 },
  "Lifelink":    { Aggro: 0.7, Midrange: 0.9, Control: 0.6, Tempo: 0.4, Combo: 0.2, Ramp: 0.5, Prison: 0.8 },
  // ... all keywords from sonar.md section 9
};
```
Apply these multipliers in `scoreEngine.ts` when scoring cards with matching keyword oracle text.

**T6.2** — Document the 5-axis model explicitly in `src/lib/config/scoringConfig.ts` as a block comment above the existing weights, mapping each axis to its corresponding config variable(s) and weight. This serves as the human-readable spec that governs new-set calibration.

---

## 7. sonar.md Part 7 — "AI Generator Tuning Spec"
### Spec prescriptions
- **Role-first slot budgets**: AI prompt must include slot budget (e.g., "include 4 removal spells, 2 counterspells, 12 threats")
- **Hard constraint pseudocode**: AI response must satisfy legality, deck size, role minimums
- **Synergy pair scoring heuristics**: source→payoff pairs scored by `min(sourceDensity, payoffDensity)` 
- **New set onboarding pipeline**: when importing new cards, re-run oracle scoring to fit them into existing axes without manual curation

### Current implementation
- AI prompts include pool digest and archetype context. ✅
- Validation layer (`validateAIResponse`) added in prior sessions. ✅
- Role-first slot budget: prompts describe the archetype but do NOT explicitly list hard slot budgets. ❌ **missing from prompt**
- Synergy pair scoring: done in `synergyGraph.ts` with source→payoff graph. ✅
- New set onboarding: fully automatic via oracle-text scoring on import. ✅

### Tasks
**T7.1** — In `src/lib/ai/aiGenerator.ts`, inside `buildAIPrompts`, add a **slot budget section** to the user prompt. Before the card digest, inject:
```
## Role budget for {archetype} ({mainboardSize}-card deck)
Threats/win-cons: {threatTarget} copies
Removal/interaction: {removalTarget} copies
Card draw/advantage: {drawTarget} copies
Ramp/acceleration: {rampTarget} copies (0 if aggro)
Lands: {landTarget}
```
Compute `threatTarget`, `removalTarget`, etc. from `archetypeProfiles[archetype].roleBudgets` multiplied by `mainboardSize`. This ensures the LLM fills explicit functional slots rather than making unconstrained picks.

**T7.2** — Add a `validateDeckLegality(entries, format)` function in `src/lib/ai/resolver.ts` or a new `src/lib/ai/validator.ts`. This should check:
1. No card exceeds 4 copies (non-basic, non-unlimited)  
2. All cards are legal in the specified format (check `legalities[format]` field on `CardRecord`)  
3. Mainboard size matches `mainboardSize`  
4. If any check fails, return structured errors that `buildResultFromAIResponse` can use to log diagnostic reasoning lines instead of silently passing

**T7.3** — Create `src/test/fixtures/ai/` directory with at least 3 fixture files:
- `valid_standard_aggro.json` — a well-formed AI response for a Standard Aggro deck
- `malformed_truncated.json` — a truncated/corrupt response for testing `salvageDeckJSON`
- `illegal_cards.json` — response containing banned/invalid card names  
Write corresponding tests in `src/__tests__/aiGenerator.test.ts` using a `MockAIProvider` class that returns these fixtures. Test that `buildResultFromAIResponse` handles all three cases without throwing.

---

## 8. sonar.md Part 8 — "Archetype Decision Tree"
### Spec prescriptions
An inferential decision tree: given user inputs (colors, speed, keyword focus, seed cards), derive the most appropriate archetype automatically.

### Current implementation
- `analyzeCurrentDeck` in `GeneratorPanel.tsx` runs `detectArchetype` and auto-populates form fields. ✅
- `detectArchetype` in `src/lib/archetype.ts` returns a macro archetype + themes. ✅
- The decision tree from sonar.md (entry-point logic) is partially implemented but not documented or exposed as a standalone, testable module. ⚠️

### Tasks
**T8.1** — Extract `detectArchetype`'s logic into a pure, documented `inferArchetypeFromSeeds(entries, colors, keywordFocus)` function in `src/lib/archetype.ts` with JSDoc that maps exactly to the sonar.md decision tree nodes. Add test cases in `src/__tests__/archetype.test.ts` covering: mono-red low curve → Aggro, UB flash/counter density → Tempo, GR ramp + 5-drops → Ramp, etc.

---

## 9. sonar.md Part 9 — "Quick Reference Synergy Table"
### Spec prescriptions
All archetypes summarised by trigger condition and payoff type — a machine-readable reference used by the scoring engine to award synergy bonuses.

### Current implementation
- Synergy is computed from `buildSynergyProfile` axis tags + `synergyGraph` source→payoff matching. ✅
- No explicit "synergy table" artifact — synergy logic is encoded in function bodies. ❌ **not extractable / auditable**

### Tasks
**T9.1** — Create `src/lib/config/synergyRules.ts` containing a typed array of `SynergyRule` objects:
```typescript
interface SynergyRule {
  id: string;
  trigger: string;        // oracle text fragment that fires the trigger (regex or keyword)
  payoff: string;         // oracle text or axis tag of the payoff card
  archetypes: Archetype[]; // archetypes where this pair earns bonus
  bonus: number;           // additive score contribution per source
}
```
Migrate the implicit synergy pairs from `synergyGraph.ts` into this table. The scoring engine should iterate over `SYNERGY_RULES` rather than hardcoding axis pairs inline. This makes the synergy model auditable and easy to extend for new sets.

---

## 10. Engineering Assessment Cross-Tasks (from ENGINEERING_ASSESSMENT.md)

These tasks come from the engineering assessment, not directly from sonar.md, but are prerequisites for the sonar.md tasks to work reliably:

**T10.1** (High) — Define explicit **stage interfaces** for the generator pipeline. Create `src/lib/generator/pipeline.ts` with typed `PipelineStage<TIn, TOut>` contracts:
```typescript
PoolBuilder → RoleTargeter → ColorWeighter → SynergyWeighter → Optimizer → SideboardPlanner
```
Each stage should be independently importable and testable with `vitest`.

**T10.2** (High) — Document `scoringConfig.ts` parameter interactions. For every coefficient, add an inline comment: `// Interacts with: DIRECTIONAL_MAX_CAP — increasing this above 3.0 requires proportional increase in cap`. Add a `docs/SCORING_CONFIG_GUIDE.md` that lists all params, valid ranges, and cross-dependencies.

**T10.3** (Medium) — Build a Node.js calibration script at `scripts/calibrate.ts` (runnable with `tsx scripts/calibrate.ts`) that:
1. Loads a known-good Standard deck list from `src/test/fixtures/calibration/`
2. Runs the offline generator against the same card pool
3. Prints a score breakdown comparison: expected vs actual role distribution, score delta, deck score
4. Exits with code 1 if deckScore < 60 for a canonical Tier-1 fixture

**T10.4** (Medium) — Audit whether `generator.ts` runs >100ms on a full Standard pool (2000+ cards). If so, port it to `src/workers/generatorWorker.ts` following the pattern already established in `src/workers/importWorker.*`. The UI already shows a busy state; the worker just needs to post `{ type: 'result', payload: GenerateResult[] }` back.

**T10.5** (Low) — Add an `docs/adr/` directory. Start with three ADRs:
- `ADR-001-synergy-log-compression.md` — why log is used instead of linear for synergy scoring
- `ADR-002-dexie-over-raw-idb.md` — why Dexie was chosen
- `ADR-003-ai-provider-abstraction.md` — why provider interface instead of direct OpenAI dependency

---

## 11. Priority Order for AI Coding Model (Act Mode)

Execute these in order. Each task is self-contained enough to be handled in a single Act-mode session:

| Priority | Task ID | File(s) | Description |
|----------|---------|---------|-------------|
| 1 | T7.3 | `src/test/fixtures/ai/`, `src/__tests__/aiGenerator.test.ts` | Mock AI fixtures + parsing tests (foundation for all AI work) |
| 2 | T7.2 | `src/lib/ai/validator.ts` | Legality validation function for AI output |
| 3 | T5.1 | `src/lib/roles.ts` | Add Engine/Enabler/Payoff/Finisher role tags |
| 4 | T5.2 | `src/lib/generator/synergyModel.ts` | Add secondary oracle tags (evasive/flexible/two_for_one/graveyard_filling) |
| 5 | T9.1 | `src/lib/config/synergyRules.ts` | Extract synergy rules to typed config table |
| 6 | T2.1 | `src/lib/math/hypergeometric.ts` | Hypergeometric probability math module |
| 7 | T2.2 | `src/lib/generator/manaBase.ts` | Audit + fix Karsten source-count formula + tests |
| 8 | T6.1 | `src/lib/config/scoringConfig.ts` | Keyword value matrix by archetype |
| 9 | T7.1 | `src/lib/ai/aiGenerator.ts` | Add role-first slot budget section to AI prompt |
| 10 | T4.1 | `src/lib/archetype.ts`, `archetypeProfiles.ts` | Combo archetype first-class support |
| 11 | T4.2 | `src/lib/generator/synergyModel.ts` | Delirium as named axis |
| 12 | T3.2 | `src/lib/generator/generator.ts` | Threat/interaction ratio diagnostic warnings |
| 13 | T1.1 | `src/lib/generator/weights.ts` | MMR-calibrated win-rate sigmoid |
| 14 | T1.2 | `GenerateResult` type + `MythicViabilityPanel` | consistencyScore field |
| 15 | T2.3 | `src/lib/generator/diagnostics.ts` | Rule-of-9 compliance metric |
| 16 | T10.1 | `src/lib/generator/pipeline.ts` | Stage interface contracts |
| 17 | T10.2 | `scoringConfig.ts`, `docs/SCORING_CONFIG_GUIDE.md` | Config parameter documentation |
| 18 | T10.3 | `scripts/calibrate.ts` | Calibration harness script |
| 19 | T8.1 | `src/lib/archetype.ts`, `src/__tests__/archetype.test.ts` | Extracted decision tree + tests |
| 20 | T10.4 | `src/workers/generatorWorker.ts` | Generator web-worker port (if profiling shows >100ms) |
| 21 | T10.5 | `docs/adr/` | ADR documents |

---

## 12. Files Created/Changed Summary

By the time all tasks above are complete, the following files will be new or significantly modified:

**New files:**
- `src/lib/math/hypergeometric.ts`
- `src/lib/ai/validator.ts`
- `src/lib/config/synergyRules.ts`
- `src/lib/generator/pipeline.ts`
- `src/lib/generator/diagnostics.ts`
- `src/test/fixtures/ai/valid_standard_aggro.json`
- `src/test/fixtures/ai/malformed_truncated.json`
- `src/test/fixtures/ai/illegal_cards.json`
- `src/test/fixtures/calibration/` (deck fixtures)
- `src/__tests__/aiGenerator.test.ts`
- `src/__tests__/archetype.test.ts`
- `src/__tests__/manaBase.test.ts`
- `scripts/calibrate.ts`
- `docs/SCORING_CONFIG_GUIDE.md`
- `docs/adr/ADR-001-synergy-log-compression.md`
- `docs/adr/ADR-002-dexie-over-raw-idb.md`
- `docs/adr/ADR-003-ai-provider-abstraction.md`

**Modified files:**
- `src/lib/roles.ts` — new Engine/Enabler/Payoff/Finisher roles
- `src/lib/generator/synergyModel.ts` — delirium axis, secondary oracle tags
- `src/lib/generator/weights.ts` — MMR sigmoid, consistencyScore
- `src/lib/generator/generator.ts` — threat/interaction ratio diagnostics, Rule-of-9
- `src/lib/generator/manaBase.ts` — Karsten formula audit
- `src/lib/config/scoringConfig.ts` — keyword value matrix, documented interactions
- `src/lib/archetype.ts` — Combo archetype, extracted decision tree
- `src/lib/ai/aiGenerator.ts` — role-first slot budget in prompt
- `src/components/GeneratorPanel.tsx` — consistencyScore display
- `src/components/MythicViabilityPanel.tsx` — consistencyScore display

---

*This document is intended to be handed directly to an AI coding model operating in act mode. Work through the tasks in the Priority Order table (Section 11), one task per session. Each task ID maps to a precise file change in the sections above.*
