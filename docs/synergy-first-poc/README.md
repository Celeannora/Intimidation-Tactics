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
cards (see `decklist.md` for the full 60-card output):

| | Enablers | Protection | Consistency | Payoffs |
|---|---|---|---|---|
| Target band | 10-14 | 8-12 | 6-10 | 6-8 |
| Existing composite engine | 20 | **0** | 24 | 12 |
| Synergy-first engine (before hard ceiling) | 14 | 24 | 14 | 12 |
| Synergy-first engine (final, w/ hard ceiling + overflow log) | 16 | 18 | 14 | 12 |

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

## Three real bugs found and fixed while chasing the Protection overshoot

The synergy-first engine's role-gap multiplier (up to 2.5x for a fully
empty role) correctly prioritized filling Protection from zero first.
Getting it to actually respect the 8-12 ceiling instead of overshooting
took three iterations, each exposing a genuine bug rather than a tuning
knob:

1. **Playset sizing ignored role headroom.** The original loop picked
   the single best-scoring card each round and always added it at a flat
   4-of (2-of for legendaries). A card picked while a role's gap was
   still wide could add 4 copies in one shot and blow straight through
   that role's entire 8-12 band in a single pick. Fix: quantity is now
   capped by `roleRoomRemaining()` — the minimum remaining headroom
   across every role the card touches — before it's added.
2. **"At least one open role" was too permissive.** A card tagged with
   two roles (e.g. Enabler *and* Protection) could keep getting picked
   for its open Enabler slot even after Protection was already full,
   because eligibility only required *one* open role, not all of them.
   Every copy still counted toward both roles' tallies, so Protection
   kept climbing as a side effect of picks that were nominally filling
   Enabler. Fix: eligibility now requires every role a card touches to
   have headroom (`allRolesOpen`), not just one.
3. **The fallback branch silently dropped the ceiling rule entirely.**
   When the strict filter found zero eligible candidates, the original
   fallback scored the *entire unfiltered pool* with no role
   restriction at all — defeating the two fixes above the moment the
   easy candidates ran out. Fix: the fallback now still requires at
   least one open role, and the quantity cap (fixed in #1) applies to it
   too, with a genuine `qty === 0` case dropping the card and retrying
   the round rather than force-adding it.

## Remaining, now-fully-transparent shortfall: the target bands don't add up

Even after all three fixes, the strict version of the build (every role
must stay within its ceiling) stalls at **30 of the required 36 nonland
cards** — every role hits its ceiling simultaneously (Enabler 14/14,
Protection 12/12, Consistency 10/10, Payoff 12 fixed by the seed) and at
that point *zero* remaining candidates in a 1,716-card pool have every
role open, because the seed's own payoff count (12, from 4+4+4) plus the
band maximums (14+12+10=36) only just cover the nonland slot count in
the best case, with no slack for a card that happens to be dual-tagged.
This is a spec-level shortfall, not a scoring bug: **the target bands as
written can undershoot a 36-card nonland shell**, and the script now
logs this explicitly (see the `SHORTFALL` line in `comparison-report.md`)
rather than silently stopping short or silently blowing past the ceiling
to compensate. The final 6 slots are added by an explicit `OVERFLOW`
stage — logged card-by-card, pushing Enabler to 16 and Protection to 18
— so the report shows exactly which roles absorbed the overflow and by
how much, rather than hiding it inside a single aggregate number.

Recommended real fix for the general-purpose generator (out of scope for
this branch): widen the target bands' combined range so the sum of
ceilings (minus expected dual-role overlap) reliably exceeds the nonland
total, or explicitly define an overflow-priority order among roles
instead of falling back to raw score.

## Mana base finding: pip-weighted basics correctly expose a color-balance gap

The land stage (previously entirely unimplemented — both engines
reported `lands: 0`) is now implemented using the app's own
`recommendDualLands()` / `countLandSources()` infrastructure from
`src/lib/manaBase.ts`, weighting Plains/Island by each color's real share
of colored mana pips in the finished nonland shell. The result is stark:
**20 Plains / 4 Island**, because the synergy-first shell's actual
colored pips work out to roughly 82% white / 18% blue — most of the
high-scoring Protection/Enabler/Consistency picks happen to be cheap
white cards, while genuinely blue cards (double-blue Jace Reawakened,
Long River's Pull, single-blue-pip Hope Estheim/Niko/Space-Time Anomaly)
are a small minority of the shell. This is not a mana-base bug; it's an
honest reflection of a real coherence gap the classifier doesn't
currently penalize: a card-by-card synergy scorer that only tracks
Enabler/Protection/Consistency/Payoff roles has no signal for "this deck
is supposed to be a two-color deck" and will happily drift toward
mono-white-splash-blue if that's where the highest-scoring seed-role
cards happen to live. A production version of this scorer should add a
color-balance term (e.g. a penalty when one color's pip share exceeds
~70% in a nominally two-color deck) so Space-Time Anomaly's {U} pip and
Hope Estheim's {U} pip stay reliably castable on curve.

## Explicitly out of scope for this branch

- No changes to `scoreEngine.ts`, `scoringConfig.ts`, `roles.ts`, or the
  shared `generator/pipeline.ts` — this is an isolated module + comparison
  script, not a rewrite of the app's default behavior.
- The 24-land mana base is generated only for the synergy-first build's
  final decklist; the existing composite engine's build is left at
  `lands: 0` in the comparison table since the point of this branch is to
  compare nonland card *selection*, not to also land-base the composite
  engine's output.
- Not wired into the UI or the AI provider layer.
