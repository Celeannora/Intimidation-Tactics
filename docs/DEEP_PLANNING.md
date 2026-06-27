# DEEP PLANNING — Intimidation-Tactics: sonar.md → Current State Gap Analysis & Act-Mode Implementation Plan

**Generated:** 2026-06-25  
**For:** AI coding agent in Act mode  
**Basis:** `sonar.md` (9-part mythic-viability spec) × `implementation_plan.md` (20-step plan) × `ENGINEERING_LIVE_TRACKER.md` (task T1–T13)

---

## 1. Executive Summary

The sonar.md spec defined nine research areas for the MTG deck generator. `implementation_plan.md` translated them into a 20-step build plan. As of this audit, roughly **60% of the planned work is complete**. The engine, scoring, synergy, and analysis layers are substantially implemented. The remaining gaps are concentrated in four areas:

1. **Generator wiring** — `generator.ts` does not yet call `computeMythicViability`, `validateSynergyPairs`, `computeTempoScore`, or `computeCardAdvantageScore` on generated decks.
2. **LLM refinement loop** — `aiGenerator.ts` has seed intent injected (T5 ✅) but multi-pass refinement with per-dimension diagnostics (T6, T7) is unstarted.
3. **Evaluation harness & calibration** — smoke test plan exists; executable harness and coefficient calibration (T10, T11) are not built.
4. **UI surface** — `GeneratorPanel.tsx` and `DeckStats.tsx` do not yet render the mythic viability badge, three-pillar breakdown, tempo score, or card-advantage score (T12).

Additionally, two **synergyModel.ts pattern gaps** were discovered during pipeline testing that should be fixed before release.

---

## 2. Current State × sonar.md Gap Table

| sonar.md Part | Description | Implementation Status | Key Files |
|---|---|---|---|
| Part 1: Mythic Viability / MMR Math | Three-pillar score (consistency 45%, redundancy 30%, meta 25%), win-rate proxy, 55–61% WR threshold | ✅ **Complete** | `mythicViability.ts` |
| Part 2: Universal Construction Math | Karsten mana math, Rule-of-9 4-of enforcement, curve targets | ✅ **Implemented** (`enforceRuleOfNine` pending wiring) | `scoringConfig.ts`, `archetypeProfiles.ts`, `pipeline.ts` |
| Part 3: Tempo + Card Advantage | `computeTempoScore`, `computeCardAdvantageScore` as named outputs on `GenerateResult` | 🚧 **Functions exist in scoreEngine.ts; not wired into generator.ts or GenerateResult** | `scoreEngine.ts`, `generator/types.ts` |
| Part 4: Archetype-by-Archetype Analysis | Aggro/Midrange/Control/Combo/Delirium/Tempo/Tokens with role profiles | ✅ **Complete** | `archetypeProfiles.ts`, `archetype.ts` |
| Part 5: Card Role Taxonomy | `Enabler`/`Payoff`/`Finisher` roles; `SecondaryCardTag`; `deriveSecondaryTags()` | ✅ **Implemented** | `roles.ts`, `types.ts` |
| Part 6: Keyword Value Matrix | `KEYWORD_VALUE_MATRIX` per archetype; `applyKeywordValueMatrix()` in scoring | ✅ **In scoringConfig.ts** (may need integration verification) | `scoringConfig.ts`, `weights.ts` |
| Part 7: AI Generator Tuning Spec | Role-first slot budgets, synergy pair hard constraints, new set onboarding pipeline | ✅ **Core implemented** — `synergyConstraints.ts`, `newSetPipeline.ts`, `roleTargets.ts` exist | `synergyConstraints.ts`, `newSetPipeline.ts` |
| Part 8: Archetype Decision Tree | `detectArchetypeWithConfidence()` returning scored multi-archetype `ArchetypeConfidence` | ✅ **Complete** (backward-compat `detectArchetype` wrapper exists) | `archetype.ts` |
| Part 9: Quick Reference Synergy Table | All axes enumerated; directional source→payoff pairs documented in code | ✅ **Complete** | `synergyModel.ts` |

---

## 3. Remaining Work — Ordered Task List for Act Mode

Each task below is **immediately actionable** with exact file paths and function signatures.

---

### TASK A: Wire mythicViability + validateSynergyPairs + tempo/CA into generator.ts
**Priority: CRITICAL** | **Blocks: T12, T13, LLM refinement** | **Estimated effort: Medium**

**File: `src/lib/generator/generator.ts`**

After the deck assembly phase in `generateDecks()` (or equivalent top-level function), add the following calls and attach results to each `GenerateResult`:

```typescript
import { computeMythicViability } from "../mythicViability";
import { validateSynergyPairs } from "./synergyConstraints";
import { computeTempoScore, computeCardAdvantageScore } from "../scoreEngine";

// After deck is assembled, before returning GenerateResult:
const mythicViability = computeMythicViability(deckEntries, detectedArchetype);
const synergyViolations = validateSynergyPairs(deckEntries, detectedArchetype);
const tempoScore = computeTempoScore(deckEntries, detectedArchetype);
const cardAdvantageScore = computeCardAdvantageScore(deckEntries);

// Attach to GenerateResult:
return {
  ...existingResult,
  mythicViability,
  synergyViolations,
  tempoScore,
  cardAdvantageScore,
};
```

**Verify:** `GenerateResult` in `src/lib/generator/types.ts` has `mythicViability: MythicViabilityReport`, `tempoScore: number`, `cardAdvantageScore: number` fields. If missing, add them.

**Test:** In `src/lib/generator/__tests__/generator.test.ts`, assert these fields exist on every returned result and that `mythicViability.score` is a number 0–100, `tempoScore` is 0–100, `cardAdvantageScore` is 0–100.

---

### TASK B: LLM Refinement Loop — Feed Post-Generation Diagnostics (T6)
**Priority: HIGH** | **File: `src/lib/ai/aiGenerator.ts`**

The current `aiGenerator.ts` injects seed intent and synergy graph into the Analyze→Generate prompt (T5 ✅). The refinement pass does not yet feed back per-dimension failure diagnostics. 

**What to add:**

1. After calling the generator, extract diagnostic signals from `GenerateResult`:
   - `mythicViability.pillars.consistency` < 55 → inject "curve/mana failure" signal
   - `mythicViability.pillars.redundancy` < 50 → inject "need more 4-of copies of X role"
   - `mythicViability.pillars.metaPositioning` < 50 → inject "archetype role profile mismatch"
   - `synergyViolations.length > 0` → inject each violation as a constraint
   - `tempoScore` < 40 → inject "add more early interaction / low-curve threats"
   - `cardAdvantageScore` < 40 → inject "add more draw / two-for-one effects"

2. Build a `buildRefinementPrompt(result: GenerateResult, seedSummary: SeedSummary): string` function that structures these signals into a targeted refinement instruction for the LLM.

3. Run up to **3 refinement passes** in a loop; stop early if `mythicViability.score >= 55` and `synergyViolations.length === 0`.

**Signature:**
```typescript
async function buildRefinementPrompt(
  result: GenerateResult,
  seedSummary: SeedSummary,
  passNumber: number,   // 1, 2, or 3
): Promise<string>

async function runRefinementLoop(
  initialResult: GenerateResult,
  seedSummary: SeedSummary,
  maxPasses?: number,   // default 3
): Promise<GenerateResult>
```

---

### TASK C: LLM Feasibility Checks — Structural Validation Layer (T7)
**Priority: HIGH** | **File: `src/lib/ai/aiGenerator.ts` or new `src/lib/ai/feasibilityChecker.ts`**

Prevent "reward hacking" where the LLM proposes a deck that scores well by coincidence but violates construction rules.

**Hard constraints to check before accepting any LLM-proposed deck:**
1. Land count between 20–27 (60-card deck)
2. At least 3 total removal / interaction spells
3. At least 6 total threat/payoff cards
4. Color identity must include all colors needed by seed cards
5. No more than 4 copies of any non-basic-land card
6. All cards Standard-legal (check `legalityStandard === 'legal'` and `bannedInStandard !== true`)

**New function:**
```typescript
interface FeasibilityViolation {
  rule: string;
  detail: string;
  severity: "hard" | "soft";
}

function checkFeasibility(
  proposedCards: CardRecord[],
  seedCards: CardRecord[],
): FeasibilityViolation[]
```

Reject proposal (re-prompt) if any `severity: "hard"` violations exist.

---

### TASK D: Executable Smoke Test Harness (T10)
**Priority: HIGH** | **New file: `src/test/smokeTest.ts`**

`docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md` documents the test plan. The executable harness is missing. Build it as a Vitest test file using the standard-pool.json fixture (420 cards).

**Test cases to implement:**

```typescript
// Fixture seeds from smoke-test plan
const AGGRO_SEEDS = ['Healer\'s Hawk', 'Ajani\'s Pridemate'];  // lifegain aggro
const MIDRANGE_SEEDS = ['Giada, Font of Hope', 'Lyra Dawnbringer']; // angel midrange
const FF_SEEDS = ['Hope Estheim', 'Aerith Gainsborough'];  // lifegain-mill

describe('Seed Analyze smoke test', () => {
  test('aggro seed → archetype=Aggro, axes include lifegain', async () => {
    const seeds = getCardsFromFixture(AGGRO_SEEDS);
    const result = await analyzeSeeds(seeds);
    expect(result.archetypeConfidence.primary).toBe('Aggro');
    expect(result.axes).toContain('lifegain');
    expect(result.confidence).toBeGreaterThan(0.5);
  });

  test('generated deck from seeds passes mythic viability threshold', async () => {
    // Run full pipeline on fixture pool
    const result = await generateFromSeeds(seeds, fixturePool);
    expect(result.mythicViability.score).toBeGreaterThan(35); // at minimum fringe
    expect(result.mythicViability.pillars.consistency).toBeGreaterThan(40);
    expect(result.synergyViolations).toHaveLength(0);
  });
  
  test('Hope Estheim seed → mill axis detected', async () => {
    // NOTE: Hope Estheim not in standard-pool.json fixture; use mock CardRecord
    const hopeEstheim = buildMockCard({
      name: 'Hope Estheim', manaCost: '{W}{U}',
      oracleText: 'Lifelink. At the beginning of your end step, each opponent mills X cards, where X is the amount of life you gained this turn.',
    });
    const result = await analyzeSeeds([hopeEstheim, cardFromFixture('Lyra Dawnbringer')]);
    expect(result.axes).toContain('lifegain');
    // mill detected as secondary axis (3 sources, 0 payoffs → just below top-3)
    // test documents that the pipeline gap exists — "amount of life you gained" isn't caught
    expect(result.pipelineGapsDetected).toBeDefined(); // future diagnostic field
  });
});
```

---

### TASK E: Fix synergyModel.ts Pattern Gaps (Discovered via pipeline testing)
**Priority: MEDIUM** | **File: `src/lib/generator/synergyModel.ts`**

Three regex patterns are missing from `PAYOFF_PATTERNS` and `SOURCE_PATTERNS`, causing material misclassification of key cards:

**Gap 1 — Hope Estheim / Resplendent Angel: "amount/quantity of life you gained" not caught**

Add to `PAYOFF_PATTERNS.lifegain`:
```typescript
/(?:where|equal to) .{0,20}(?:amount|number) .{0,10}life you (?:gained|gain)/i,
/(?:gained|gain) (?:\d+ or more|\d+) life this turn/i,
/5 or more life this turn/i,
```

**Gap 2 — The Wind Crystal: "you gain twice that much life" not caught as lifegain source/amplifier**

Add to `SOURCE_PATTERNS.lifegain`:
```typescript
/you gain (?:twice|double|that much|X) (?:that much |more )?life/i,
/if you would gain life.{0,40}instead/i,
```

**Gap 3 — The Water Crystal: mill amplifier pattern not caught**

Add to `SOURCE_PATTERNS.mill`:
```typescript
/if .{0,20}would mill.{0,40}(?:plus|more|instead)/i,
/they mill that many (?:plus|more|and)/i,
```

After adding these patterns, run: `npm test` to verify no regressions.

---

### TASK F: UI Surfacing — MythicViabilityPanel (T12)
**Priority: MEDIUM** | **Files: `src/components/GeneratorPanel.tsx`, `src/components/DeckStats.tsx`**

#### F.1 — New component: `src/components/MythicViabilityPanel.tsx`

```typescript
interface Props {
  report: MythicViabilityReport;
  tempoScore: number;
  cardAdvantageScore: number;
}
```

Renders:
- A label badge: `tier-1` (gold) / `mythic-viable` (purple) / `fringe` (blue) / `not-viable` (grey)
- Estimated win rate: e.g., "~57.2% WR (Bo1)"
- Three horizontal bars: Consistency / Redundancy / Meta Positioning, each 0–100 with color coding (red < 45, yellow 45–65, green > 65)
- Two secondary stats: Tempo Score and Card Advantage Score
- Notes list from `report.notes`

Tailwind classes should match existing design system (check `src/index.css` for color tokens).

#### F.2 — Wire into GeneratorPanel

In `src/components/GeneratorPanel.tsx`, after deck generation succeeds:
```tsx
{result?.mythicViability && (
  <MythicViabilityPanel
    report={result.mythicViability}
    tempoScore={result.tempoScore}
    cardAdvantageScore={result.cardAdvantageScore}
  />
)}
```

---

### TASK G: Calibration — scoringConfig.ts Coefficient Tuning (T11)
**Priority: MEDIUM** | **File: `src/lib/config/scoringConfig.ts`, new `scripts/calibrate.cjs`**

Build a Node.js calibration script that:
1. Loads known-tier-1 decks from a `scripts/known_decks.json` fixture (manually curated, ~10 decks from real Standard results)
2. Runs each through the full scoring pipeline
3. Calculates mean `mythicViability.score` for tier-1 decks (target: ≥ 65)
4. Reports which scoring coefficients most strongly correlate with correct labeling
5. Suggests adjustments to `CONSISTENCY_WEIGHT`, `REDUNDANCY_WEIGHT`, `META_WEIGHT` if tier-1 mean < 65

This is a manual-iteration calibration aid, not an automated tuner.

---

### TASK H: Release Checklist + Test Coverage (T13)
**Priority: HIGH** | **Run before any production deploy**

**Pre-release requirements:**

```
[ ] npm test → 0 failing, >90% pass rate
[ ] npx tsc --noEmit → 0 errors
[ ] generator.ts wired (Task A verified)
[ ] synergyModel patterns fixed (Task E verified)
[ ] All 3 new test files passing:
    [ ] src/lib/__tests__/mythicViability.test.ts
    [ ] src/lib/__tests__/synergyConstraints.test.ts  
    [ ] src/lib/__tests__/newSetPipeline.test.ts
[ ] Smoke test harness (Task D) passes all assertions
[ ] MythicViabilityPanel renders without error on a generated deck
[ ] Remove temp files: fetch_cards.cjs, fetch_cards.js, pipeline_run.cjs (added during dev session)
```

**Existing tests to verify/update:**
- Any test importing `detectArchetype` → verify backward-compat wrapper still returns `Archetype` string
- `src/lib/generator/__tests__/generator.test.ts` → `GenerateResult` must include `mythicViability`, `tempoScore`, `cardAdvantageScore`
- `src/lib/__tests__/scoreEngine.test.ts` → must cover `computeTempoScore` and `computeCardAdvantageScore`

---

## 4. "Do Not Touch" Constraints (from ENGINEERING_LIVE_TRACKER §5)

These are inviolable. Any act-mode implementation must respect:

1. **All scoring coefficients must live in `src/lib/config/scoringConfig.ts`** — no hardcoded numbers in logic files.
2. **Directional synergy remains log-compressed and capped** — do not reintroduce unlimited multiplicative synergy.
3. **Mana/curve penalties stay strong** — these prevent non-games; do not relax them.
4. **Route all meta data through `MetaContext`** — never hardcode meta values.
5. **Deprecate rather than delete** public APIs for backward compatibility.

---

## 5. Recommended Execution Order for Act Mode

Run in this order to minimize merge conflicts and avoid breaking the passing test suite:

```
1.  TASK E  — Fix synergyModel.ts patterns (no dependencies, leaf-level change)
2.  TASK A  — Wire generator.ts (core plumbing; enables all downstream tasks)
3.  TASK D  — Smoke test harness (validates Task A is working end-to-end)
4.  TASK C  — LLM feasibility checks (can be done in parallel with D)
5.  TASK B  — LLM refinement loop (depends on Task A diagnostics being available)
6.  TASK F  — UI surfacing (depends on Task A output types being available)
7.  TASK G  — Calibration script (depends on Task A for pipeline completeness)
8.  TASK H  — Release checklist (final gate; run after all above complete)
```

---

## 6. Key File Reference (for Act Mode Context Loading)

Load these files at the start of an act-mode session to get full context without re-reading everything:

| Priority | File | Why |
|----------|------|-----|
| 1 | `src/lib/generator/generator.ts` | Task A entrypoint — this is where wiring happens |
| 2 | `src/lib/generator/types.ts` | Verify `GenerateResult` shape before writing |
| 3 | `src/lib/mythicViability.ts` | Understand pillar function signatures |
| 4 | `src/lib/generator/synergyConstraints.ts` | Understand `validateSynergyPairs` signature |
| 5 | `src/lib/scoreEngine.ts` | Verify `computeTempoScore` / `computeCardAdvantageScore` exist |
| 6 | `src/lib/generator/synergyModel.ts` | Task E pattern gap targets |
| 7 | `src/lib/ai/aiGenerator.ts` | Task B context for refinement loop |
| 8 | `docs/SEED_ANALYZE_SMOKE_TEST_PLAN.md` | Task D fixture seeds and acceptance criteria |
| 9 | `src/lib/config/scoringConfig.ts` | Do-not-touch constraint reference |
| 10 | `src/lib/config/archetypeProfiles.ts` | Archetype curve/role targets for calibration |
