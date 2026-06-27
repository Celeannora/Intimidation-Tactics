# Seed Analyze Smoke Test Plan

## Goal

Validate the core project promise:

> User provides a small pool / 4 seed cards, clicks Analyze, the system infers the deck intention, asks the LLM to continue the plan, and the offline engine returns a viable deck that can be iteratively optimized with user input.

This plan focuses on the mapping between input cards and final product.

---

## Pipeline Under Test

1. User-selected seed cards enter `GenerateOptions.seedEntries`, `focusEntries`, or `preferEntries`.
2. `src/lib/analysis/seedAnalyzer.ts` computes:
   - inferred colors
   - archetype candidates
   - primary synergy axes
   - role counts
   - speed profile
   - spell ratio
   - confidence
3. `src/lib/analysis/synergyGraph.ts` builds source→payoff seed links.
4. `src/lib/ai/aiGenerator.ts::buildAIPrompts` injects this deterministic intent context into the LLM prompt.
5. LLM proposes a nonland core.
6. Offline generator adds lands, corrects quantities, fills gaps, and evaluates viability.
7. Refinement loop feeds deck diagnostics and user feedback back to the LLM.

---

## Smoke Test Scenarios

Each scenario should provide exactly 4 seed cards where possible. The seed cards below are examples; use legal/current-format equivalents when testing a rotating format.

| ID | Intended Plan | Example Seed Pattern | Expected Macro | Expected Axes | Must Recognize |
|----|---------------|----------------------|----------------|---------------|----------------|
| S1 | Mono-Red Aggro/Burn | cheap red threat, burn spell, haste/pump, face-damage payoff | Aggro | burn | proactive clock, low curve, direct damage |
| S2 | Izzet Prowess/Spells | prowess threat, cheap cantrip, burn spell, spell payoff | Tempo or Aggro | spellslinger, burn | spell density, cheap interaction, evasive/fast threats |
| S3 | Rakdos Sacrifice | sacrifice outlet, death payoff, fodder maker, drain payoff | Midrange or Combo | sacrifice, tokens | source/payoff/fodder triangle |
| S4 | Selesnya Tokens | token maker, anthem, go-wide payoff, protection/value card | Aggro or Midrange | tokens | board width, anthem effects, sweep resilience |
| S5 | Azorius Control | counterspell, sweeper, card draw, finisher | Control | draw / interact | survive early, trade resources, win late |
| S6 | Golgari Graveyard | self-mill, recursion, graveyard payoff, removal/value creature | Midrange or Combo | graveyard, reanimator, selfMill | fill yard, recur threats, value loop |
| S7 | Simic Ramp | ramp spell, land payoff, large finisher, card draw | Ramp | landfall / draw | accelerate mana, top-end payoff, enough early defense |
| S8 | Ambiguous Goodstuff | removal, draw spell, midrange threat, utility card | Midrange | none or weak | low confidence, ask/hedge rather than overclaim |

---

## Pass/Fail Predicates

For each scenario, capture:

- Seed summary from `analyzeSeeds`
- Synergy graph from `buildSeedSynergyGraph`
- LLM summary and game plan
- Final deck list
- `deckScore`
- `manaBaseCoverage`
- `curveDeviation`
- `profilePenalty`
- `redundancyContribution`
- `finalScore`

### Intent Recognition

Pass if:

- Top archetype is expected macro or accepted close cousin.
- Primary axes include the expected axes when the seed is synergy-driven.
- For ambiguous/goodstuff seeds, confidence is not overconfident (`confidence < 0.65` is desirable).

### LLM Plan Quality

Pass if the LLM `summary`/`game_plan`:

- Names the correct primary plan.
- Explains how at least 2 seed cards support that plan.
- Mentions missing role requirements (interaction, threats, enablers, payoffs, card draw, lands) when relevant.
- Does not invent cards outside the pool.

### Final Deck Viability

Suggested first-pass thresholds:

- `manaBaseCoverage >= 0.85` for 2+ color decks, `>= 0.92` for mono-color decks.
- `curveDeviation <= 1.20` for aggro/tempo, `<= 1.50` for midrange/control/ramp.
- `profilePenalty` should not dominate total score; investigate if it exceeds 15% of `cardScoreSum`.
- `redundancyContribution > 0` for synergy-driven seeds.
- Mainboard size exactly matches format target.
- No illegal card quantities.

---

## Single-Card Axis Overfit Scenarios

These scenarios specifically test the fix for the root cause identified in the 2026-06 audit: a single fringe card with multiple edge types (`edgeCount >= 2`) was incorrectly promoted to a required axis, overriding the user's actual game plan. All tests below now require `axisSeedCardCounts >= 2` for an axis to be treated as confirmed.

| ID | Setup | Fringe Input | Expected Behavior | Failure Signal |
|----|-------|--------------|-------------------|----------------|
| O1 | 4 Rakdos sacrifice seeds + 1 unrelated enchantment with aura text | Enchantment with "enchant creature" / "when enchanted creature dies" text | Deck identity stays sacrifice; enchantment axis should NOT appear in `graphConfirmedAxes`; final deck should not include aura payoffs | `enchantress` or `voltron` axis in `primaryAxes`; deck pivots toward aura theme |
| O2 | 4 Izzet spellslinger seeds + 1 outlier equipment creature | Equipment creature with "prowess" + "equip" keyword | Deck identity stays spellslinger; neither `voltron` nor `artifacts` axis promoted to required; outlier appears at most as flavor seed | `voltron` or `artifacts` in `requiredAxes`; LLM told to build an equipment-matters deck |
| O3 | 4 Selesnya tokens seeds + 1 graveyard payoff legend | Legend with sacrifice-and-recur text | Deck identity stays tokens +anthem; `graveyard` / `sacrifice` do NOT dominate `buildInstruction`; legend may be included as value but shouldn't redefine plan | `graveyard` axis labeled "required" when only one seed touches it; instruction says "build a graveyard deck" |
| O4 | 1 card only (single-seed edge case) | Any single card | `graphConfirmedAxes` is empty (no axis can meet the 2-card threshold with only 1 seed); instruction falls back to "no confirmed axis" path — LLM told to prioritize broad role value | Any confirmed axis listed when seed count = 1 |

### O-Series Pass/Fail

- **PASS:** `seedGraph.axisSeedCardCounts[axis] < 2` for all axes touched only by the outlier card.
- **PASS:** `graphConfirmedAxes` does not include axes touched by < 2 distinct seed cards.
- **PASS:** `buildInstruction` text does not direct the LLM to build around a single fringe card's mechanic.
- **PASS:** Final deck score for on-plan cards exceeds score of the outlier's mechanic's payoffs.
- **FAIL:** Any axis in `graphConfirmedAxes` or `requiredAxes` where `axisSeedCardCounts < 2`.

---

## Seed Policy Per-Mode Behavior Scenarios

These scenarios test that the `SeedPolicy` value derived from `currentDeckMode` in GeneratorPanel is passed correctly through `GenerateOptions` and produces the appropriate generator behavior.

| ID | `currentDeckMode` | Expected `seedPolicy` | Entry type used | Expected optimizer behavior |
|----|-------------------|-----------------------|-----------------|---------------------------|
| P1 | `lockExact` | `"locked-core"` | `seedEntries` (full deck incl. quantities) | All seed cards appear at exactly their input quantities; optimizer only gap-fills lands and missing roles; no seed dropped or reduced |
| P2 | `buildAround` | `"locked-core"` | `focusEntries` (nonland only) | All nonland seeds guaranteed to appear; quantities may be adjusted by optimizer; no seed card dropped entirely |
| P3 | `tuneCore` | `"strong-preference"` | `focusEntries` (qty −1 per card) | All nonland seeds present; optimizer may free one copy slot per 2×+ card for upgrades; seed axes treated as secondary (not overriding) priority |
| P4 | `suggestion` | `"inspiration"` | `preferEntries` (nonland only) | Seeds get score bonus; optimizer may drop weakest seeds for better-scoring alternatives; axes used as soft guidance only |
| P5 | `off` | `undefined` | None | Optimizer runs with no seed constraint; deck is built purely from archetype/format scoring |
| P6 | `redefine` (AI only) | `undefined` | None | AI builds from scratch; `seedPolicy` field absent from opts; no seed entries passed |

### P-Series Pass/Fail

- **PASS P1/P2:** Every seed card oracle ID present in final `result.entries` at correct quantity.
- **PASS P3:** Every seed card present; at least one 2×+ seed card has one fewer copy vs. input (within optimizer tolerance).
- **PASS P4:** At least 60% of seed cards present in final deck; no crash or type error; reasoning log shows prefer-bonus applied.
- **PASS P5/P6:** `opts.seedPolicy === undefined`; `opts.seedEntries`, `focusEntries`, and `preferEntries` all undefined; deck generated without seed constraint.
- **FAIL:** Mismatched `seedPolicy` value (e.g., `buildAround` producing `"inspiration"` behavior); type error from missing import; `seedPolicy` key absent from `opts` when mode is `lockExact`.

---

## Known Failure Modes To Watch

1. **Seed over-locking:** Weak/off-plan seeds remain in the final deck because the system treats them as mandatory instead of intent evidence.
2. **Overfitting synergy:** Engine chooses many mechanically related low-power cards and ignores interaction/curve.
3. **Underfitting seed plan:** Final deck becomes generic goodstuff and loses the intended seed identity.
4. **Ambiguity overconfidence:** Four generic cards produce a false narrow archetype with high confidence.
5. **LLM hallucination:** LLM names cards outside the pool or chooses lands despite instructions.
6. **Mana/curve collapse:** Deck follows the plan but cannot cast spells reliably or has an uncompetitive curve.
7. **Single-card axis promotion:** One fringe card with multiple edge types inflates `edgeCount` above the old threshold, incorrectly promoting its axis to `requiredAxes` or `graphConfirmedAxes`. **Fixed** in June 2026 refactor — now uses `axisSeedCardCounts >= 2` threshold.
8. **seedPolicy not forwarded:** `currentDeckMode` set to `lockExact` but `seedPolicy` missing from `opts` — generator falls back to unconstrained behavior despite user intent.

---

## Engineering Next Steps

1. Add unit tests for `analyzeSeeds` using synthetic `CardRecord` fixtures.
2. Add unit tests for `buildSeedSynergyGraph` confirming source→payoff edges.
3. Add prompt snapshot tests for `buildAIPrompts` to ensure seed intent blocks appear.
4. Add an integration smoke harness that runs offline generation for scenario fixtures.
5. Add optional AI smoke tests behind an environment flag so local/API LLMs can be tested without breaking CI.

---

## Release Criterion

The seed Analyze workflow is considered release-ready when:

- At least 6/8 scenarios infer acceptable archetype and axes.
- At least 6/8 generated decks meet viability thresholds.
- Ambiguous seeds are labeled low/medium confidence rather than confidently wrong.
- LLM plan text matches the deterministic seed analysis in at least 6/8 scenarios.
