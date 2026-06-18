# Axis-Sequential Deck Generation — Design Document

## Overview

The axis-sequential system replaces the single-pass AI prompt with a **rotating, debt-balanced
pick chain** that mirrors how a human deckbuilder thinks across multiple axes of play. Rather than
asking the LLM to build an entire deck in one shot, each step in the chain targets a specific axis
(hand attack, removal, threat, etc.), sees the current spine, and picks the best card for that slot.

---

## Core Concepts

### 1. Axes

An **axis** is a strategic role a card can fill. Every card in the pool is tagged with the axes
its *primary effect clauses* match. Costs, reminder text, and cycling lines are stripped before
matching so noise (e.g. "Cycling — Discard this card: Draw a card") doesn't leak into the wrong axis.

| Axis | What it means |
|------|--------------|
| `hand_attack` | Strips opponent's hand proactively |
| `removal` | Kills permanents already on the battlefield |
| `drain` | Swings the life total directly |
| `discard_payoff` | Gets better as the opponent empties their hand |
| `evasive_threat` | Closes games through evasion / combat damage triggers |
| `recursion` | Returns cards from the graveyard |
| `sacrifice` | Converts creatures into resources |
| `card_advantage` | Draws cards, surveil, scry |
| `boardwipe` | Resets the entire board |
| `tutor` | Searches the library for specific pieces |

### 2. Color Catalog

Each color has a base weight for every axis it supports (3 = PRIMARY, 2 = High, 1 = Medium, 0 = absent).
Multicolor decks combine weights: axes both colors support promote +1, axes only one color supports
take the lower weight.

**Mono-Black base weights:**

```
hand_attack    2   removal        2   drain          2
discard_payoff 1   tutor          1   recursion      1
sacrifice      1   evasive_threat 1   card_advantage 1
boardwipe      1
```

### 3. Seed Inference

Seeds determine the **primary identity** of the deck. The system:

1. Parses each seed's oracle text into discrete effect clauses (stripping costs/reminders)
2. Detects which axes the seeds mechanically belong to
3. Promotes those axes to PRIMARY (weight 3) in the derived axis list
4. Promotes support axes +1 via a static support map

```
Duress          → [hand_attack]
Intimidation Tactics → [hand_attack]

hand_attack promoted → PRIMARY (3)
removal promoted     → HIGH (2+1 = supports hand_attack identity)
discard_payoff promoted → HIGH (1+1 = supports hand_attack identity)
```

### 4. Pool-Calibrated Floors

Each axis gets a **floor** — the target number of copies to fill by end of build.
Floors are calibrated against the actual pool supply so the chain never chases
an axis the pool can't fill.

```
raw_floor  = min(weight_target, pool_supply * 0.50)
adj_floor  = raw_floor - seed_contribution   ← KEY: seeds pre-credit their axes
```

The adjusted floor is what the **rotation chain** must fill. Seeds are credited before
step 1 fires, so the rotation opens with an accurate picture of what's already covered.

**Weight targets:** PRIMARY → 12 copies, High → 8 copies, Medium → 4 copies

### 5. Interleaved Rotation

Axes are slotted into a rotation cycle proportional to their weight:
- PRIMARY axes appear 3× per full cycle
- High axes appear 2× per cycle
- Medium axes appear 1× per cycle

Within each weight tier, axes are round-robined so no two consecutive slots
target the same axis.

Example rotation for Duress + Intimidation Tactics (mono-black):
```
hand_attack → discard_payoff → boardwipe → removal → drain → card_advantage →
hand_attack → evasive_threat → recursion → removal → discard_payoff → sacrifice → ...
```

### 6. Debt Override

At each step, after selecting the base rotation axis, the system checks whether any axis
has fallen critically behind its proportional floor (deficit ≥ 2.5 copies at current progress).
If so, the worst-deficit axis **overrides** the scheduled pick for that step.

**Override dampening:** if the same axis overrides more than N consecutive steps without
clearing its debt (indicating the pool genuinely can't fill it), it is suppressed for one
full cycle so the rotation can breathe.

### 7. Quantity Logic (Step-Decay)

Copy counts taper as the chain progresses:
- Steps 0–30% of total: up to 4 copies
- Steps 30–60%: up to 3 copies
- Steps 60–100%: up to 2 copies

PRIMARY-axis picks get +1 max (identity cards warrant full playsets).
High-CMC picks are capped regardless of step: CMC 4 → max 1, CMC 3 → max 2, CMC 5+ → always 1.

---

## Simulation Results (Duress + Intimidation Tactics, Mono-Black Standard)

**Final deck — 60 cards, 8 steps**

```
Step 1  hand_attack → ⚡removal       Feed the Swarm       +4  (removal empty, override fires)
Step 2  discard_pay → ⚡drain         Starscape Cleric     +4  (drain empty)
Step 3  boardwipe                     Abyssal Harvester    +2
Step 4  removal                       Eaten Alive          +4
Step 5  drain                         Vengeful Bloodwitch  +4
Step 6  card_adv → ⚡hand_attack      Burglar Rat          +4  (hand_attack adj floor not met)
Step 7  hand_attack → ⚡card_adv      Corrupted Conviction +3
Step 8  evasive_th → ⚡recursion      Reassembling Skeleton +3
```

**Final axis coverage:**

```
hand_attack      seeds:8 + chain:4  / 4  needed  ✓ 100%  [PRIMARY]
removal          seeds:0 + chain:10 / 12 needed  ↑  83%  [PRIMARY]
drain            seeds:0 + chain:8  / 8  needed  ✓ 100%  [High]
evasive_threat   seeds:0 + chain:4  / 8  needed  ↑  50%  [High]
discard_payoff   seeds:0 + chain:0  / 2  needed  ↑   0%  [High]  ← only 1 card in pool
sacrifice        seeds:0 + chain:7  / 4  needed  ✓ 175%  [Medium]
card_advantage   seeds:0 + chain:3  / 4  needed  ↑  75%  [Medium]
recursion        seeds:0 + chain:3  / 4  needed  ↑  75%  [Medium]
boardwipe        seeds:0 + chain:2  / 4  needed  ↑  50%  [Medium]
tutor            seeds:0 + chain:0  / 4  needed  ↑   0%  [Medium]
```

**Mana curve:** CMC1 15x | CMC2 19x | CMC3 2x — aggressive, low-to-the-ground

**MTGA import:**
```
4 Duress
4 Intimidation Tactics
4 Eaten Alive
3 Corrupted Conviction
4 Feed the Swamp
4 Starscape Cleric
4 Vengeful Bloodwitch
4 Burglar Rat
3 Reassembling Skeleton
2 Abyssal Harvester
2 Takenuma, Abandoned Mire
1 Demolition Field
21 Swamp
```

---

## Known Remaining Gaps

| Gap | Root cause | Planned fix |
|-----|-----------|-------------|
| `discard_payoff` 0% | Only 1 card in Standard pool | Acceptable — pool-supply cap correctly suppressed floor to 2 |
| `evasive_threat` 50% | Rotation ran out of steps before filling | Increase TOTAL_STEPS or lower floor for medium axes |
| `tutor` 0% | Same as above — lower-priority axis crowded out | Acceptable in 8-step chain |
| `removal` 83% | Floor of 12 is ambitious for 8 steps | Consider removal floor = 8 for aggro-identity decks |

---

## Next Steps (app integration)

1. Port `parse_effect_clauses()` + `card_axes_strict()` into `src/lib/ai/axisEngine.ts`
2. Port color catalog + seed inference into `inferAxes(seedCards, colorIdentity)`
3. Port pool-calibrated floor calculation into `calibrateFloors(axes, pool)`
4. Inject axis deficit context into `buildAIPrompts()` per sequential step
5. Replace manual rotation array with runtime rotation derived from `inferAxes` output
6. Add `onAxisDeficit` callback to `generateDeckAISequential` config for UI display
