# Hope Estheim / Space-Time Anomaly — Composite vs. Synergy-First Scoring Comparison

Pool size after Standard-legal + seed-role filtering: 1636 cards (raw Scryfall data, 2026-08-12).

## Role counts achieved

- Existing composite engine (Control archetype, generic role/synergy axes): {"enablers":20,"protection":0,"consistency":24,"payoffs":12,"lands":0,"nonlandTotal":36}
- Synergy-first sequential engine (seed-specific Enabler/Protection/Consistency/Payoff): {"enablers":20,"protection":16,"consistency":12,"payoffs":12,"lands":0,"nonlandTotal":36}
- Batched seed-chain engine (synergy-first + re-analysis checkpoints every 6 slots): {"enablers":22,"protection":14,"consistency":12,"payoffs":12,"lands":0,"nonlandTotal":36}
- Target bands: {"enablers":[10,14],"protection":[8,12],"consistency":[6,10],"payoffs":[6,8],"lands":24}

## Feasibility flags — existing composite engine's build
- [WARN] Too little cheap interaction to preserve life total (0 protection cards, target 8-12).
- [WARN] Mana base size (0) outside the stable Azorius control band (23-25) for repeated turns and turn-4 Space-Time Anomaly access.

## Feasibility flags — synergy-first engine's build
- [WARN] Mana base size (0) outside the stable Azorius control band (23-25) for repeated turns and turn-4 Space-Time Anomaly access.

## Pick log — existing composite engine
- [EXISTING] Pick: Haliya, Guided by Light x2 — composite score 149.2 (rolePower=48.3, directional=40.0, synergyMult=1.10, castPenalty=0.0)
- [EXISTING] Pick: Exemplar of Light x4 — composite score 142 (rolePower=43.9, directional=27.6, synergyMult=1.22, castPenalty=0.0)
- [EXISTING] Pick: Enduring Innocence x4 — composite score 149.3 (rolePower=48.3, directional=30.6, synergyMult=1.22, castPenalty=0.0)
- [EXISTING] Pick: Beza, the Bounding Spring x2 — composite score 144.9 (rolePower=43.9, directional=30.6, synergyMult=1.22, castPenalty=0.0)
- [EXISTING] Pick: Forensic Gadgeteer x4 — composite score 146.8 (rolePower=48.3, directional=40.0, synergyMult=1.10, castPenalty=0.0)
- [EXISTING] Pick: Caretaker's Talent x4 — composite score 145.5 (rolePower=43.9, directional=40.0, synergyMult=1.10, castPenalty=0.0)
- [EXISTING] Pick: Marketback Walker x4 — composite score 145.3 (rolePower=46.5, directional=33.2, synergyMult=1.10, castPenalty=0.0)

## Pick log — synergy-first engine
- [SYNERGY-FIRST] Pick: Niko, Light of Hope x2 — final=51.5 (base=19.0, gapMult=2.50, satPenalty=0.0, timing=4, prevention=0) — Selected because it fills Protection, current gap is 8, and it improves early stability / payoff access / protection.
- [SYNERGY-FIRST] Pick: Emeritus of Truce // Swords to Plowshares x4 — final=42.3 (base=18.0, gapMult=2.13, satPenalty=0.0, timing=4, prevention=0) — Selected because it fills Protection, current gap is 6, and it improves early stability / life gain density / protection.
- [SYNERGY-FIRST] Pick: South Pole Voyager x2 — final=40.0 (base=14.0, gapMult=2.00, satPenalty=0.0, timing=6, prevention=0) — Selected because it fills Consistency, current gap is 4, and it improves life gain density / payoff access. [lifegain cadence: repeatable-proactive +6]
- [SYNERGY-FIRST] Pick: Morningtide's Light x4 — final=30.5 (base=12.0, gapMult=1.38, satPenalty=0.0, timing=4, prevention=10) — Selected because it fills Protection, current gap is 2, and it improves early stability / protection.
- [SYNERGY-FIRST] Pick: Kitsa, Otterball Elite x2 — final=28.5 (base=15.0, gapMult=1.50, satPenalty=0.0, timing=6, prevention=0) — Selected because it fills Consistency, current gap is 2, and it improves payoff access.
- [SYNERGY-FIRST] Pick: Gallant Strike x2 — final=22.0 (base=12.0, gapMult=1.00, satPenalty=0.0, timing=10, prevention=0) — Selected because it fills Protection, current gap is 0, and it improves early stability / payoff access / protection.
- [SYNERGY-FIRST] Pick: Wan Shi Tong, Librarian x2 — final=21.0 (base=15.0, gapMult=1.00, satPenalty=0.0, timing=6, prevention=0) — Selected because it fills Consistency, current gap is 0, and it improves payoff access.
- [SYNERGY-FIRST] SHORTFALL: strict role-ceiling rule exhausted all eligible candidates at 30/36 nonland cards (roles at ceiling: Enabler, Protection, Consistency, Payoff). Topping up remaining 6 slots with best-scoring cards regardless of ceiling — see OVERFLOW picks below.
- [SYNERGY-FIRST] OVERFLOW pick: Shattered Acolyte x4 — final=25.0 — added past ceiling to reach the 36-card nonland target; role counts after: {"enablers":18,"protection":16,"consistency":10,"payoffs":12,"lands":0,"nonlandTotal":34}
- [SYNERGY-FIRST] OVERFLOW pick: Stiltzkin, Moogle Merchant x2 — final=24.0 — added past ceiling to reach the 36-card nonland target; role counts after: {"enablers":20,"protection":16,"consistency":12,"payoffs":12,"lands":0,"nonlandTotal":36}

## Pick log — batched seed-chain engine (checkpoints inline)
- [SEED-CHAIN] Checkpoint 1 (seed only, 12 cards): Color balance OK: W 60% / U 40% of colored pips. | Curve OK: 67% of nonland cards are MV<=2.
- [SEED-CHAIN] Pick: Niko, Light of Hope x2 — final=51.5 — Selected because it fills Protection, current gap is 8, and it improves early stability / payoff access / protection.
- [SEED-CHAIN] Pick: Emeritus of Truce // Swords to Plowshares x4 — final=42.3 — Selected because it fills Protection, current gap is 6, and it improves early stability / life gain density / protection.
- [SEED-CHAIN] Checkpoint 2 (18/36 nonland): Color balance: W pip share 72% exceeds 65% threshold — white-leaning candidates penalized x0.86 next batch. | Curve OK: 44% of nonland cards are MV<=2. || Feasibility: WARN: Too little cheap interaction to preserve life total (6 protection cards, target 8-12). ; WARN: Too little draw/filtering to assemble enabler + payoff (2 consistency cards, target 6-10).
- [SEED-CHAIN] Pick: Kitsa, Otterball Elite x2 — final=36.0 — Selected because it fills Consistency, current gap is 4, and it improves payoff access.
- [SEED-CHAIN] Pick: Wan Shi Tong, Librarian x2 — final=28.5 — Selected because it fills Consistency, current gap is 2, and it improves payoff access.
- [SEED-CHAIN] Pick: Long River's Pull x2 — final=26.5 — Selected because it fills Protection, current gap is 2, and it improves early stability / payoff access / protection.
- [SEED-CHAIN] Checkpoint 3 (24/36 nonland): Color balance OK: W 57% / U 43% of colored pips. | Curve OK: 58% of nonland cards are MV<=2.
- [SEED-CHAIN] Pick: Morningtide's Light x4 — final=26.0 — Selected because it fills Protection, current gap is 0, and it improves early stability / protection.
- [SEED-CHAIN] Pick: South Pole Voyager x2 — final=26.0 — Selected because it fills Enabler, current gap is 0, and it improves early stability / life gain density / payoff access. [lifegain cadence: repeatable-proactive +6]
- [SEED-CHAIN] Checkpoint 4 (30/36 nonland): Color balance OK: W 62% / U 38% of colored pips. | Curve OK: 53% of nonland cards are MV<=2.
- [SEED-CHAIN] SHORTFALL: strict role-ceiling rule exhausted candidates at 30/36 — topping up with OVERFLOW picks (still color/curve-adjusted).
- [SEED-CHAIN] OVERFLOW pick: Shattered Acolyte x4 — final=25.0
- [SEED-CHAIN] OVERFLOW pick: Stiltzkin, Moogle Merchant x2 — final=24.0
- [SEED-CHAIN] CONSOLIDATE: moved 2x from Long River's Pull into South Pole Voyager (now 4x) — playset consistency over one-of spread.
- [SEED-CHAIN] Consolidation complete: 2 slots moved into deeper playsets; distinct nonland cards reduced.

## DIVERGENCE — cards picked by ONLY the existing composite engine
(these are the standalone/composite-power shortfalls: individually strong but not seed-synergistic, or seed-synergistic in the wrong role balance)
- Haliya, Guided by Light (CMC 3) — seed roles: Enabler, Consistency
- Exemplar of Light (CMC 4) — seed roles: Enabler, Consistency
- Enduring Innocence (CMC 3) — seed roles: Enabler, Consistency
- Beza, the Bounding Spring (CMC 4) — seed roles: Enabler, Consistency
- Forensic Gadgeteer (CMC 3) — seed roles: Consistency
- Caretaker's Talent (CMC 3) — seed roles: Consistency
- Marketback Walker (CMC 0) — seed roles: Consistency

## DIVERGENCE — cards picked by ONLY the synergy-first engine
- Niko, Light of Hope (CMC 4) — seed roles: Protection, Consistency
- Emeritus of Truce // Swords to Plowshares (CMC 3) — seed roles: Enabler, Protection
- South Pole Voyager (CMC 2) — seed roles: Enabler, Consistency
- Morningtide's Light (CMC 4) — seed roles: Protection
- Kitsa, Otterball Elite (CMC 2) — seed roles: Consistency
- Gallant Strike (CMC 2) — seed roles: Protection, Consistency
- Wan Shi Tong, Librarian (CMC 2) — seed roles: Consistency
- Shattered Acolyte (CMC 2) — seed roles: Enabler, Protection
- Stiltzkin, Moogle Merchant (CMC 1) — seed roles: Enabler, Consistency

## Final 60-card decklist — batched seed-chain engine + real Azorius mana base

Seed package (locked): 4x Hope Estheim, 4x Authority of the Consuls, 4x Space-Time Anomaly.

### Nonland (36)
- 4x Authority of the Consuls (CMC 1)
- 2x Stiltzkin, Moogle Merchant (CMC 1)
- 4x Hope Estheim (CMC 2)
- 2x Kitsa, Otterball Elite (CMC 2)
- 4x Shattered Acolyte (CMC 2)
- 4x South Pole Voyager (CMC 2)
- 2x Wan Shi Tong, Librarian (CMC 2)
- 4x Emeritus of Truce // Swords to Plowshares (CMC 3)
- 4x Morningtide's Light (CMC 4)
- 2x Niko, Light of Hope (CMC 4)
- 4x Space-Time Anomaly (CMC 4)

### Lands (24)
- 3x Floodfarm Verge
- 3x Gleaming Bastion
- 5x Island
- 11x Plains
- 2x Temple of Enlightenment

**Total: 60 cards** (36 nonland + 24 land)

### Mana base construction log
- Added 3x Floodfarm Verge (Enters untapped (conditional)) as nonbasic fixing.
- Added 3x Gleaming Bastion (Enters untapped (conditional)) as nonbasic fixing.
- Added 2x Temple of Enlightenment (Enters tapped) as nonbasic fixing.
- Filled remaining 16 slots with 11x Plains / 5x Island (weighted 71% W / 29% U by colored-pip share).
- Resulting color sources: W=19.0, U=13.0 (Karsten target for a 2-3 pip color at ~turn 3-4 is typically 12-14 sources).