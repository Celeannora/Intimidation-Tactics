# ADR-005: Meta Adjustment Bounds

**Status:** Accepted  
**Date:** 2026-06-15  
**Deciders:** Core team

---

## Context and Problem Statement

The deck generator allows users to tune a "meta adjustment" slider that shifts the scoring pipeline toward aggro/tempo (low-end pressure, low CMC) or control/late-game (high-value finishers, high CMC). This adjustment is applied on top of the base `CompositeScore` from the V2 scoring engine.

Without bounds, a maximum-aggro adjustment could multiply the impact of low-CMC cards by an arbitrary large factor, completely dominating the synergy and role-power components of the score. Conversely, an unbounded control adjustment could make 1-drop creatures score negatively. Both extremes produce degenerate outputs.

What bounds should be placed on meta adjustment factors to keep composite scores well-behaved?

---

## Decision Drivers

- Meta adjustment should meaningfully shift deck composition (otherwise it's useless)
- It must **not** fully override synergy and role-power signals (otherwise seed cards lose meaning)
- Score components must remain **non-negative** — a negative total score would invert sort order
- The adjustment must be symmetric at the midpoint (neutral adjustment = no change)
- Bounds must be simple enough to explain in UI tooltips

---

## Decision

Meta adjustment factors are clamped to the range **[0.5, 2.0]**.

| Slider position | Multiplier applied |
|----------------|-------------------|
| Full control (max) | 2.0× on control-axis scores, 0.5× on aggro-axis scores |
| Neutral (mid) | 1.0× on all scores (identity) |
| Full aggro (max) | 2.0× on aggro-axis scores, 0.5× on control-axis scores |

### Rationale for 0.5–2.0

**Lower bound 0.5×:**  
Halving a score component is the most aggressive discount that keeps it positive and influential. At 0.5×, a signal contributes half its normal weight — enough to be de-emphasised without being ignored. Going below 0.5× (e.g. 0.1×) would effectively zero out the signal, making meta adjustment into a binary on/off switch.

**Upper bound 2.0×:**  
Doubling a score component is a strong but not catastrophic boost. At the log-compressed synergy multiplier (max ~3.56×), doubling the meta axis produces a combined factor of up to ~7.1× on a highly-connected, on-meta card. This is the practical ceiling — beyond 2.0×, meta factors would overwhelm every other scoring dimension.

**Symmetry:**  
The 0.5–2.0 range is symmetric in log space: `log(2.0) = -log(0.5) ≈ 0.693`. This means "full aggro" and "full control" are equidistant from neutral on a multiplicative scale, so the slider is perceptually linear.

---

## Implementation

```ts
// Clamp helper used at the meta-adjustment application site
const META_FACTOR_MIN = 0.5;
const META_FACTOR_MAX = 2.0;

function clampMetaFactor(raw: number): number {
  return Math.max(META_FACTOR_MIN, Math.min(META_FACTOR_MAX, raw));
}
```

The clamped factor is applied multiplicatively to the `directionalScore` component of `CompositeScore` before summing into `total`:

```
total = synergyMultiplier * rolePowerScore * clampedMetaFactor
      + compositionBonus + focusBonus + keywordBonus + preferBonus
      - castabilityPenalty
```

Because `clampedMetaFactor` is always ≥ 0.5, and `rolePowerScore` / `synergyMultiplier` are always ≥ 0, the multiplicative cluster is always ≥ 0. The subtracted `castabilityPenalty` is bounded by a separate invariant (see `scoreEngine.ts`) ensuring it cannot exceed the sum of the positive components.

---

## Consequences

### Positive

- Users can meaningfully customise deck speed/style without destabilising seed-driven selection
- All scores remain positive — sort order is never inverted by a meta preference
- The bounds are simple enough to surface in a UI tooltip: "Adjusts card weighting by up to 2×"
- Symmetric log-space bounds mean the slider is perceptually linear

### Negative

- The 0.5–2.0 range is somewhat arbitrary — a user wanting an extreme mono-aggro mana curve will find the engine still includes some mid-range cards
- Tuning the bounds requires understanding the interaction with log-compressed synergy scores — not obvious to a casual contributor

### Neutral

- These bounds apply only to the `directionalScore` axis. The `focusBonus`, `keywordBonus`, `preferBonus`, and `compositionBonus` components are unaffected by meta adjustment, preserving seed-alignment signal at all slider positions.

---

## Review Triggers

This decision should be revisited if:
- User testing reveals the full-aggro / full-control outputs are not distinct enough (consider raising the upper bound to 3.0×)
- Score total goes negative in edge cases (examine castabilityPenalty bounds first)
- A new scoring component is added that interacts with meta adjustment

---

## More Information

- Score engine implementation: `src/lib/scoreEngine.ts`
- Score component tests: `src/lib/__tests__/scoreEngine.test.ts`
- Log-compressed synergy multiplier: [ADR-004](./004-log-compressed-synergy.md)
