# Implementation Plan

## [Overview]
Align the Intimidation-Tactics MTG deck generator with the mythic-viability research spec defined in `sonar.md`.

The project is a fully offline-first React + Vite + TypeScript PWA that generates Standard-legal MTG decks using local Scryfall data via Dexie/IndexedDB. It already has a deep scaffolding of synergy scoring, Karsten mana math, hypergeometric tools, role assignment, and an AI augmentation layer. However, the `sonar.md` spec defines nine concrete research areas that either partially exist or are entirely missing from the current implementation. This plan closes those gaps methodically.

The nine sonar.md areas map to the following gap categories in the codebase:
- **Mythic viability scoring** — no composite "mythic viable" score or 55–61% win-rate framing exists
- **Card role taxonomy** — `Finisher`, `Enabler`, `Payoff` roles are absent; secondary oracle-text tags (`evasive`, `flexible`, `two_for_one`, `graveyard_filling`) do not exist
- **Delirium and Tokens archetypes** — treated as ThemeId themes, not first-class `Archetype` enum members with dedicated profiles
- **Keyword value matrix** — no per-archetype keyword weighting table (e.g., flying is worth more in Control, haste in Aggro)
- **Rule of 9 enforcement** — no formal 4-of redundancy hard constraint in the generator
- **Tempo + card-advantage named outputs** — these insights are implicit in scoring but are not surfaced as named fields on `GenerateResult`
- **Synergy pair hard constraints** — payoff cards have no enforcement that a minimum number of their source cards are co-present
- **Archetype decision-tree confidence breakdown** — `detectArchetype` returns one winner; sonar.md calls for scored multi-archetype confidence
- **New set onboarding pipeline** — no utility to auto-map newly ingested Scryfall cards to roles/axes

---

## [Types]
Extend and add type definitions to support mythic viability, enriched roles, secondary card tags, and archetype confidence.

### New / Extended Types

#### `src/lib/roles.ts` — extend `CardRole`
```ts
// Current union:
export type CardRole = "Threat" | "Ramp" | "Draw" | "Removal" | "Counter" | "Wipe" | "Discard" | "Protection" | "Utility" | "Recursion" | "Land" | "Combo-Engine";

// New union (add three members):
export type CardRole = "Threat" | "Ramp" | "Draw" | "Removal" | "Counter" | "Wipe"
  | "Discard" | "Protection" | "Utility" | "Recursion" | "Land" | "Combo-Engine"
  | "Enabler"   // sets up synergy triggers (fills graveyard, generates tokens, taps for value)
  | "Payoff"    // rewards synergy triggers (scales with graveyard count, token count, etc.)
  | "Finisher"; // closes the game from a winning board state; high-impact threat with evasion
```

#### `src/lib/roles.ts` — new `SecondaryCardTag`
```ts
export type SecondaryCardTag =
  | "evasive"           // has flying, menace, trample, unblockable, or shadow
  | "flexible"          // modal or can serve >1 function (e.g., adventure, split, saga)
  | "two_for_one"       // replaces itself plus removes/generates another permanent
  | "graveyard_filling" // mills, discards, or puts cards from library to graveyard
  | "haste"             // has or grants haste
  | "lifelink"          // has or grants lifelink
  | "flash"             // has flash
  | "protection"        // has protection, hexproof, indestructible on body
  | "reach"             // has reach
  | "vigilance";        // has vigilance
```

#### `src/lib/types.ts` — extend `CardRecord`
Add optional computed fields (populated at ingestion time or lazily):
```ts
secondaryTags?: SecondaryCardTag[];
```

#### `src/lib/generator/types.ts` — extend `GenerateResult`
```ts
export interface GenerateResult {
  // ... existing fields ...
  mythicViability: MythicViabilityReport;
  tempoScore: number;          // 0–100; measures proactive tempo pressure
  cardAdvantageScore: number;  // 0–100; measures expected card advantage density
}

export interface MythicViabilityReport {
  score: number;               // 0–100 composite
  winRateEstimate: number;     // 0.0–1.0; projected win rate proxy
  pillars: {
    consistency: number;       // 0–100; mana consistency + curve smoothness
    redundancy: number;        // 0–100; Rule-of-9 4-of density
    metaPositioning: number;   // 0–100; threat/interaction ratio vs meta expectation
  };
  label: "not-viable" | "fringe" | "mythic-viable" | "tier-1";
  notes: string[];             // human-readable diagnostic messages
}
```

#### `src/lib/archetype.ts` — extend `Archetype`
```ts
// Current:
export type Archetype = "aggro" | "control" | "midrange" | "combo" | "aggro-control" | "unknown";

// Extended:
export type Archetype = "aggro" | "control" | "midrange" | "combo" | "aggro-control"
  | "tempo" | "delirium" | "tokens" | "unknown";
```

#### `src/lib/archetype.ts` — new `ArchetypeConfidence`
```ts
export interface ArchetypeConfidence {
  primary: Archetype;
  scores: Record<Archetype, number>;   // 0–100 per archetype
  confidence: number;                   // 0–1; how decisive the primary is
  signals: string[];                    // human-readable signal list
}
```

#### `src/lib/config/scoringConfig.ts` — new `KeywordValueMatrix`
```ts
export type MTGKeyword =
  | "flying" | "menace" | "trample" | "haste" | "lifelink"
  | "deathtouch" | "vigilance" | "flash" | "reach" | "first_strike"
  | "double_strike" | "hexproof" | "indestructible" | "ward" | "convoke"
  | "delve" | "surveil" | "mill" | "self_mill" | "token_gen" | "sacrifice";

export type KeywordValueMatrix = Record<Archetype, Partial<Record<MTGKeyword, number>>>;
// Values are multipliers (1.0 = neutral, 1.5 = high value, 0.7 = low value for that archetype)
```

#### `src/lib/generator/types.ts` — new `SynergyPairConstraint`
```ts
export interface SynergyPairConstraint {
  payoffAxis: MechanicAxis;
  minSourceCount: number;   // minimum source cards required if any payoff is included
  minSourceCopies: number;  // minimum total copies (sources × count) in deck
}
```

---

## [Files]

New files to be created and existing files to be modified across the generator, scoring, archetype, and config layers.

### New Files

| File | Purpose |
|------|---------|
| `src/lib/mythicViability.ts` | Computes `MythicViabilityReport` from a generated deck; implements three-pillar scoring and win-rate proxy |
| `src/lib/generator/synergyConstraints.ts` | Defines `SYNERGY_PAIR_CONSTRAINTS` per archetype and exports `validateSynergyPairs(deck, archetype)` |
| `src/lib/onboarding/newSetPipeline.ts` | Utility that takes raw `CardRecord[]` from a new set, runs role/axis assignment, and returns enriched records with `secondaryTags` populated |
| `src/lib/__tests__/mythicViability.test.ts` | Unit tests for three-pillar scoring, label thresholds, and win-rate proxy |
| `src/lib/__tests__/synergyConstraints.test.ts` | Unit tests for `validateSynergyPairs` with aggro/delirium/combo fixture decks |
| `src/lib/__tests__/newSetPipeline.test.ts` | Unit tests for auto-role and auto-axis assignment on synthetic card fixtures |

### Existing Files to Modify

| File | Changes |
|------|---------|
| `src/lib/roles.ts` | Add `Enabler`, `Payoff`, `Finisher` to `CardRole`; add `SecondaryCardTag` type; extend `assignRoles()` detection logic; add `deriveSecondaryTags(card)` function |
| `src/lib/types.ts` | Add `secondaryTags?: SecondaryCardTag[]` to `CardRecord` |
| `src/lib/archetype.ts` | Add `tempo`, `delirium`, `tokens` to `Archetype` type; refactor `detectArchetype()` to return `ArchetypeConfidence`; add `detectArchetypeSimple()` backward-compat wrapper |
| `src/lib/generator/types.ts` | Add `MythicViabilityReport`, `SynergyPairConstraint` interfaces; extend `GenerateResult` with `mythicViability`, `tempoScore`, `cardAdvantageScore` |
| `src/lib/config/archetypeProfiles.ts` | Add profiles for `tempo`, `delirium`, `tokens` archetypes; ensure curve targets, land counts, and role slot budgets are present for all 8 archetypes |
| `src/lib/config/scoringConfig.ts` | Add `KEYWORD_VALUE_MATRIX: KeywordValueMatrix`; add `MTGKeyword` type |
| `src/lib/generator/weights.ts` | Integrate `KEYWORD_VALUE_MATRIX` into card scoring at weight-application stage |
| `src/lib/generator/roleTargets.ts` | Add `Enabler`, `Payoff`, `Finisher` slot targets for each archetype; extend `RoleTarget` interface if needed |
| `src/lib/generator/generator.ts` | After deck assembly: (1) call `validateSynergyPairs`; (2) call `computeMythicViability`; (3) call `computeTempoScore`/`computeCardAdvantageScore`; attach to `GenerateResult` |
| `src/lib/generator/pipeline.ts` | Integrate Rule of 9 enforcement pass: after role-target filling, verify 4-of redundancy for key roles; cut/replace if under threshold |
| `src/lib/scoreEngine.ts` | Add `computeTempoScore(deck, archetype)` and `computeCardAdvantageScore(deck)` as exported named functions |
| `src/lib/analysis/seedAnalyzer.ts` | Return `ArchetypeConfidence` instead of raw `Archetype`; expose `confidence` and `scores` fields in `SeedSummary` |
| `src/lib/db.ts` | Add `secondaryTags` to the Dexie schema for `CardRecord` (optional nullable column, no migration required) |
| `src/components/GeneratorPanel.tsx` | Display `mythicViability.label` badge and three-pillar breakdown; show `tempoScore` and `cardAdvantageScore` in the deck stats panel |
| `src/components/DeckStats.tsx` | Add `MythicViabilityPanel` sub-section showing score, label, pillar bars, and notes |

---

## [Functions]

New functions and modifications to existing functions across the scoring, role, archetype, and generator layers.

### New Functions

| Function | File | Signature | Purpose |
|----------|------|-----------|---------|
| `computeMythicViability` | `src/lib/mythicViability.ts` | `(deck: DeckEntry[], archetype: Archetype, report: ConsistencyReport): MythicViabilityReport` | Computes three-pillar score and label |
| `computeConsistencyPillar` | `src/lib/mythicViability.ts` | `(deck: DeckEntry[], report: ConsistencyReport): number` | 0–100; uses Karsten pip satisfaction + hand sim hit rates |
| `computeRedundancyPillar` | `src/lib/mythicViability.ts` | `(deck: DeckEntry[]): number` | 0–100; Rule-of-9: ratio of 4-of threats+engines vs total threat+engine slots |
| `computeMetaPositioningPillar` | `src/lib/mythicViability.ts` | `(deck: DeckEntry[], archetype: Archetype): number` | 0–100; threat/interaction ratio vs archetype-ideal from `archetypeProfiles` |
| `winRateProxy` | `src/lib/mythicViability.ts` | `(score: number): number` | Maps 0–100 composite score to 0.45–0.65 win rate estimate via linear interpolation |
| `mythicViabilityLabel` | `src/lib/mythicViability.ts` | `(score: number): MythicViabilityReport["label"]` | `<40` → not-viable, `40–54` → fringe, `55–74` → mythic-viable, `75+` → tier-1 |
| `deriveSecondaryTags` | `src/lib/roles.ts` | `(card: CardRecord): SecondaryCardTag[]` | Scans oracle text for keywords and returns matching secondary tags |
| `isFinisher` | `src/lib/roles.ts` | `(card: CardRecord): boolean` | True if card is Threat with evasion and CMC ≥ 4 or has game-ending activated ability |
| `isEnabler` | `src/lib/roles.ts` | `(card: CardRecord): boolean` | True if card sets up graveyard/token/sacrifice synergies without itself being the payoff |
| `isPayoff` | `src/lib/roles.ts` | `(card: CardRecord): boolean` | True if card scales or triggers from graveyard count, token count, or sacrifice triggers |
| `computeTempoScore` | `src/lib/scoreEngine.ts` | `(deck: DeckEntry[], archetype: Archetype): number` | 0–100; low-curve threats + interaction on opponent's turn; flash + instant count weighted |
| `computeCardAdvantageScore` | `src/lib/scoreEngine.ts` | `(deck: DeckEntry[]): number` | 0–100; counts draw spells, two-for-ones, cantrips, and ETB draw effects |
| `validateSynergyPairs` | `src/lib/generator/synergyConstraints.ts` | `(deck: DeckEntry[], archetype: Archetype): SynergyViolation[]` | Returns list of violations where payoffs exist without minimum sources |
| `detectArchetypeWithConfidence` | `src/lib/archetype.ts` | `(deck: DeckEntry[] \| CardRecord[]): ArchetypeConfidence` | Full multi-archetype scored confidence detection |
| `detectArchetype` | `src/lib/archetype.ts` | `(deck: DeckEntry[] \| CardRecord[]): Archetype` | Backward-compat wrapper calling `detectArchetypeWithConfidence().primary` |
| `runNewSetPipeline` | `src/lib/onboarding/newSetPipeline.ts` | `(cards: CardRecord[]): EnrichedCardRecord[]` | Runs `assignRoles`, `buildSynergyProfile`, `deriveSecondaryTags` on each card |
| `applyKeywordValueMatrix` | `src/lib/generator/weights.ts` | `(baseScore: number, card: CardRecord, archetype: Archetype): number` | Applies `KEYWORD_VALUE_MATRIX` multipliers to a card's base score |
| `enforceRuleOfNine` | `src/lib/generator/pipeline.ts` | `(slots: DeckSlot[], archetype: Archetype): DeckSlot[]` | Post-fill pass: ensures key role slots hit ≥3 copies of each critical card |

### Modified Functions

| Function | File | Changes |
|----------|------|---------|
| `assignRoles` | `src/lib/roles.ts` | Call `isEnabler`, `isPayoff`, `isFinisher` helpers; append to returned role array instead of single role |
| `detectArchetype` (current implementation) | `src/lib/archetype.ts` | Renamed to `detectArchetypeWithConfidence`; returns `ArchetypeConfidence`; old `detectArchetype` becomes wrapper |
| `generateDecks` | `src/lib/generator/generator.ts` | After deck assembly: run `validateSynergyPairs`, compute `mythicViability`, `tempoScore`, `cardAdvantageScore`, attach to each `GenerateResult` |
| `buildPipeline` / core pipeline | `src/lib/generator/pipeline.ts` | Add `enforceRuleOfNine` as final pre-validation pass |
| `scoreCard` / `applyWeights` | `src/lib/generator/weights.ts` | Call `applyKeywordValueMatrix` on each candidate score |
| `analyzeSeeds` | `src/lib/analysis/seedAnalyzer.ts` | Return `archetypeConfidence: ArchetypeConfidence` alongside current fields in `SeedSummary` |

---

## [Classes]

No new classes are required; the codebase uses functional modules exclusively. No class modifications needed.

---

## [Dependencies]

No new npm packages are required; all implementation uses existing project dependencies.

The existing stack that covers all needs:
- `dexie` — IndexedDB schema extension for `secondaryTags`
- `zustand` — state already handles deck results; `mythicViability` fields flow through existing store shape
- TypeScript strict mode — all new types must satisfy existing `tsconfig.json` strict rules
- `vitest` — existing test runner for new test files

The only config change: the `db.ts` Dexie schema version should be bumped if `secondaryTags` is indexed (optional — as a non-indexed nullable field it requires no version bump).

---

## [Testing]

New test files target the three highest-risk new modules with unit and integration coverage.

### New Test Files

**`src/lib/__tests__/mythicViability.test.ts`**
- Test `computeConsistencyPillar` with a smooth aggro curve (expect >70) and a land-light deck (expect <40)
- Test `computeRedundancyPillar` with a 4-of threat deck (expect >80) and a singleton threat deck (expect <30)
- Test `computeMetaPositioningPillar` with ideal aggro ratio vs control ratio
- Test label thresholds: score 39 → `not-viable`, 55 → `mythic-viable`, 75 → `tier-1`
- Test `winRateProxy` values at score 0, 50, 100

**`src/lib/__tests__/synergyConstraints.test.ts`**
- Test `validateSynergyPairs` with a delirium deck that has 4 payoffs and only 1 source → expect violation
- Test clean combo deck (4 enablers, 4 payoffs) → expect no violations
- Test aggro deck with no payoff cards → expect no violations (constraint is payoff-triggered)

**`src/lib/__tests__/newSetPipeline.test.ts`**
- Test `runNewSetPipeline` with synthetic card fixtures covering creature, instant, enchantment, land
- Verify `Finisher` role assigned to a 5/5 flier at CMC 5
- Verify `Enabler` role assigned to a "put top 2 cards of your library into graveyard" card
- Verify `secondaryTags` includes `graveyard_filling` for mill cards

### Existing Tests to Update

| Test File | Update Required |
|-----------|----------------|
| `src/lib/__tests__/scoreEngine.test.ts` | Add tests for `computeTempoScore` and `computeCardAdvantageScore` |
| `src/lib/generator/__tests__/generator.test.ts` | Assert `GenerateResult` includes `mythicViability`, `tempoScore`, `cardAdvantageScore` |
| `src/lib/__tests__/seedAnalyzer.test.ts` | Assert `SeedSummary` includes `archetypeConfidence` with scores for each archetype |
| Any test importing `detectArchetype` | Verify backward-compat wrapper still returns `Archetype` string |

---

## [Implementation Order]

Changes ordered to minimize breaking the existing pipeline: types first, then pure-function modules, then integration into generator, then UI last.

1. **Extend `CardRole` and add `SecondaryCardTag`** in `src/lib/roles.ts` — foundational type, nothing yet depends on new members
2. **Add `secondaryTags` to `CardRecord`** in `src/lib/types.ts` as optional field
3. **Add `tempo`, `delirium`, `tokens` to `Archetype`** in `src/lib/archetype.ts`; refactor `detectArchetype` → `detectArchetypeWithConfidence`; add backward-compat wrapper
4. **Add `MythicViabilityReport`, `SynergyPairConstraint` to `GenerateResult`** in `src/lib/generator/types.ts`
5. **Implement `deriveSecondaryTags`, `isEnabler`, `isPayoff`, `isFinisher`** in `src/lib/roles.ts`; extend `assignRoles`
6. **Add archetype profiles for `tempo`, `delirium`, `tokens`** in `src/lib/config/archetypeProfiles.ts`
7. **Add `KEYWORD_VALUE_MATRIX`** in `src/lib/config/scoringConfig.ts`
8. **Add `Enabler`, `Payoff`, `Finisher` slot targets** for all 8 archetypes in `src/lib/generator/roleTargets.ts`
9. **Implement `computeMythicViability` and helpers** in `src/lib/mythicViability.ts` (new file)
10. **Implement `computeTempoScore` and `computeCardAdvantageScore`** in `src/lib/scoreEngine.ts`
11. **Implement `SYNERGY_PAIR_CONSTRAINTS` and `validateSynergyPairs`** in `src/lib/generator/synergyConstraints.ts` (new file)
12. **Implement `enforceRuleOfNine`** in `src/lib/generator/pipeline.ts`; integrate into pipeline
13. **Integrate `applyKeywordValueMatrix`** in `src/lib/generator/weights.ts`
14. **Wire new scoring outputs into `generateDecks`** in `src/lib/generator/generator.ts`
15. **Extend `analyzeSeeds` to return `archetypeConfidence`** in `src/lib/analysis/seedAnalyzer.ts`
16. **Implement `runNewSetPipeline`** in `src/lib/onboarding/newSetPipeline.ts` (new file)
17. **Write new test files** (`mythicViability.test.ts`, `synergyConstraints.test.ts`, `newSetPipeline.test.ts`)
18. **Update existing test files** for changed signatures
19. **Update `DeckStats.tsx`** to show `MythicViabilityPanel` with pillar bars
20. **Update `GeneratorPanel.tsx`** to show `mythicViability.label` badge and tempo/card-advantage stats
