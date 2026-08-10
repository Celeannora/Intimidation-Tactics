# Hope Estheim / Space-Time Anomaly — Composite vs. Synergy-First Scoring Comparison

Pool size after Standard-legal + seed-role filtering: 1716 cards (raw Scryfall data, 2026-08-10).

## Role counts achieved

- Existing composite engine (Control archetype, generic role/synergy axes): {"enablers":20,"protection":0,"consistency":24,"payoffs":12,"lands":0,"nonlandTotal":36}
- Synergy-first sequential engine (seed-specific Enabler/Protection/Consistency/Payoff): {"enablers":14,"protection":24,"consistency":14,"payoffs":12,"lands":0,"nonlandTotal":36}
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
- [SYNERGY-FIRST] Pick: Season of the Burrow x4 — final=38.0 (base=19.0, gapMult=2.00, satPenalty=0.0, timing=0, prevention=0) — Selected because it fills Consistency, current gap is 4, and it improves payoff access / protection.
- [SYNERGY-FIRST] Pick: Morningtide's Light x4 — final=26.0 (base=12.0, gapMult=1.00, satPenalty=0.0, timing=4, prevention=10) — Selected because it fills Protection, current gap is 0, and it improves early stability / protection.
- [SYNERGY-FIRST] Pick: Gallant Strike x4 — final=22.0 (base=12.0, gapMult=1.00, satPenalty=0.0, timing=10, prevention=0) — Selected because it fills Consistency, current gap is 0, and it improves payoff access / protection.
- [SYNERGY-FIRST] Pick: Long River's Pull x4 — final=22.0 (base=12.0, gapMult=1.00, satPenalty=0.0, timing=10, prevention=0) — Selected because it fills Consistency, current gap is 0, and it improves payoff access / protection.
- [SYNERGY-FIRST] Pick: Battle Menu x2 — final=21.0 (base=11.0, gapMult=1.00, satPenalty=0.0, timing=10, prevention=0) — Selected because it fills Enabler, current gap is 0, and it improves early stability / life gain density / protection.

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
- Season of the Burrow (CMC 5) — seed roles: Protection, Consistency
- Morningtide's Light (CMC 4) — seed roles: Protection
- Gallant Strike (CMC 2) — seed roles: Protection, Consistency
- Long River's Pull (CMC 2) — seed roles: Protection, Consistency
- Battle Menu (CMC 2) — seed roles: Enabler, Protection