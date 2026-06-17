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

## Known Failure Modes To Watch

1. **Seed over-locking:** Weak/off-plan seeds remain in the final deck because the system treats them as mandatory instead of intent evidence.
2. **Overfitting synergy:** Engine chooses many mechanically related low-power cards and ignores interaction/curve.
3. **Underfitting seed plan:** Final deck becomes generic goodstuff and loses the intended seed identity.
4. **Ambiguity overconfidence:** Four generic cards produce a false narrow archetype with high confidence.
5. **LLM hallucination:** LLM names cards outside the pool or chooses lands despite instructions.
6. **Mana/curve collapse:** Deck follows the plan but cannot cast spells reliably or has an uncompetitive curve.

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
