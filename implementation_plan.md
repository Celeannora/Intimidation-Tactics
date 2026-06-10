# Implementation Plan: Deck Analysis Engine

Build an interactive Deck Analysis Engine within the existing MTG Deck Builder that parses a deck into functional roles, evaluates synergies, computes statistics, and generates a structured analysis report with a temperature-controlled interpretive frame.

## Overview

The existing codebase has strong foundations for card role assignment (`roles.ts`), synergy scoring (`synergyModel.ts`, `scoreEngine.ts`), archetype detection (`archetype.ts`), consistency simulations (`consistencyReport.ts`, `handSimulator.ts`), and statistical calculations (`manaBase.ts`, `hypergeometric.ts`). The Deck Analysis Engine will compose these into a unified pipeline that:

1. Parses every card in the deck into functional roles (Primary: RAMP, DRAW, REMOVAL, WRATH, PROTECTION, WINCON, COMBO PIECE, SUPPORT, UTILITY, FILLER — plus secondary tags)
2. Performs synergy analysis (combo detection, synergy clusters with TIGHT/LOOSE/ORPHANED ratings, anti-synergy flags, theme coherence score)
3. Computes statistical calculations (mana curve, color distribution, functional role distribution, ramp/draw/removal counts vs. thresholds, opening hand probabilities)
4. Applies a Temperature system (0–9) that controls how strictly the analysis interprets the deck's theme
5. Generates a human-readable analysis report and (optionally) an AI-ready generated prompt

The engine is invoked from a new "Analyze" tab in the existing `RightPanel.tsx`. It does NOT modify the deck itself — it only reads the current deck state and produces analysis output.

The existing infrastructure in `roles.ts` already assigns card roles (CardRole enum with Beater, EvasiveThreat, Finisher, Removal, Counterspell, BoardWipe, CardDraw, Ramp, etc.). The analysis engine will map these to the system prompt's primary role categories, add a new combo/synergy detection layer, and implement the temperature system as a client-side parameter.

## Types

One new type file, several new types in existing files.

### New File: `src/lib/analysis/types.ts`

```typescript
// ── Primary Roles (from system prompt Step 1) ────────────────────────────

export type PrimaryRole =
  | "RAMP"           // Mana acceleration
  | "DRAW"           // Card advantage
  | "REMOVAL"        // Targeted threat neutralization
  | "WRATH"          // Mass removal / board wipes
  | "PROTECTION"     // Counters, hexproof, indestructible
  | "WINCON"         // Game-ending card
  | "COMBO_PIECE"    // Required for a multi-card combo
  | "SUPPORT"        // Theme enabler without being wincon
  | "UTILITY"        // Flexible single-function card
  | "FILLER";        // Low synergy value

// ── Secondary Tags ───────────────────────────────────────────────────────

export type SecondaryTag =
  | "RECURSIVE"          // Returns from graveyard
  | "TUTOR"              // Searches for specific cards
  | "SACRIFICE_OUTLET"   // Can sacrifice permanents
  | "PAYOFF"             // Rewards primary mechanic
  | "ENABLER"            // Sets up theme engine
  | "STAX"               // Slows/restricts opponents
  | "ANTHEM"             // Boosts other permanents
  | "TRIBAL"             // Shares creature type with theme

// ── Card Analysis Result ─────────────────────────────────────────────────

export interface CardAnalysis {
  oracleId: string;
  name: string;
  primaryRoles: PrimaryRole[];
  secondaryTags: SecondaryTag[];
  primaryRoleSummary: string; // e.g., "REMOVAL + DRAW"
  comboPieces: string[];     // Names of combos this card belongs to
  synergyScore: number;      // 0-100 from scoring pipeline
}

// ── Synergy Types ────────────────────────────────────────────────────────

export type SynergyClusterRating = "TIGHT" | "LOOSE" | "ORPHANED";

export interface SynergyCluster {
  name: string;               // e.g., "Reanimation Package"
  cards: string[];            // Card names
  rating: SynergyClusterRating;
  description: string;
}

export interface AntiSynergyFlag {
  cards: [string, string];    // Two conflicting card names (or card vs theme)
  issue: string;
  severity: "CRITICAL" | "MODERATE" | "MINOR";
}

export interface ComboDetection {
  name: string;               // e.g., "Blood Artist + Zulaport Cutthroat loop"
  cards: string[];
  description: string;
  manaCost: string;           // e.g., "3BB"
  setupCost: string;          // e.g., "Requires sacrifice outlet + creature to die"
  comboType: "INFINITE_LOOP" | "LOCK" | "ONE_SHOT_WIN" | "VALUE_ENGINE";
}

// ── Temperature System ───────────────────────────────────────────────────

export type TemperatureLevel = 0 | 1 | 2 | 3 | 4 | 5 | 6 | 7 | 8 | 9;

export interface TemperatureConfig {
  level: TemperatureLevel;
  label: string;
  grip: "IRON" | "STRONG" | "FLEXIBLE" | "LOOSE" | "NONE";
  orphanAction: "ALWAYS_CUT" | "FLAG" | "EVALUATE" | "RE_EXAMINE" | "HIDDEN_VALUE";
  antiSynergyBoost: boolean;
  themeThresholdOffset: number; // +/- percentage points
}

// ── Theme Coherence ──────────────────────────────────────────────────────

export type CoherenceRating = "FOCUSED" | "BALANCED" | "DILUTED" | "SCATTERED";

export interface ThemeCoherenceResult {
  rawScore: number;           // Percentage 0-100
  adjustedThreshold: number;  // Temperature-adjusted
  rating: CoherenceRating;
  supportCount: number;       // Cards in SUPPORT+WINCON+COMBO_PIECE+PAYOFF+ENABLER
  totalCards: number;
}

// ── Full Analysis Report ─────────────────────────────────────────────────

export interface AnalysisReport {
  // Step 3 stats
  totalCards: number;
  avgManaValue: number;
  manaCurve: Record<number, number>;
  landCount: number;
  landPercentage: number;
  colorDistribution: Record<string, number>;
  roleDistribution: Record<PrimaryRole, { count: number; percentage: number }>;
  rampCount: number;
  drawCount: number;
  removalCount: number;
  wrathCount: number;
  comboPieceRatio: number;
  orphanedCount: number;
  openingHandOdds: Array<{ name: string; probability: number }>;

  // Step 2 synergies
  combos: ComboDetection[];
  synergyClusters: SynergyCluster[];
  antiSynergies: AntiSynergyFlag[];
  themeCoherence: ThemeCoherenceResult;

  // Step 1 card analysis
  cardAnalyses: CardAnalysis[];

  // Step 4 temperature
  temperature: TemperatureConfig;

  // Step 5 generated prompt (optional, for AI dispatch)
  generatedPrompt: string;

  // Threshold warnings
  thresholdWarnings: string[];
}

// ── Analysis Options ─────────────────────────────────────────────────────

export interface AnalysisOptions {
  temperature: TemperatureLevel;
  format?: string;
  coreTheme?: string;
}
```

## Files

### New Files

| File | Path | Purpose |
|------|------|---------|
| Types | `src/lib/analysis/types.ts` | All new types (PrimaryRole, SecondaryTag, CardAnalysis, ComboDetection, SynergyCluster, AntiSynergyFlag, TemperatureConfig, AnalysisReport, AnalysisOptions) |
| Temperature config | `src/lib/analysis/temperature.ts` | Temperature system: configs for levels 0–9, threshold adjustments, orphan/anti-synergy rules |
| Role mapper | `src/lib/analysis/roleMapper.ts` | Maps existing `CardRole[]` from `roles.ts` to system prompt `PrimaryRole[]` and `SecondaryTag[]` |
| Combo detector | `src/lib/analysis/comboDetector.ts` | Pattern-based combo detection using oracle text analysis (2-4 card combinations) |
| Synergy cluster analyzer | `src/lib/analysis/synergyClusterAnalyzer.ts` | Groups cards into synergy clusters using existing `synergyModel.ts` connection data, rates TIGHT/LOOSE/ORPHANED |
| Theme coherence | `src/lib/analysis/themeCoherence.ts` | Calculates theme coherence percentage and rating from card role assignments |
| Engine orchestrator | `src/lib/analysis/engine.ts` | Main `runAnalysis(entries, options): AnalysisReport` function that orchestrates all steps |
| UI component | `src/components/AnalysisEnginePanel.tsx` | React component for the new "Analyze" tab in RightPanel |
| Generated prompt builder | `src/lib/analysis/promptBuilder.ts` | Builds the AI-ready generated prompt (Step 5) |

### Modified Files

| File | Changes |
|------|---------|
| `src/components/RightPanel.tsx` | Add "Analyze" tab (new `Tab` value) pointing to `AnalysisEnginePanel` |
| `src/lib/roles.ts` | Add 4 new roles: `"RampNonLand"`, `"Wrath"`, `"ComboPiece"`, `"Filler"` (optional — could define in roleMapper instead) |

## Functions

### New Functions

#### `src/lib/analysis/temperature.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `getTemperatureConfig` | `(level: TemperatureLevel): TemperatureConfig` | Returns the config for a given temperature level |
| `adjustThreshold` | `(raw: number, config: TemperatureConfig): number` | Adjusts a threshold by the temperature's offset |
| `classifyOrphaned` | `(config: TemperatureConfig): OrphanedAction` | Returns what to do with orphaned cards at this temperature |

#### `src/lib/analysis/roleMapper.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `mapToPrimaryRoles` | `(card: CardRecord): PrimaryRole[]` | Maps a card's `assignRoles()` output + oracle text to `PrimaryRole[]` |
| `mapToSecondaryTags` | `(card: CardRecord): SecondaryTag[]` | Detects secondary tags from oracle text |
| `summarizePrimaryRoles` | `(roles: PrimaryRole[]): string` | Returns a short label (e.g., "RAMOVAL + DRAW") |

#### `src/lib/analysis/comboDetector.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `detectCombos` | `(entries: DeckEntry[]): ComboDetection[]` | Scans all 2-4 card combinations for known combo patterns using oracle text matching and existing synergy connections |
| `detectSingleCardCombo` | `(card: CardRecord): string[]` | Returns combo names this card enables on its own (e.g., Protean Hulk) |

#### `src/lib/analysis/synergyClusterAnalyzer.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `buildSynergyClusters` | `(entries: DeckEntry[], axes: MechanicAxis[]): SynergyCluster[]` | Groups cards by shared mechanical axes, rates each cluster TIGHT (3+ cards) or LOOSE (2 cards) |
| `findOrphanedCards` | `(entries: DeckEntry[], clusters: SynergyCluster[]): string[]` | Identifies cards not belonging to any cluster |

#### `src/lib/analysis/themeCoherence.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `calculateThemeCoherence` | `(analyses: CardAnalysis[], entries: DeckEntry[], temperature: TemperatureConfig): ThemeCoherenceResult` | Counts SUPPORT+WINCON+COMBO_PIECE+PAYOFF+ENABLER cards, calculates percentage, applies temperature-adjusted thresholds |

#### `src/lib/analysis/engine.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `runAnalysis` | `(entries: DeckEntry[], options: AnalysisOptions): AnalysisReport` | Main orchestrator: runs Steps 1-6 sequentially and returns complete report |

#### `src/lib/analysis/promptBuilder.ts`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `buildGeneratedPrompt` | `(report: AnalysisReport): string` | Constructs the Step 5 AI-ready generated prompt in the specified format |
| `buildReportDisplay` | `(report: AnalysisReport): string` | Constructs human-readable report text for UI display |

#### `src/components/AnalysisEnginePanel.tsx`
| Function | Signature | Purpose |
|----------|-----------|---------|
| `AnalysisEnginePanel` | `(): JSX.Element` | Full analysis UI: temperature slider, run button, report display (accordion sections), generated prompt display with copy button |

### Modified Functions

| Function | File | Changes |
|----------|------|---------|
| `assignRoles` | `src/lib/roles.ts` | Add `"RampNonLand"` for non-land ramp sources (currently only detects "Ramp" from `add {` in oracle text — need to distinguish land vs non-land ramp); add `"Wrath"` for board wipes (already partially detected as "BoardWipe"); add `"ComboPiece"` (optional heuristic based on combo tables); add `"Filler"` (low-power cards with no synergy). These are additive — existing roles remain unchanged. |

## Dependencies

No new external packages. The engine uses:
- Existing `roles.ts` for card role assignment
- Existing `synergyModel.ts` for synergy profiles and axis detection
- Existing `scoring.ts`/`scoreEngine.ts` for synergy scores
- Existing `hypergeometric.ts` for opening hand probability calculations
- Existing `manaBase.ts` for mana curve and color distribution
- Existing `deckStore.ts` for deck entry access

## Testing

### New Test Files

| File | Tests |
|------|-------|
| `src/lib/analysis/__tests__/roleMapper.test.ts` | Verify PrimaryRole mapping for all 10 role types; verify secondary tag detection; edge cases (lands, colorless, split cards) |
| `src/lib/analysis/__tests__/temperature.test.ts` | Verify all 10 temperature configs; verify threshold adjustments; verify orphan/anti-synergy rules |
| `src/lib/analysis/__tests__/comboDetector.test.ts` | Test combo detection with known combos (e.g., Blood Artist + Zulaport Cutthroat + sacrifice outlet); verify no false positives |
| `src/lib/analysis/__tests__/synergyClusterAnalyzer.test.ts` | Verify TIGHT/LOOSE/ORPHANED classification; test with homogeneous and heterogeneous decks |
| `src/lib/analysis/__tests__/themeCoherence.test.ts` | Test coherence calculation; verify temperature-adjusted thresholds change rating |
| `src/lib/analysis/__tests__/engine.test.ts` | Full integration test: build a known deck, run analysis, verify report structure and values |
| `src/components/__tests__/AnalysisEnginePanel.test.tsx` | UI component tests: render, temperature slider changes, run button, report display |

### Existing Tests to Verify

| Test File | Why |
|-----------|-----|
| `src/lib/__tests__/synergy.integration.test.ts` | New combo/synergy analysis should not conflict with existing synergy scoring |
| `src/components/__tests__/generator.verification.test.ts` | Role mapping should be consistent with existing role assignments |
| `src/lib/__tests__/legality.test.ts` | No changes to legality — verify no regressions |

## Implementation Order

The work is organized into 7 sequential steps, each building on the previous:

1. **Types & Temperature** — Create `src/lib/analysis/types.ts` and `src/lib/analysis/temperature.ts`. Define all types and the temperature config. No dependencies on other code.

2. **Role Mapper** — Create `src/lib/analysis/roleMapper.ts`. Extend `roles.ts` with new roles if needed. Map existing CardRole[] to PrimaryRole[] and SecondaryTag[]. Add tests.

3. **Combo Detector** — Create `src/lib/analysis/comboDetector.ts`. Build pattern tables for known combos using oracle text analysis. Add tests.

4. **Synergy Cluster Analyzer** — Create `src/lib/analysis/synergyClusterAnalyzer.ts`. Use existing synergyModel.ts profiles to group cards and rate clusters. Add tests.

5. **Theme Coherence & Engine** — Create `src/lib/analysis/themeCoherence.ts` and `src/lib/analysis/engine.ts`. Wire all components into `runAnalysis()`. Add integration tests.

6. **Generated Prompt Builder** — Create `src/lib/analysis/promptBuilder.ts`. Build the AI-ready prompt output. Test with various decks and temperatures.

7. **UI Component & Integration** — Create `src/components/AnalysisEnginePanel.tsx`. Modify `RightPanel.tsx` to add the "Analyze" tab. Add UI tests. Verify end-to-end.

8. **Run all existing tests** — Verify nothing breaks.