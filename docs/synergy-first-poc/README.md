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

## Update: Batched Seed-Chain Loop + Playset Consolidation

Two issues surfaced when running the branch end-to-end:

1. **One-off fragmentation.** The role-room quantity caps, the legendary-2 rule, and batch-boundary
   clipping could each squeeze a pick down to 1 copy, producing a spread of one-ofs that hurts draw
   consistency. Fixes on this branch:
   - **Min-2 rule** — a new nonlegendary pick squeezed to 1 copy is skipped (unless it is the literal
     last slot); the slot goes to deepening an existing playset instead.
   - **`consolidatePlaysets()`** — a final pass that trims the weakest 1-2x nonlegendary fragments and
     reinvests those slots into the highest-scoring fragments up to 4x. Every move is logged as a
     `CONSOLIDATE` line. Seeds, lands, and legendaries are exempt (2x legendaries are intentional —
     extra copies of a legend in hand are dead draws).

2. **No deck-level feedback during generation.** Per-pick role re-scoring existed, but nothing looked
   at the *deck* as a whole mid-build. The batched seed-chain loop (`buildWithBatchedSeedChain`) fixes
   this: every 6 slots it runs `reanalyzeDeck()` — color-pip balance (multiplier floor 0.4 once one
   color exceeds 65% of pips) and curve health (+3 bonus to MV<=2 picks once cheap share drops below
   40% of an 8+ card deck) — and feeds those adjustments into every subsequent `scoreCandidate` call.
   The game-plan anchor stays locked to the original 3-card seed, so re-analysis corrects *derived*
   state (pips, curve, feasibility) without seed drift.

### Measured result (three-way comparison, same 1,638-card pool)

| Engine | Enablers | Protection | Consistency | Payoffs |
| --- | --- | --- | --- | --- |
| Target band | 10-14 | 8-12 | 6-10 | 6-8 (+seed) |
| Existing composite | 20 | **0** | 24 | 12 |
| Synergy-first (strict) | 16 | 18 | 14 | 12 |
| **Batched seed-chain** | **14** | **14** | **14** | **12** |

The batched loop is the only build that lands every role at or near its band, and its color-balance
checkpoint pulled white-pip share from ~82% down to 58% (blue mana sources 4 -> 14), organically
pulling a new blue engine card (Loch Mare) into the deck that neither earlier build found.

![Synergy chart](./synergy-chart.png)

### Loop design (universal, not deck-specific)

```
seed(3 cards) -> analyze -> pick batch of 6 -> re-analyze derived state -> adjust scoring -> next batch
                                   ^                                                            |
                                   +------------------- consolidate playsets <----- final ------+
```

- Batch size 6 balances feedback frequency against churn; per-pick re-scoring still runs inside batches.
- Re-analysis only touches *derived* signals (pips, curve, feasibility) — the seed identity is immutable,
  preventing the "seed dilution" failure mode where mid-build additions redefine the game plan.
- All thresholds (65% pip share, 40% cheap share, batch size) live in one place and are seed-agnostic.

## Update: Pool now sourced from the app's own bulk database

The earlier PoC pools were fetched with targeted Scryfall *search-API queries*
(`f:standard (id<=wu) -t:land`), which bypassed the app's real data path. The
pool is now built by `scripts/fetchBulkPool.ts`, a Node-side mirror of
`src/lib/scryfallUpdate.ts`: it downloads the full `oracle_cards` bulk dataset
(38,626 cards) and filters it with the app's OWN ingest functions
(`isStandardEligible` from `src/lib/scryfall.ts`) — the exact gate
`importWorker.ts` applies — yielding 1,714 WU/colorless candidates + 110 lands.

Running on the real database immediately surfaced cards the narrow queries had
missed (Wan Shi Tong, Technodrome, Long River's Pull) AND exposed three
app-level shortfalls:

1. **No release-date guard in the app ingest.** `toCardRecord` does not store
   `released_at` and nothing gates on it, while Scryfall pre-marks preview
   cards as `standard: legal`. The app itself would import unreleased cards
   (e.g. Gleaming Splendor before 2026-08-14) as playable. Durable fix: store
   `released_at` in `CardRecord` and filter in `isStandardEligible`.

2. **`scryfallUpdate.ts` is broken against the live manifest.** Scryfall's
   bulk manifest no longer exposes a plain-JSON `download_uri`; entries now
   provide `jsonl_download_uri` (gzipped JSONL) behind a per-entry `uri`. The
   controller's `manifest.data.find(...).download_uri` path fetches
   `undefined`. `fetchBulkPool.ts` handles both shapes; the app controller
   needs the same fix.

3. **Classifier false positive (tempo-tax).** `TEMPO_TAX_HINT` matched
   `can't attack|can't block` anywhere in a card's text, so Technodrome's own
   drawback ("can't attack or block unless its power is 6 or greater") earned
   it Enabler. Fixed: tax patterns now only count when the same sentence is
   opponent-directed (`isOpponentTax`).

### New: cost-dependency feasibility check

The bulk pool also exposed a deeper scoring hole: Technodrome
("{T}, Sacrifice another artifact: Draw a card") scored as a Consistency
engine in a deck with ZERO other artifacts — a dead ability in context.
`scoreCandidate` now applies a **cost-dependency penalty** (x0.25) via the
re-analysis loop's `supportCounts`: cards whose activation costs consume
other artifacts/creatures are only credited when the deck actually contains
enough of them. This is exactly the class of error per-card composite scoring
can never catch — the card's value depends on the rest of the deck — and the
batched re-analysis loop is the natural place to enforce it. After the fix,
the seed-chain build correctly swapped Technodrome out for Loch Mare.

### Post-build validation gate (why it matters)

Legality was previously inherited from the pool query. The pool is now
bulk-derived and every card re-checked (Standard-legal, released, max-4,
60 total) before export — the final decklist passes cleanly.
