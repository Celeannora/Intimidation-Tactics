# ADR-004: Log-Compressed Synergy Scoring

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Core team

---

## Context and Problem Statement

The V2 scoring pipeline (`scoreEngine.ts`) computes a `CompositeScore` for each candidate card during deck generation. One component of this score is `synergyMultiplier` — a factor derived from how many synergy connections a candidate has with the current deck's seed cards.

Raw synergy connection counts scale with deck size and seed density: a card in a 60-card deck with 6 seeds might have 0–12 raw connections. Using the raw count as a multiplier produces explosive score inflation for highly-connected cards (e.g. "wins" everything with raw count 12 vs. "loses" to everything with raw count 1). This makes the scoring non-linear and unpredictable.

How should synergy connection count be normalised into a well-behaved multiplier?

---

## Decision Drivers

- Scores must be **bounded** — a highly-connected card should not score 12× a singly-connected card
- The multiplier must be **monotonically increasing** — more connections → higher multiplier, always
- The multiplier must be **diminishing returns** — the 6th connection matters less than the 2nd
- Consistent with how Magic players intuit synergy: a card that "fits" is good, but a card that "fits perfectly" isn't infinitely better
- Computationally trivial — `Math.log` is O(1) and branchless

---

## Considered Options

### Option A: Log-compressed multiplier — `1 + log(1 + connectionCount)` ✓ chosen

### Option B: Linear multiplier — `1 + connectionCount * k`

### Option C: Square root compression — `1 + sqrt(connectionCount)`

### Option D: Sigmoid normalisation — `1 / (1 + exp(-k * (x - midpoint)))`

---

## Decision Outcome

**Chosen option: `synergyMultiplier = 1 + Math.log(1 + connectionCount)`**

This formula has the following properties:

| connectionCount | multiplier |
|----------------|-----------|
| 0 | 1.000 (neutral — no penalty for zero synergy) |
| 1 | 1.693 |
| 2 | 2.099 |
| 4 | 2.609 |
| 8 | 3.197 |
| 12 | 3.565 |

The `+1` inside the log prevents `log(0)` (which would be `-Infinity`). The outer `+1` ensures the floor is 1.0 — zero synergy is neutral, not penalising.

The natural log grows quickly from 0 to 1 connections (rewarding the first synergy pair significantly) then flattens, reflecting diminishing returns correctly.

---

## Consequences

### Positive

- Scores are bounded: even infinite connections cannot push the multiplier past ~4–5× for realistic deck sizes
- The formula is one line, has no tunable hyperparameters, and behaves identically across all card types
- Zero-synergy cards are not penalised (multiplier = 1.0) — pure power cards remain viable
- The same formula is used in `scoreCandidates` for batch ranking, ensuring consistent relative ordering

### Negative

- The exact multiplier values (1.69, 2.10, etc.) are not intuitive to explain to users
- Natural log base is arbitrary — `log₂` or `log₁₀` would produce different magnitudes, requiring re-calibration of other score components
- Very high connection counts (>12) compress heavily — in a synergy-dense format, distinction between 12 and 20 connections is lost (~3.56 vs ~3.85)

### Neutral

- The `synergyMultiplier` is one of six components in `CompositeScore`. `castabilityPenalty`, `rolePowerScore`, and `focusBonus` independently bound total scores from other directions, so log-compression only needs to apply to the synergy axis.

---

## Pros and Cons of Rejected Options

### Option B — Linear multiplier

- ✓ Trivially explainable: "each connection adds k points"
- ✗ Score inflation: card with 12 connections scores 12× a card with 1 connection — degenerates into "whoever has the most hub connections wins"
- ✗ Sensitive to the choice of `k` — requires tuning per-format

### Option C — Square root compression

- ✓ Also provides diminishing returns with a different curve shape
- ✗ `sqrt(connectionCount)` reaches 3.46× at 12 connections vs log's 3.56× — negligible difference but sqrt is slightly more aggressive at high values
- ✗ `sqrt(0) = 0` requires the same `+1` guards, making the formula `1 + sqrt(1 + connectionCount)` — not meaningfully simpler than log

### Option D — Sigmoid

- ✓ Smooth S-curve; mid-range values get maximum discrimination
- ✗ Requires tuning two hyperparameters (`k` steepness and `midpoint`)
- ✗ Cards above the midpoint asymptote toward a fixed maximum, losing rank discrimination at the top
- ✗ More computational complexity for negligible quality gain at our scale

---

## More Information

- Implementation: `src/lib/scoreEngine.ts` — `computeCompositeScore`
- Tests (monotonicity, boundary conditions): `src/lib/__tests__/scoreEngine.test.ts`
- Synergy graph that produces `connectionCount`: `src/lib/analysis/synergyGraph.ts`
- Related: [ADR-005](./005-meta-adjustment-bounds.md) (bounds on meta adjustment factors applied on top of composite score)
