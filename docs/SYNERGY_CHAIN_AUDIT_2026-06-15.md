# Synergy Chain Audit — MTG Deck Generator Mythic Viability
> **Date:** 2026-06-15  
> **Scope:** Full pipeline — card pool input → mythic-viable deck output  
> **Method:** Direct source review of `seedAnalyzer.ts`, `synergyGraph.ts`, `pipeline.ts`, `scoreEngine.ts`, `competitivePower.ts`, `ENGINEERING_ASSESSMENT.md`, `PROJECT_AUDIT_2026-06-15.md`  
> **Target bar:** Deck capable of Mythic rank on MTG Arena, or Top 8 at a competitive paper event

---

## PHASE 1 — Synergy Chain Audit

---

### 1. Architecture Overview

The engine implements a linear, deterministic pipeline with an optional AI wrapper:

```
User Seeds
  │
  ▼
[seedAnalyzer.ts]         — intent inference (color, archetype, axes, roles, speed)
  │
  ▼
[synergyGraph.ts]         — explainable directed graph AMONG SEEDS ONLY
  │
  ▼
[generator.ts / pipeline] — pool-builder → role-fill → mana-base → optimizer → sideboard
  │         (greedy, single-path, soft role quotas)
  ▼
[scoreEngine.ts]          — card-level composite score (axisScore, synergyDensity,
  │                          compositionBonus, castabilityPenalty, rolePower, powerScore)
  ▼
[competitivePower.ts]     — blended competitive + heuristic card power (0.8c/0.2h)
  ▼
[aiGenerator.ts]          — LLM advisory wrapper; drops hallucinations; gap-fills via
                            deterministic generator
```

The architecture is conceptually correct. Stage contracts exist (`pipeline.ts` `GeneratorStage<TIn,TOut>`, `OFFLINE_GENERATOR_STAGE_ORDER`). AI robustness is solid. The competitive anchor exists. **The depth** at each stage is the problem.

---

### 2. Input Layer

**How card pool is ingested:**  
Cards are stored as `CardRecord`s parsed from a Scryfall-like JSON, trimmed to Arena-format-legal cards. The Standard fixture (`src/test/fixtures/standard-pool.json`) holds ~420 cards mapped through `toCardRecord`. `colorIdentityJson` is JSON-encoded and parsed safely. `cmc`, `typeLine`, and `oracleText` are structural fields used throughout.

**Is data normalized?**  
Adequately for structure. Mana cost, type line, color identity, oracle text, and legality flags are all present and consistently used. The key weakness is that normalization logic is **scattered** across utilities, importers, and one-off scripts — there is no single `normalizeCard` function that is the canonical entry point.

**Are synergy-relevant tags extracted here or deferred?**  
Tags (roles and axes) are **deferred** to analysis time. `assignRoles` and `buildSynergyProfile` are called on demand per card, not baked in at import. This is architecturally clean but means tag derivation is not centralized or uniformly tested.

**Gaps:**
| Gap | Severity | Effect |
|-----|----------|--------|
| No unified normalization module | Medium | Inconsistent tags across code paths |
| Incomplete/noisy role coverage | High | Synergy graph and scorer can miss key cards |
| Tags not unit-tested per staple card | Medium | Regressions accumulate silently |
| No guaranteed invariant on CardRecord fields | Low | Edge-case null handling scattered |

---

### 3. Synergy Detection Layer

#### 3.1 Seed Analyzer (`seedAnalyzer.ts`)

**What it does:**  
`analyzeSeeds` treats seeds as intent evidence. For each card it:
- Parses `colorIdentityJson` → builds `colorCounts` and `colorConfidence`  
- Counts nonlands, CMC sum, creatures → `avgCmc`, `speed`, `spellRatio`  
- Calls `assignRoles` + `isThreat` → `roleCounts`  
- Calls `buildSynergyProfile` → increments `synergyAxes` per `MechanicAxis`  
- Calls `scoreCardForArchetypes` (role + text heuristics) → accumulates `archetypeScores`  
- Calls `applyAxisArchetypeSignals` → amplifies archetype scores from axis presence

Output: `SeedSummary` with colors, confidence, archetype rankings + probabilities, primary axes, roles, avgCmc, speed, spellRatio, signals, narrative.

**Verdict:** Strong. Rule-based but well-structured. Main vulnerability is underlying tag quality.

**Gaps:**
- Archetype scoring weights are hand-authored, not calibrated against actual Standard archetype distributions
- `inferConfidence` formula is heuristic; no empirical basis for the weights
- Brittle to mixed or off-meta seeds where multiple axes compete

#### 3.2 Seed Synergy Graph (`synergyGraph.ts`)

**What it does:**  
`buildSeedSynergyGraph` builds a directed graph **among the seed cards only** (not the full pool). Three edge types:
- `source-to-payoff`: A's `sourceTags` contains axis X **and** B's `payoffTags` contains X  
- `mutual-engine`: both cards are simultaneously source and payoff for the same axis  
- `shared-axis`: symmetric participation without a clear directional relationship  

Edges are deduplicated by `fromId→toId:axis:kind`. Density and a narrative are computed. The graph is serialized for LLM prompts via `formatSynergyGraphForPrompt`.

**What this graph IS:**  
An explainable artifact intended primarily for the LLM prompt context and user-facing Analyze flow. It is NOT used directly as a card selection substrate by the generator.

**What this graph IS NOT:**
- Does **not** cover the full card pool  
- Does **not** support multi-hop path discovery  
- Does **not** carry edge weights (all edges have equal "strength")  
- Does **not** have meta-calibrated weights  
- Is not used by the offline generator for candidate scoring

**Is it sufficient for non-obvious synergies?**  
No. The synergy detection layer operates at the axis level. It can recognize "these two seeds both point to tokens." It cannot discover three-card combo lines, state-based interaction chains, or replacement-effect loops. Tag-level detection is effective for obvious synergy classes (tokens, sacrifice, graveyard, spellslinger, lifegain, counters) but cannot map intricate rules-text interactions.

**Gaps:**
| Gap | Severity | Effect |
|-----|----------|--------|
| Graph scoped to seeds only — not full pool | **Critical** | Generator cannot query synergy graph for card selection |
| No edge weights | High | All synergy edges are treated as equal regardless of strength |
| No multi-hop pathfinding | High | Cannot detect combos or enabler→support→payoff chains |
| No meta calibration of edge relevance | High | Synergies not prioritized by current competitive value |
| Directionality exists but engine-role semantics not yet rich | Medium | Subtle enabler/payoff misclassifications remain |

---

### 4. Deck Construction Layer

**How synergies become a 60-card deck:**  
`generator.ts` orchestrates a **greedy, single-path, goal-directed heuristic**. The `pool-builder` stage filters the full card pool to legal, on-color candidates. `role-fill` then iterates adding cards by composite score from `scoreEngine.ts` until `targetMainboardSize` is reached, constrained by soft role quotas and curve targets. `mana-base` adds land entries. `optimizer` does local adjustments. `sideboard` appends where applicable.

**Mana curve enforcement:**  
Curve targets are archetype-specific (aggro leans low, control peaks at 3–4, ramp extends higher). Enforcement is soft; power scores can override curve discipline.

**Win condition prioritization:**  
Via role tags (Threat, Finisher, ValueEngine) and `isThreat`. Not fully explicit as a search priority; the greedy algorithm may produce decks with imbalanced threat counts.

**Role-slot filling:**  
Role quotas exist in configuration; filling is soft-constrained. Edge cases where synergy or power skews the pool can produce decks that exceed or fall short of role quotas.

**Gaps:**
| Gap | Severity | Effect |
|-----|----------|--------|
| Greedy single-path selection — no beam/multi-path | **Critical** | Can't recover from locally-optimal but globally-wrong early picks |
| Synergy graph NOT used as candidate input | High | Generator doesn't explicitly prefer cards that complete synergy chains |
| Soft role quotas can be violated | High | Occasionally missing removal or card draw despite strong pool |
| No enabler/payoff ratio enforcement | High | May include payoffs without sufficient enablers (or vice versa) |
| Mana base is heuristic, not hypergeometric | High | Pip-intensive 3-color decks are often inconsistent |
| No alternative build exploration | High | Local maxima in scoring produce rigid, one-dimensional outputs |
| Optimization stage is local smoothing only | Medium | Not a neighborhood search; minimal improvement over initial greedy output |

---

### 5. Viability Scoring Layer

**How "mythic viability" is currently defined:**  
`scoreEngine.ts` computes a `CompositeScore` per card:
```
total = rolePowerScore
      + directionalContribution     (axis score × synergy density, log-compressed)
      + compositionContribution     (cross-axis bonus × compositionScalar)
      + bonusTotal                  (keyword + focus + prefer bonuses)
      - castabilityPenalty          (convex penalty for low cast probability)
```

`basePower` is now blended: `0.8 × competitivePower + 0.2 × heuristicPower`, anchored to `standard-snapshot.json`.

**Deck-level scoring:** Aggregate of card scores, plus curve fit and role coverage checks from configuration. Compared against hand-tuned thresholds to flag a deck as viable.

**Meta awareness:** `metaTargets` is scaffolded but not wired into scoring. Counter-analysis posture returns placeholder `score: 1`. Meta snapshot has a null-returning remote refresh stub.

**Benchmarking against competitive archetypes:**  
The `standard-snapshot.json` provides a per-card competitive score, not a per-deck benchmark. There are no golden deck fixtures that must score above a threshold to verify calibration.

**Format legality:** Well-covered. Legality engine is tested (28 tests).

**Consistency metrics:** Hypergeometric and Karsten math tested independently; not yet deeply integrated into mana-base construction or deck acceptance criteria.

**Redundancy:** Basic preference for multiple copies of key cards; no explicit enforcement of enabler/payoff density thresholds.

**Gaps:**
| Gap | Severity | Effect |
|-----|----------|--------|
| No deck-level golden fixtures from competitive archetypes | **Critical** | "Mythic threshold" is hand-tuned with no empirical grounding |
| Meta subsystem is a no-op scaffold | High | Meta fit score is meaningless; no archetype-aware evaluation |
| Hypergeometric tools not integrated into deck acceptance | High | Mana consistency is not a hard viability criterion |
| Composite score not standardized against competitive distribution | High | Absolute thresholds can't distinguish Tier1 from casual |
| No simulation-based consistency check (goldfish, draw simulator) | Medium | Can't verify hand-grabability of key spells |
| Configuration parameter interactions undocumented | Medium | Tuning one coefficient can silently shift scores elsewhere |
| No calibration harness (run on fixed pools, diff scores) | Medium | Config changes have no verifiable before/after comparison |

---

### 6. Gap Map — Where Signal Loss Occurs

```
Card Pool (tags incomplete/scattered)
  │ ← GAP 1: Incomplete role/axis tagging; no central normalizer
  ▼
seedAnalyzer (strong intent inference)
  │ ← GAP 2: Heuristic archetype weights, not meta-calibrated
  ▼
synergyGraph (seed-only, no weights, no paths)
  │ ← GAP 3: Graph doesn't cover pool; not used by generator
  ▼
pool-builder (legal + color filter)
  │ ← GAP 4: Synergy graph not consulted; pure scoring heuristic
  ▼
role-fill (greedy, single-path)
  │ ← GAP 5: No beam search; no enabler/payoff ratio enforcement
  ▼
mana-base (heuristic pip counting)
  │ ← GAP 6: No hypergeometric integration; 3-color decks fragile
  ▼
scoreEngine (card-level, well-structured)
  │ ← GAP 7: Deck-level viability has no golden fixtures; meta no-op
  ▼
Output deck
  │ ← GAP 8: No acceptance test for mythic-tier quality
  ▼
"Mythic viable" ???
```

**Priority order for remediation (weakest link first):**
1. Viability scorer calibration (deck-level golden fixtures + competitive dist)
2. Synergy graph extension to full pool + multi-hop pathfinding
3. Beam-search deck construction
4. Hypergeometric mana base integration
5. Centralized card normalization + tagging
6. Meta subsystem wiring

---

## PHASE 2 — Implementation Instructions for Coding AI

Instructions are sequenced by impact, targeting weakest links first. Each block specifies: module/function, input/output contract, logic, acceptance criteria, and external data requirements.

---

### [VIABILITY SCORER] — Deck-Level Competitive Calibration

**Priority: 1 (fix first)**

**Module to modify:** `src/lib/scoreEngine.ts`

**New function to create:** `evaluateDeckViability`

**Input contract:**
```ts
export interface DeckEvaluationContext {
  entries: DeckEntry[];       // full mainboard (lands + nonlands)
  format: string;             // "Standard" | "Historic" | etc.
  archetype: Archetype;
  options?: GenerateOptions;
}

export interface DeckViabilityResult {
  compositeScore: number;     // 0–100 normalized against competitive dist
  breakdown: {
    power: number;            // aggregate competitive power percentile
    synergyDensity: number;   // intra-deck edge count / max possible edges
    curveFit: number;         // 1 - normalized distance from archetype target curve
    roleCoverage: number;     // fraction of role quotas met (0–1)
    manaConsistency: number;  // P(cast key spells on curve) proxy
    metaFit: number;          // 0 until meta subsystem is wired; default 0.5
  };
  passesMythicThreshold: boolean;
  diagnostics: string[];
}
```

**Logic to implement:**

1. **Power percentile:** Load distribution stats (mean, stddev) from a curated fixture of competitive decks (see external data note). Compute the deck's aggregate `computePowerScore` sum and convert to a percentile rank `z = (score - mean) / stddev`, clamped 0–100.

2. **Synergy density:** Build a local synergy edge count by calling `buildSynergyProfile` on each nonland entry and counting how many pairs have at least one shared axis (source→payoff or mutual-engine). Normalize by `n*(n-1)` where `n` = nonland count.

3. **Curve fit:** Compute the deck's mana value histogram. Compare to the archetype-specific target curve stored in `archetypeProfiles.ts` (or create one if absent). Curve fit = `1 - (mean absolute deviation between actual and target distribution)`.

4. **Role coverage:** Compute `assignRoles` on each deck card, tally roles. Compare to role quota targets from config. `roleCoverage = count(quotas_met) / count(quotas_total)`.

5. **Mana consistency proxy:** Count colored sources in the mana base vs. pip requirements in the nonland spells. Use an approximation: `sources / requiredSources` per color, averaged. Full hypergeometric integration is addressed in `[MANA BASE BUILDER]` below; use the approximate ratio here as a quick proxy.

6. **Composite score:** Weighted sum of the five components, using coefficients from `scoringConfig.ts`. Document the weights and their interactions in inline JSDoc.

7. **Mythic threshold:** `passesMythicThreshold = compositeScore >= cfg.mythicThresholdPercentile` where `mythicThresholdPercentile` is stored in config (initially 72 — approximately the 75th percentile of the calibration set, with a small buffer).

8. **Diagnostics:** For any component below its target range, push a human-readable string. E.g., `"Power at 48th percentile — below mythic target of ≥72nd."`, `"Role coverage 67% — missing: BoardWipe, CardDraw"`.

**External data required (flag):**  
⚠️ Create `src/test/fixtures/competitive-reference-decks.json`. Populate with **5–10 known Standard top-decks** from:
- MTGGoldfish tournament results (https://www.mtggoldfish.com/tournament_series/standard)
- Wizards official event coverage
- MTGTop8 (https://mtgtop8.com)

Each entry: `{ name, archetype, tier, cards: [{name, count}] }`. Normalize card names to match `CardRecord.name`. Use this fixture to compute distribution stats for calibration and as golden test inputs.

**Acceptance criteria:**
```ts
// src/lib/__tests__/deckViability.test.ts
it("tier-1 reference deck passes mythic threshold", () => {
  const ctx = loadReferenceContext("Azorius Soldiers"); // from fixture
  const result = evaluateDeckViability(ctx);
  expect(result.passesMythicThreshold).toBe(true);
  expect(result.compositeScore).toBeGreaterThan(70);
});

it("clearly suboptimal deck fails threshold", () => {
  // 60 random on-color cards, no coherent synergy
  const result = evaluateDeckViability(buildJunkDeckContext());
  expect(result.passesMythicThreshold).toBe(false);
  expect(result.compositeScore).toBeLessThan(50);
});

it("breakdown diagnostics name the weak components", () => {
  const result = evaluateDeckViability(buildLowSynergyDeckContext());
  expect(result.diagnostics.some(d => d.includes("synergy"))).toBe(true);
});
```

---

### [SYNERGY GRAPH CONSTRUCTION] — Extend to Full Card Pool

**Priority: 2**

**Module to modify:** `src/lib/analysis/synergyGraph.ts`

**New type and function to create:**
```ts
export interface GlobalSynergyGraph {
  // indexed by oracleId for O(1) neighbor lookup
  adjacency: Map<string, SynergyGraphEdge[]>;
  nodes: Map<string, SynergyGraphNode>;
  axisIndex: Map<MechanicAxis, { sources: string[]; payoffs: string[] }>;
  totalEdgeCount: number;
}

export function buildGlobalSynergyGraph(
  cards: CardRecord[],
  context: { seedSummary: SeedSummary; colorIdentity?: ManaColor[] }
): GlobalSynergyGraph
```

**Logic to implement:**

1. **Build axis index first (not quadratic):** For each card, call `buildSynergyProfile`. For each axis in `sourceTags`, add `card.oracleId` to `axisIndex[axis].sources`. For each axis in `payoffTags`, add to `axisIndex[axis].payoffs`. This replaces the O(n²) pair loop with O(n) indexing.

2. **Add source-to-payoff edges:** For each `axis` in `axisIndex`, iterate over every `(source, payoff)` pair. Where `source !== payoff`, add a directed `"source-to-payoff"` edge. **Cap edges per card at 50** to prevent combinatorial explosion on very common axes (e.g., `"tokens"`). Prioritize pairs with higher combined `competitivePower`.

3. **Add mutual-engine edges:** After source/payoff pass, for cards that appear in both `.sources` and `.payoffs` for the same axis, connect them with `"mutual-engine"` edges.

4. **Add shared-axis edges sparingly:** Only for axes where the seed summary marks a `primaryAxis`. Skip `"shared-axis"` edges for axes not in `seedSummary.primaryAxes` to keep the graph focused.

5. **Color filter:** Only add edges between cards within the deck's inferred color identity (from `context.colorIdentity` or `seedSummary.colorIdentity`). Off-color cards can still have nodes for reference but receive no edges.

6. **Neighbor lookup API:**
```ts
export function getSynergyNeighbors(
  graph: GlobalSynergyGraph,
  oracleId: string,
  options?: { minKind?: SynergyEdgeKind; axes?: MechanicAxis[] }
): SynergyGraphEdge[]
```

**Performance note:** For a 400-card pool with 15 axes, the axis-indexed approach produces far fewer edges than O(n²). Measure total edge count; if >10,000 edges after caps, apply additional pruning (e.g., only retain edges where both cards exceed a minimum competitive power percentile).

**Acceptance criteria:**
```ts
// src/lib/analysis/__tests__/globalSynergyGraph.test.ts
it("token producer connects to token payoff via source-to-payoff edge", () => {
  const pool = [tokenProducerCard, tokenPayoffCard, unrelatedCard];
  const graph = buildGlobalSynergyGraph(pool, { seedSummary: tokenSeedSummary });
  const edges = getSynergyNeighbors(graph, tokenProducerCard.oracleId);
  expect(edges.some(e => e.toOracleId === tokenPayoffCard.oracleId && e.kind === "source-to-payoff")).toBe(true);
  expect(edges.some(e => e.toOracleId === unrelatedCard.oracleId)).toBe(false);
});

it("builds within 100ms on 400-card pool", () => {
  const start = Date.now();
  buildGlobalSynergyGraph(standardPool, { seedSummary: emptySummary });
  expect(Date.now() - start).toBeLessThan(100);
});
```

---

### [SYNERGY PATHFINDING] — Multi-Hop Combo and Chain Discovery

**Priority: 2 (companion to graph construction)**

**Module to extend:** `src/lib/analysis/synergyGraph.ts`

**New types and function:**
```ts
export interface SynergyPath {
  cardOracleIds: string[];          // ordered: start → ... → end
  edgeKinds: SynergyEdgeKind[];
  axes: MechanicAxis[];
  strength: number;                 // sum of edge kind weights
}

export function findSynergyPaths(
  graph: GlobalSynergyGraph,
  startIds: string[],               // seed oracle IDs
  options: { maxLength: number; minStrength?: number }
): SynergyPath[]
```

**Logic to implement:**

1. **Edge kind weights:** `"source-to-payoff"` = 3, `"mutual-engine"` = 2, `"shared-axis"` = 1. Used to compute path `strength = sum(edge weights)`.

2. **Bounded DFS:** For each `startId`, run a depth-first search through `graph.adjacency`. Track visited nodes in the current path to avoid cycles. Prune when path length reaches `options.maxLength`.

3. **Record paths:** A path is worth recording when its `strength > options.minStrength` (default: `maxLength - 1`, ensuring at least one real directional edge per step). Sort returned paths by strength descending.

4. **Cap results:** Return at most `5 × startIds.length` paths to avoid flooding downstream consumers.

**Acceptance criteria:**
```ts
it("finds 3-card enabler-support-payoff chain", () => {
  // A supplies tokens, B both supplies and rewards tokens, C rewards tokens
  const paths = findSynergyPaths(graph, [A.oracleId], { maxLength: 3, minStrength: 4 });
  const abc = paths.find(p => p.cardOracleIds.includes(B.oracleId) && p.cardOracleIds.includes(C.oracleId));
  expect(abc).toBeDefined();
  expect(abc!.strength).toBeGreaterThan(4);
});

it("does not revisit cards within a single path", () => {
  const paths = findSynergyPaths(graph, seeds, { maxLength: 4 });
  for (const path of paths) {
    expect(new Set(path.cardOracleIds).size).toBe(path.cardOracleIds.length);
  }
});
```

---

### [DECK CONSTRUCTION] — Beam Search Role Fill Stage

**Priority: 3**

**Module to create:** `src/lib/generator/beamRoleFill.ts`

**Function to implement:**
```ts
export const beamRoleFillStage: GeneratorStage<PoolBuilderOutput, RoleFillOutput> = {
  id: "role-fill",
  description: "Beam-search mainboard assembly with synergy-aware constraints",
  run(input: PoolBuilderOutput): RoleFillOutput
}
```

**Sub-types needed:**
```ts
interface BeamState {
  entries: DeckEntry[];
  roleCounts: Partial<Record<CardRole, number>>;
  cmcHistogram: number[];     // index = cmc, value = count
  inDeckIds: Set<string>;     // oracleIds already in state
  heuristicScore: number;     // approximate "goodness" of this partial deck
}
```

**Logic to implement:**

1. **Initialize beam** with a single state containing `lockedEntries` from `PoolBuilderOutput`.

2. **At each expansion step:**
   a. For each state in the beam, compute a **candidate shortlist**: filter `pool` to cards that are legal, on-color, not already in state, not at copy limit. Score each by `computeCompositeScore` against current `state.entries`. Take top 20 by score.
   b. For each of the top 3–5 candidates in the shortlist (configurable), create a new state by adding that candidate.
   c. Enforce **enabler/payoff ratio constraint:** if the current state has `payoffCount > 2 × enablerCount` for any primary axis from the seed summary, downgrade candidates that are additional payoffs for that axis.
   d. Recompute `heuristicScore` for new state: `0.5 × aggregatePower + 0.3 × inDeckSynergyDensity + 0.2 × roleCoverageRatio` (fast approximation; full `evaluateDeckViability` call runs only at end).
   e. **Prune beam** to top `beamWidth` states by `heuristicScore`. Default `beamWidth = 8`; configurable in `GenerateOptions`.

3. **Stop when** all states in beam contain `targetMainboardSize - landBudget` nonland entries (lands are added in the next stage).

4. **Select winner:** Run full `evaluateDeckViability` on each completed beam state's entries. Return the state with highest `compositeScore`.

5. **Compute `targetAvgCmc`** from winner's `cmcHistogram`.

**Acceptance criteria:**
```ts
// src/lib/generator/__tests__/beamRoleFill.test.ts
it("produces a legal deck satisfying role quota tolerances", () => {
  const output = beamRoleFillStage.run(poolBuilderOutput);
  expect(output.entries.filter(e=>!e.card.typeLine.includes("Land"))).toHaveLength(targetNonlandCount);
  // Check role counts within ±2 of quota for Removal and Threat
  expect(Math.abs(countRole(output.entries, "Removal") - removalQuota)).toBeLessThanOrEqual(2);
});

it("achieves higher synergy density than greedy on same inputs", () => {
  const beamOutput = beamRoleFillStage.run(input);
  const greedyOutput = greedyRoleFill(input);   // old implementation
  expect(inDeckSynergyDensity(beamOutput.entries)).toBeGreaterThanOrEqual(
    inDeckSynergyDensity(greedyOutput.entries)
  );
});

it("runs within 300ms on standard pool with beamWidth=8", () => {
  const start = Date.now();
  beamRoleFillStage.run(fullStandardInput);
  expect(Date.now() - start).toBeLessThan(300);
});
```

**Wire-in:** Update `generator.ts` to call `beamRoleFillStage.run` in the role-fill step, replacing the current greedy loop. Preserve other stages unchanged.

---

### [MANA BASE BUILDER] — Hypergeometric Color Source Integration

**Priority: 4**

**Module to modify or create:** `src/lib/generator/manaBase.ts`  
(Extract from `generator.ts` if currently inline.)

**Function to implement:**
```ts
export const manaBaseStage: GeneratorStage<RoleFillOutput, ManaBaseOutput> = {
  id: "mana-base",
  description: "Hypergeometric-calibrated land selection with color source targets",
  run(input: RoleFillOutput): ManaBaseOutput
}
```

**Logic to implement:**

1. **Compute `landBudget`:** Based on `targetAvgCmc` from `RoleFillOutput` and archetype. Use the formula: `landBudget = round(60 × (0.34 + 0.027 × targetAvgCmc))`, clamped to [20, 28] for 60-card decks.

2. **Compute required colored sources per color:**  
   For each `ManaColor` active in the deck:
   - Count pips at each CMC in the nonland entries.  
   - Identify the most pip-intensive turn requirement per color (e.g., double-black at CMC 2 → needs 2 black sources by turn 2).  
   - Use the existing hypergeometric function (from `src/lib/math/` or equivalent) to solve: *given `landBudget` total lands in `targetDeckSize` cards, how many colored sources are needed to achieve P(≥required pips by turn T) ≥ 0.85?*  
   - This function already exists and is tested; call it here.

3. **Select land cards from pool:**  
   Filter `pool` to legal land cards. Score each by color coverage (how many required colors it provides) and tempo (does it enter untapped on turns 1–3?). Greedily fill:
   - First, basic lands to satisfy minimum source counts.
   - Then replace basics with fetchable duals, shock/check/fast lands to improve untapped-land ratio.
   - Stop when `landBudget` is reached.

4. **Output:** Append land `DeckEntry`s to produce `ManaBaseOutput` with a `landBudget` field and updated `optimizedEntries` base.

**Acceptance criteria:**
```ts
it("mono-R aggro: P(≥1 red source in opening 7) > 0.90", () => {
  const output = manaBaseStage.run(monoRedInput);
  const reds = output.optimizedEntries.filter(e => isRedSource(e.card)).length;
  const prob = hypergeometricCDF(reds, 60, 1, 7);   // P(draw ≥1 in 7 from 60)
  expect(prob).toBeGreaterThan(0.90);
});

it("3-color midrange: each color meets P(≥1 source by turn 2) > 0.85", () => {
  const output = manaBaseStage.run(jundMidrangeInput);
  for (const color of ["B", "G", "R"] as ManaColor[]) {
    const sources = countColorSources(output.optimizedEntries, color);
    const prob = hypergeometricCDF(sources, 60, 1, 2);
    expect(prob).toBeGreaterThan(0.85);
  }
});

it("total deck size remains targetMainboardSize after mana base", () => {
  const output = manaBaseStage.run(inputWith36Nonlands);
  expect(output.optimizedEntries).toHaveLength(60);
});
```

---

### [INPUT NORMALIZATION] — Centralized Card Normalization Pipeline

**Priority: 5**

**Module to create:** `src/lib/data/cardNormalization.ts`

**Functions to export:**
```ts
// Converts raw Scryfall-like import object → canonical CardRecord
export function normalizeCard(raw: RawScryfallCard): CardRecord

// Derives role + axis tags from a CardRecord (single source of truth)
export function deriveCardTags(card: CardRecord): {
  roles: CardRole[];
  axes: MechanicAxis[];
  engineRole: EngineRole;
}

// Convenience: normalize + tag in one call
export function normalizeAndTag(raw: RawScryfallCard): CardRecord & {
  _tags: { roles: CardRole[]; axes: MechanicAxis[]; engineRole: EngineRole }
}
```

**Logic to implement:**

1. Move or wrap existing `toCardRecord` mapper here. Ensure all field normalizations—`colorIdentityJson` encoding, `typeLine` parsing, `cmc` computation, legality flag extraction—flow through a single function body.

2. `deriveCardTags` must call `assignRoles` and `buildSynergyProfile`. Mark it `@pure` — same inputs always produce same outputs.

3. Refactor `importWorker.ts` and test fixture loader to call `normalizeCard` rather than `toCardRecord` inline.

4. Optionally: pre-compute tags during import and store as additional fields in IndexedDB, so downstream analysis reads cached tags rather than recomputing.

**Acceptance criteria:**
```ts
it("Lightning Bolt normalizes with cmc=1, type='Instant', color=['R'], role=['Removal'], axis=['burn']", () => {
  const card = normalizeCard(rawLightningBolt);
  expect(card.cmc).toBe(1);
  expect(card.typeLine).toBe("Instant");
  const tags = deriveCardTags(card);
  expect(tags.roles).toContain("Removal");
  expect(tags.axes).toContain("burn");
});

it("normalizeCard is deterministic (same output on repeated calls)", () => {
  const a = normalizeCard(rawLightningBolt);
  const b = normalizeCard(rawLightningBolt);
  expect(JSON.stringify(a)).toBe(JSON.stringify(b));
});
```

---

### [META SUBSYSTEM] — Wire metaTargets into Scoring

**Priority: 6**

**Module to modify:** `src/lib/meta/metaScoring.ts`

**Functions to implement:**
```ts
// Returns 0–1 similarity between deck's archetype profile and a named meta archetype
export function computeArchetypeSimilarity(
  deckEntries: DeckEntry[],
  targetArchetype: string,
  snapshot: MetaSnapshot
): number

// Fraction of meta threat categories the deck can answer
export function computeMatchupCoverage(
  deckEntries: DeckEntry[],
  snapshot: MetaSnapshot
): { coverage: number; unfavoredThreats: string[] }

// Top-level meta fit score (0–1) + matchup labels
export function computeMetaFit(
  deckEntries: DeckEntry[],
  snapshot: MetaSnapshot
): { score: number; favoredMatchups: string[]; unfavoredMatchups: string[] }
```

**Logic to implement:**

1. **Archetype similarity:** Build a "feature vector" per archetype in the snapshot (set of card names or axis frequencies). Compute Jaccard similarity between deck's card set and each archetype's card set. Return max similarity.

2. **Matchup coverage:** For each prevalent archetype in the snapshot, check whether the deck contains answers keyed by role/axis tag. For example:
   - vs. Graveyard decks: deck must contain cards tagged with a `graveyard-hate` role
   - vs. Aggro: deck needs `roleCounts.BoardWipe >= 1` or `roleCounts.Removal >= 4`
   - vs. Combo: deck needs `roleCounts.Counterspell >= 2` or `roleCounts.Discard >= 3`
   `coverage = threats_answered / total_snapshot_threats`.

3. **Meta fit score:** `0.6 × archetype_similarity + 0.4 × matchup_coverage`.

4. **Wire into `scoreEngine.ts`:** `evaluateDeckViability` calls `computeMetaFit` and uses the result as the `metaFit` component of the composite score breakdown. Default `metaFit = 0.5` when no snapshot is provided.

**External data:** Uses `standard-snapshot.json` (already exists). Extend its schema to include per-archetype card lists and threat categories if not present.

**Acceptance criteria:**
```ts
it("deck resembling Azorius Soldiers scores high similarity to Azorius Soldiers archetype", () => {
  const sim = computeArchetypeSimilarity(azoriusEntries, "Azorius Soldiers", snapshot);
  expect(sim).toBeGreaterThan(0.6);
});

it("control deck with 4+ removal and counterspells covers aggro and combo threats", () => {
  const result = computeMatchupCoverage(controlEntries, snapshot);
  expect(result.coverage).toBeGreaterThan(0.7);
  expect(result.unfavoredThreats).not.toContain("Aggro");
});

it("metaFit defaults to 0.5 when snapshot is undefined", () => {
  const result = evaluateDeckViability({ entries, format: "Standard", archetype: "Control" });
  expect(result.breakdown.metaFit).toBe(0.5);
});
```

---

### [AI GENERATOR] — Route Through Enhanced Pipeline

**Priority: 7**

**Module to modify:** `src/lib/ai/aiGenerator.ts`

**Changes:**

1. After `buildResultFromAIResponse` resolves AI card proposals and calls the offline generator, pass the resulting deck through `evaluateDeckViability`.

2. If `result.passesMythicThreshold === false`, either:
   a. Re-prompt the model with a message like `"The proposed deck scored below mythic threshold on: [diagnostics]. Please revise to prioritize [weak_components]."` (max 1 retry), **or**
   b. Fall back directly to deterministic beam-search generation without the AI detour.

3. Update prompt templates to reference synergy axes, primary archetype, and role targets from the seed summary:
   ```
   "Focus on cards that participate in the [TOKEN / SACRIFICE / ...] axis.
    The deck wants [X] pieces of removal, [Y] early threats, [Z] card draw.
    Archetype target: [AGGRO/MIDRANGE/CONTROL]."
   ```

4. Log `DeckViabilityResult.diagnostics` alongside AI/fallback decision to the reasoning array for observability.

**Acceptance criteria:**
```ts
it("AI deck that fails mythic threshold triggers fallback", () => {
  mockAI.returnDeck(suboptimalDeck);
  const result = await generateWithAI(seeds, options);
  expect(result.usedFallback).toBe(true);
  expect(result.diagnostics).toBeDefined();
});

it("existing hallucination-drop and malformed-JSON tests still pass", () => {
  // unchanged; regression guard
});
```

---

### [INTEGRATION TEST SPEC] — End-to-End Mythic Validation

**File to create:** `src/lib/generator/__tests__/mythicIntegration.test.ts`

**Test harness structure:**
```ts
interface MythicIntegrationCase {
  name: string;
  seedCardNames: string[];
  expectedArchetype: Archetype;
  expectedPrimaryAxes: MechanicAxis[];
  referenceDeckName: string;   // key into competitive-reference-decks.json
  overlapThreshold: number;    // min Jaccard similarity of nonland cards (0–1)
}
```

**Test cases (minimum 3):**

| Case | Seeds | Expected Archetype | Expected Axes | Reference Deck |
|------|-------|--------------------|---------------|----------------|
| Mono-Red Aggro | 2x 1-drop creatures, 1x burn spell, 1x synergy creature | Aggro | burn | "Mono-Red Aggro" |
| Rakdos Midrange | 2x discard/removal, 1x value engine, 1x graveyard piece | Midrange | sacrifice, graveyard | "Rakdos Midrange" |
| Azorius Control | 2x counterspells, 1x draw, 1x board wipe | Control | (role-based) | "Azorius Control" |

**Per-case assertions:**
```ts
it(`[${testCase.name}] full pipeline produces mythic-viable deck`, async () => {
  // 1. Seed analysis
  const summary = analyzeSeeds(resolveCards(testCase.seedCardNames, standardPool));
  expect(summary.topArchetypes[0].archetype).toBe(testCase.expectedArchetype);
  expect(summary.primaryAxes).toEqual(expect.arrayContaining(testCase.expectedPrimaryAxes));

  // 2. Synergy graph
  const graph = buildGlobalSynergyGraph(standardPool, { seedSummary: summary });
  const keyEdges = testCase.seedCardNames.flatMap(name =>
    getSynergyNeighbors(graph, resolveId(name, standardPool))
  );
  expect(keyEdges.length).toBeGreaterThan(0);

  // 3. Beam-search generation
  const poolOut = poolBuilderStage.run({ options, allCards: standardPool, ... });
  const roleFillOut = beamRoleFillStage.run(poolOut);
  const manaOut = manaBaseStage.run(roleFillOut);

  // 4. Legality + structural invariants
  expect(manaOut.optimizedEntries).toHaveLength(60);
  assertLegalDeck(manaOut.optimizedEntries, "Standard");

  // 5. Viability scoring
  const viability = evaluateDeckViability({
    entries: manaOut.optimizedEntries,
    format: "Standard",
    archetype: testCase.expectedArchetype,
  });
  expect(viability.passesMythicThreshold).toBe(true);
  expect(viability.compositeScore).toBeGreaterThanOrEqual(72);

  // 6. Reference deck overlap
  const reference = loadReferenceNonlands(testCase.referenceDeckName); // from fixture
  const generated = nonlands(manaOut.optimizedEntries);
  const overlap = jaccardSimilarity(
    new Set(generated.map(e => e.card.name)),
    new Set(reference)
  );
  expect(overlap).toBeGreaterThanOrEqual(testCase.overlapThreshold);
});
```

**External data:**  
⚠️ Fixture: `src/test/fixtures/competitive-reference-decks.json` — same fixture cited in `[VIABILITY SCORER]`. Minimum 3 decklists matching the test case reference deck names, normalized to `CardRecord.name`.

---

## Summary — Sequenced Instruction Order

| Order | Block | Addresses Gap |
|-------|-------|---------------|
| 1 | `[VIABILITY SCORER]` | Uncalibrated mythic threshold |
| 2a | `[SYNERGY GRAPH CONSTRUCTION]` | Graph scoped to seeds only |
| 2b | `[SYNERGY PATHFINDING]` | No multi-hop combo discovery |
| 3 | `[DECK CONSTRUCTION]` | Greedy single-path role fill |
| 4 | `[MANA BASE BUILDER]` | Heuristic mana base |
| 5 | `[INPUT NORMALIZATION]` | Scattered normalization + incomplete tags |
| 6 | `[META SUBSYSTEM]` | No-op meta scoring |
| 7 | `[AI GENERATOR]` | AI not routed through enhanced pipeline |
| Final | `[INTEGRATION TEST SPEC]` | No end-to-end mythic acceptance tests |

> Fix the viability scorer first. Until the definition of "good" is calibrated against real competitive decks, every improvement elsewhere has no verifiable target to converge on.
