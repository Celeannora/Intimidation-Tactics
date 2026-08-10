# Synergy-First Deckbuilding — Proof of Concept

Branch: `synergy-first/hope-estheim-space-time-anomaly`
Seed: Hope Estheim, Authority of the Consuls, Space-Time Anomaly (Standard, Azorius lifegain-mill-control)

## What this proves

The existing deck generator scores every candidate card with a single
**composite** score (`src/lib/scoreEngine.ts`): role-power (using a
generic archetype role multiplier) + directional/synergy axis score +
cross-axis composition bonus + castability penalty, all blended into one
number. That composite score is computed independently for each candidate
and is not re-weighted based on which specific roles the in-progress deck
is currently missing for *this seed's specific two-clock mechanic*
(life-gained-this-turn for Hope vs. total-life-total for Space-Time
Anomaly).

This proof of concept adds a second, deliberately narrow scorer
(`src/lib/generator/hopeEstheimSynergy.ts`) that classifies every card into
seed-specific roles (Enabler / Protection / Consistency / Payoff — as
defined by how it actually interacts with Hope, Space-Time Anomaly, and
Authority of the Consuls' Oracle text) and re-scores the *entire remaining
pool* after every single pick against the deck's current role-gap and
payoff-saturation state.

`scripts/hopeEstheimComparison.ts` runs both scorers against the same real
Standard-legal WU card pool (pulled from the Scryfall API — see
`pool_data/` at the workspace root, not checked in here) and logs a
card-by-card divergence report.

## Headline finding

Run against 1,716 real Standard-legal, non-seed white/blue/colorless
cards:

| | Enablers | Protection | Consistency | Payoffs |
|---|---|---|---|---|
| Target band | 10-14 | 8-12 | 6-10 | 6-8 |
| Existing composite engine | 20 | **0** | 24 | 12 |
| Synergy-first engine | 14 | 24 | 14 | 12 |

The existing composite engine's sequential top-score pick, run unmodified
across 7 rounds of "add the single highest-scoring remaining card," never
once selected a card classified as Protection (removal, counterspells,
sweepers, or player-facing damage prevention) — because its role-power
term uses a generic "Control" archetype multiplier and its synergy axes
are generic mechanic axes (graveyard count, token count, etc.), not
"does this preserve the life total that Space-Time Anomaly and Hope both
depend on." The feasibility check in the new module correctly flags this
as a hard problem: **"Too little cheap interaction to preserve life total
(0 protection cards, target 8-12)."** A deck with zero removal/counters/
sweepers cannot reliably survive to the turns where its life-gain-to-mill
plan pays off — this is exactly the standalone/composite-power shortfall
the proof of concept set out to demonstrate.

The synergy-first engine's role-gap multiplier (up to 2.5x for a fully
empty role) correctly prioritized filling Protection from zero, then
rotated into Consistency and Enabler once each role's floor was reached.
See `comparison-report.md` in this folder for the full pick-by-pick log
and per-card seed-role classification for every divergent card.

## Known follow-on issue surfaced by this run

The synergy-first engine currently over-corrects: once Protection cleared
its floor it kept selecting more Protection past the 8-12 target ceiling
(ending at 24) before rotating fully into other roles, because the
per-round loop always takes the single global-best card rather than
enforcing a hard per-role cap during the fill pass. The role-gap
multiplier now fades above the ceiling (see `roleGapMultiplier` in
`hopeEstheimSynergy.ts`), but a hard ceiling clamp (skip a role entirely
once at its target ceiling, the way `enforceRuleOfNine` in
`generator/pipeline.ts` already does for the shared engine) would be the
next fix before this logic is proposed for the general-purpose generator.

## Explicitly out of scope for this branch

- No changes to `scoreEngine.ts`, `scoringConfig.ts`, `roles.ts`, or the
  shared `generator/pipeline.ts` — this is an isolated module + comparison
  script, not a rewrite of the app's default behavior.
- No mana base / land selection logic yet (both engines report `lands: 0`
  above — nonland shell only, land count is a separate follow-up).
- Not wired into the UI or the AI provider layer.
