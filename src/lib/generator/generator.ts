import type { CardRecord, ManaColor } from "../types";
import type { DeckEntry } from "../legality";
import { BASIC_LAND_NAMES, maxCopiesForCard } from "../legality";
import { getFormatRules } from "../formats";
import { assignRoles, isThreat, type CardRole } from "../roles";
import { recommendDualLands, recommendLandCount } from "../manaBase";
import { blendRoleTargets, type RoleTarget } from "./roleTargets";
import { buildPool } from "./pool";
import { buildScoreBreakdown, cardScore, deckScore, targetAvgCmcFor } from "./weights";
import { optimize, makeRng } from "./optimizer";
import { generateSideboard } from "./sideboard";
import { generateColorPieReasons } from "./colorWeights";
import {
  buildSynergyProfile,
  generateTribalReasons,
  generateCardReasons,
  inferPrimaryAxes,
  keywordFocusToAxes,
  type MechanicAxis,
} from "./synergyModel";
import type {
  GenerateOptions,
  GenerateResult,
  GenerateMultiResult,
  GenerationDiagnostic,
} from "./types";

type RoleSlot = "threats" | "removal" | "boardWipes" | "counterspells" | "cardDraw" | "ramp";

const ROLE_ORDER: RoleSlot[] = [
  "threats",
  "removal",
  "boardWipes",
  "counterspells",
  "cardDraw",
  "ramp",
];

const BASIC_BY_COLOR: Record<ManaColor, string> = {
  W: "Plains",
  U: "Island",
  B: "Swamp",
  R: "Mountain",
  G: "Forest",
};

/** Top-level entrypoint. Builds 1–3 variants and returns them sorted best-first. */
export function generateDecks(
  options: GenerateOptions,
  allCards: CardRecord[]
): GenerateMultiResult {
  const variantCount = Math.max(1, Math.min(3, options.variants ?? 1));
  const variants: GenerateResult[] = [];
  for (let i = 0; i < variantCount; i++) {
    variants.push(generateOne(options, allCards, 0xc0ffee + i * 7919));
  }
  variants.sort((a, b) => b.diagnostics.deckScore - a.diagnostics.deckScore);
  return { variants, bestIndex: 0 };
}

/** Single-variant entrypoint (kept for backwards compatibility / tests). */
export function generateDeck(
  options: GenerateOptions,
  allCards: CardRecord[]
): GenerateResult {
  return generateOne(options, allCards, 0xc0ffee);
}

function generateOne(
  options: GenerateOptions,
  allCards: CardRecord[],
  seed: number
): GenerateResult {
  const reasoning: string[] = [];
  const cardReasons: Record<string, string[]> = {};
  const rng = makeRng(seed);
  const targetMainboardSize = normalizedMainboardSize(options);
  const formatRules = getFormatRules(options.format);
  const target = scaleRoleTarget(
    blendRoleTargets(options.archetype, options.secondaryArchetypes),
    targetMainboardSize
  );

  // Selected colors are a hard constraint by default. Seed cards outside the
  // requested identity are excluded instead of silently widening the deck.
  const effectiveColors = options.allowSeedColorExpansion
    ? mergeSeedColors(options.colors, options.seedEntries ?? [])
    : options.colors;
  const rawSeedEntries = (options.seedEntries ?? []).filter((e) => e.board === "main");
  const rawFocusEntries = (options.focusEntries ?? []).filter((e) => e.board === "main");
  const rawPreferEntries = (options.preferEntries ?? []).filter((e) => e.board === "main");
  const legalSeedEntries = rawSeedEntries.filter((e) => isWithinColorIdentity(e.card, effectiveColors));
  const excludedSeedEntries = rawSeedEntries.filter((e) => !isWithinColorIdentity(e.card, effectiveColors));
  const seedIds = new Set(legalSeedEntries.map((e) => e.card.oracleId));
  const legalFocusEntries = rawFocusEntries
    .filter((e) => !seedIds.has(e.card.oracleId))
    .filter((e) => isWithinColorIdentity(e.card, effectiveColors));
  const excludedFocusEntries = rawFocusEntries.filter((e) => !isWithinColorIdentity(e.card, effectiveColors));
  const legalPreferEntries = rawPreferEntries
    .filter((e) => !seedIds.has(e.card.oracleId))
    .filter((e) => isWithinColorIdentity(e.card, effectiveColors));
  const excludedPreferEntries = rawPreferEntries.filter((e) => !isWithinColorIdentity(e.card, effectiveColors));
  let seedEntries = legalSeedEntries.filter((e) => !e.card.typeLine.includes("Land"));
  const seedLands = legalSeedEntries.filter((e) => e.card.typeLine.includes("Land"));
  // Optional fuzz: drop up to N lowest-scoring seed nonland copies and demote
  // them to preferEntries so the optimizer can swap them for better picks
  // while still being strongly biased to keep them.
  const fuzzSwaps = Math.max(0, Math.floor(options.seedFuzzSwaps ?? 0));
  const fuzzedPreferEntries: DeckEntry[] = [];
  if (fuzzSwaps > 0 && seedEntries.length > 0) {
    const tentativeAvgInit = 3.0;
    const scored = seedEntries
      .map((e) => ({ entry: e, score: cardScore(e.card, [], { ...options, colors: effectiveColors }, tentativeAvgInit) }))
      .sort((a, b) => a.score - b.score);
    let remainingToDrop = fuzzSwaps;
    const nextSeed: DeckEntry[] = seedEntries.map((e) => ({ ...e }));
    const seedByOracle = new Map(nextSeed.map((e) => [e.card.oracleId, e]));
    for (const { entry } of scored) {
      if (remainingToDrop <= 0) break;
      const live = seedByOracle.get(entry.card.oracleId);
      if (!live) continue;
      const drop = Math.min(live.quantity, remainingToDrop);
      live.quantity -= drop;
      remainingToDrop -= drop;
      fuzzedPreferEntries.push({ card: entry.card, quantity: drop, board: "main" });
    }
    seedEntries = nextSeed.filter((e) => e.quantity > 0);
    reasoning.push(
      `Seed fuzz: demoted ${fuzzSwaps - remainingToDrop} of ${fuzzSwaps} requested seed copies to soft-preferred (optimizer may swap them)`
    );
  }
  const seededCards = seedEntries.map((e) => e.card);
  const focusSourceEntries = legalFocusEntries.filter((e) => !e.card.typeLine.includes("Land"));

  reasoning.push(`Engine: offline (heuristic + simulated annealing)`);
  reasoning.push(`Format: ${formatRules.label}${options.playEnvironment ? ` (${options.playEnvironment.toUpperCase()})` : ""}`);
  reasoning.push(`Deck size target: ${targetMainboardSize} mainboard cards`);
  reasoning.push(`Archetype: ${options.archetype}`);
  if (options.secondaryArchetypes?.length) {
    reasoning.push(`Secondary archetypes: ${options.secondaryArchetypes.join(", ")}`);
  }
  reasoning.push(`Colors: ${effectiveColors.join("") || "(colorless)"}`);
  if (excludedSeedEntries.length > 0) {
    reasoning.push(`Excluded ${excludedSeedEntries.length} seed card(s) outside selected color identity`);
  }
  if (excludedFocusEntries.length > 0) {
    reasoning.push(`Excluded ${excludedFocusEntries.length} focus card(s) outside selected color identity`);
  }
  if (excludedPreferEntries.length > 0) {
    reasoning.push(`Excluded ${excludedPreferEntries.length} preferred card(s) outside selected color identity`);
  }
  if (legalPreferEntries.length > 0) {
    reasoning.push(`Preferred cards: ${legalPreferEntries.length} unique card(s) given a +10 score bonus (not locked)`);
  }
  if (seedEntries.length > 0) {
    reasoning.push(`Locked seed cards: ${seedEntries.length} unique (${seedEntries.reduce((s, e) => s + e.quantity, 0)} copies)`);
  }
  if (focusSourceEntries.length > 0) {
    reasoning.push(`Focus cards: ${focusSourceEntries.length} unique build-around card(s); quantities will be tuned instead of copied exactly`);
  }
  if (options.totalBudgetUsd != null) reasoning.push(`Total budget cap: $${options.totalBudgetUsd}`);
  if (options.maxCardPriceUsd != null) reasoning.push(`Max card price: $${options.maxCardPriceUsd}`);
  if (options.speed) reasoning.push(`Speed override: ${options.speed}`);
  if (options.spellRatio) reasoning.push(`Spell ratio: ${options.spellRatio}`);
  if (options.keywordFocus?.length) reasoning.push(`Keyword focus: ${options.keywordFocus.join(", ")}`);
  if (options.tribalSupport?.tribe) {
    reasoning.push(`Tribal support: ${options.tribalSupport.tribe} (${options.tribalSupport.mode})`);
  }

  const seedProfiles = seedEntries.map((e) => buildSynergyProfile(e.card));
  const focusProfiles = focusSourceEntries.map((e) => buildSynergyProfile(e.card));
  const deckAxes = deriveDeckAxes(options, [...seedProfiles, ...focusProfiles]);
  if (deckAxes.length > 0) reasoning.push(`Mechanical axes: ${deckAxes.join(", ")}`);
  if (options.metaTargets?.length) {
    // TODO(meta): apply counter-weighting — bias card scoring toward answers for
    // these meta archetypes' key cards. No-op today; recorded for transparency only.
    reasoning.push(`Meta targets (no-op): ${options.metaTargets.join(", ")}`);
  }

  // ── Phase 1: greedy baseline by role slot, accounting for seed/focus entries ──
  const tentativeAvg = approxAvgCmcForArchetype(target);
  const targetAvgCmc = targetAvgCmcFor({ ...options, colors: effectiveColors }, tentativeAvg);
  const focusEntries = buildFocusEntries(focusSourceEntries, options, target, targetAvgCmc, reasoning);
  const focusedCards = focusEntries.map((e) => e.card);

  const effectiveOptions: GenerateOptions = {
    ...options,
    colors: effectiveColors,
    focusEntries,
    preferEntries: [...legalPreferEntries, ...fuzzedPreferEntries],
  };

  // Build pool, exclude seed-locked and focus-pinned oracleIds.
  // NOTE: seedLands are also locked so that downstream size-trimming never
  // deletes user/seed lands when the deck overflows (which would silently
  // collapse the mana base on repeated regenerations).
  const lockedIds = new Set([...seedEntries, ...focusEntries, ...seedLands].map((e) => e.card.oracleId));
  const pool = buildPool(allCards, effectiveOptions).filter(
    (c) => !c.typeLine.includes("Land") && !lockedIds.has(c.oracleId)
  );
  reasoning.push(`Filtered pool: ${pool.length} non-land candidates`);

  const entries: DeckEntry[] = [...cloneEntries(seedEntries), ...cloneEntries(focusEntries)];
  const pieStrength = options.colorPieStrength ?? 1.0;
  for (const e of seedEntries) {
    cardReasons[e.card.oracleId] = [`Seed: locked from the current deck`, ...generateTribalReasons(e.card, options.tribalSupport), ...generateColorPieReasons(e.card, pieStrength), ...generateCardReasons(
      buildSynergyProfile(e.card),
      deckAxes,
      seedProfiles,
      "seed"
    )];
  }
  for (const e of focusEntries) {
    cardReasons[e.card.oracleId] = [`Focus: build-around card tuned to ${e.quantity} cop${e.quantity === 1 ? "y" : "ies"}`, ...generateTribalReasons(e.card, options.tribalSupport), ...generateColorPieReasons(e.card, pieStrength), ...generateCardReasons(
      buildSynergyProfile(e.card),
      deckAxes,
      seedProfiles,
      "focus"
    )];
  }
  const used = new Set<string>(entries.map((e) => e.card.oracleId));
  const seedRoleCounts = countSeedRoles(seedEntries);

  for (const role of ROLE_ORDER) {
    const need = Math.max(0, (target[role] ?? 0) - (seedRoleCounts[role] ?? 0));
    if (need <= 0) {
      reasoning.push(`${role}: already satisfied by seed (need 0)`);
      continue;
    }
    const picks = fillRole(role, pool, used, entries, need, target, effectiveOptions, targetAvgCmc, options.spellRatio, deckAxes);
    const placed = picks.reduce((s, e) => s + e.quantity, 0);
    entries.push(...picks);
    for (const p of picks) used.add(p.card.oracleId);
    const deckProfiles = entries
      .filter((e) => !e.card.typeLine.includes("Land"))
      .map((e) => buildSynergyProfile(e.card));
    for (const p of picks) {
      cardReasons[p.card.oracleId] = generateCardReasons(
        buildSynergyProfile(p.card),
        deckAxes,
        deckProfiles,
        role
      );
      cardReasons[p.card.oracleId] = [
        ...generateTribalReasons(p.card, options.tribalSupport),
        ...generateColorPieReasons(p.card, pieStrength),
        ...cardReasons[p.card.oracleId],
      ];
    }
    reasoning.push(`${role}: placed ${placed} / ${need}`);
  }

  // ── Phase 2: mana base ──
  // Seed lands count toward the total; add dual/nonbasic fixing first, then basics.
  const seedLandTotal = seedLands.reduce((s, e) => s + e.quantity, 0);
  const landBudget = recommendLandCount(entries).recommended;
  const remainingLands = Math.max(0, landBudget - seedLandTotal);
  reasoning.push(
    `Mana base: ${landBudget} target lands (${seedLandTotal} from seed, ${remainingLands} generated lands to add)`
  );
  entries.push(...seedLands);
  const generatedLands = pickManaBaseLands(allCards, effectiveColors, remainingLands, seedLands, effectiveOptions.format);
  entries.push(...generatedLands);
  const generatedDualCount = generatedLands
    .filter((e) => !BASIC_LAND_NAMES.has(e.card.name))
    .reduce((s, e) => s + e.quantity, 0);
  const generatedBasicCount = generatedLands
    .filter((e) => BASIC_LAND_NAMES.has(e.card.name))
    .reduce((s, e) => s + e.quantity, 0);
  if (generatedDualCount > 0 || generatedBasicCount > 0) {
    reasoning.push(
      `Mana base: included ${generatedDualCount} dual/nonbasic fixing land${generatedDualCount === 1 ? "" : "s"} and ${generatedBasicCount} basic land${generatedBasicCount === 1 ? "" : "s"}`
    );
  }

  // Pad to target size with extra basics if anything fell short.
  let total = entries.reduce((s, e) => s + e.quantity, 0);
  const basicEntries = generatedLands.filter((e) => BASIC_LAND_NAMES.has(e.card.name));
  if (total < targetMainboardSize && basicEntries.length > 0) {
    const deficit = targetMainboardSize - total;
    basicEntries[0].quantity += deficit;
    reasoning.push(`Padded ${deficit} extra basic ${basicEntries[0].card.name}(s) to reach ${targetMainboardSize}`);
    total = entries.reduce((s, e) => s + e.quantity, 0);
  } else if (total < targetMainboardSize) {
    reasoning.push(`Could not pad (no basic lands found in DB) — short ${targetMainboardSize - total} cards`);
  } else if (total > targetMainboardSize) {
    const before = total;
    trimMainboardToSize(entries, targetMainboardSize, lockedIds);
    total = entries.reduce((s, e) => s + e.quantity, 0);
    if (total < before) reasoning.push(`Trimmed ${before - total} generated card${before - total === 1 ? "" : "s"} to respect ${targetMainboardSize}-card maximum`);
  }

  const baselineScore = deckScore(entries, effectiveOptions, targetAvgCmc);
  const baselineMainLandCount = countMainLands(entries);
  reasoning.push(
    `Baseline deck score: ${baselineScore.total.toFixed(1)} (cards ${baselineScore.cardScoreSum.toFixed(0)}, curve dev ${baselineScore.curveDeviation.toFixed(2)}, mana coverage ${(baselineScore.manaBaseCoverage * 100).toFixed(0)}%)`
  );

  // ── Phase 3: optimizer ──
  const iterations = options.optimizationIterations ?? 200;
  const optResult = optimize(entries, {
    pool,
    options: effectiveOptions,
    targetAvgCmc,
    locked: lockedIds,
    iterations,
    rng,
  });
  reasoning.push(
    `Optimizer: ${optResult.improvements} improvement(s) over ${optResult.steps} iterations → score ${optResult.finalScore.toFixed(1)}`
  );

  let finalEntries = optResult.entries;
  const optimizedMainLandCount = countMainLands(finalEntries);
  if (optimizedMainLandCount < baselineMainLandCount) {
    reasoning.push(
      `Optimizer guard: restored baseline mana base after land count dropped from ${baselineMainLandCount} to ${optimizedMainLandCount}`
    );
    finalEntries = cloneEntries(entries);
  }

  // Final invariant: regardless of any prior trim/optimizer step, never leave
  // the deck below the recommended land floor. If lands fell short, top up
  // with basics (color-balanced) by replacing the highest-cmc nonland slots.
  enforceLandFloor(finalEntries, landBudget, effectiveColors, allCards, lockedIds, targetMainboardSize, reasoning);

  const finalMainProfiles = finalEntries
    .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
    .map((e) => buildSynergyProfile(e.card));
  for (const e of finalEntries) {
    if (e.card.typeLine.includes("Land")) continue;
    if (!cardReasons[e.card.oracleId]) {
      cardReasons[e.card.oracleId] = [
        ...generateTribalReasons(e.card, options.tribalSupport),
        ...generateColorPieReasons(e.card, pieStrength),
        ...generateCardReasons(
        buildSynergyProfile(e.card),
        deckAxes,
        finalMainProfiles,
        "optimized"
        ),
      ];
    }
  }

  // ── Phase 4: optional sideboard ──
  if (options.generateSideboard) {
    const side = generateSideboard(finalEntries, allCards, effectiveOptions);
    finalEntries = [...finalEntries, ...side];
    reasoning.push(
      `Sideboard: ${side.reduce((s, e) => s + e.quantity, 0)} cards generated against typical meta`
    );
  }

  const finalScore = deckScore(finalEntries, effectiveOptions, targetAvgCmc);
  const scoreBreakdown = buildScoreBreakdown(finalEntries, effectiveOptions, targetAvgCmc);
  const diagnostics: GenerationDiagnostic = {
    reasoning,
    deckScore: finalScore.total,
    cardScoreSum: finalScore.cardScoreSum,
    curveDeviation: finalScore.curveDeviation,
    manaBaseCoverage: finalScore.manaBaseCoverage,
    optimizerSteps: optResult.steps,
    primaryAxes: deckAxes,
  };

  return {
    entries: finalEntries,
    archetype: options.archetype,
    totalCards: finalEntries.reduce((s, e) => s + e.quantity, 0),
    diagnostics,
    seededCards,
    focusedCards,
    cardReasons,
    scoreBreakdown,
  };
}

// ─── helpers ────────────────────────────────────────────────────────────────

function fillRole(
  role: RoleSlot,
  pool: CardRecord[],
  used: Set<string>,
  deckSoFar: DeckEntry[],
  need: number,
  target: RoleTarget,
  options: GenerateOptions,
  targetAvgCmc: number,
  spellRatio: GenerateOptions["spellRatio"],
  deckAxes: MechanicAxis[]
): DeckEntry[] {
  const candidates = pool.filter((c) => {
    if (used.has(c.oracleId)) return false;
    const roles = assignRoles(c);
    if (!matchesRole(role, roles)) return false;
    if (role === "threats" && spellRatio) {
      const isCreature = c.typeLine.includes("Creature");
      if (spellRatio === "creature-heavy" && !isCreature) return false;
      if (spellRatio === "spell-heavy" && isCreature) return false;
    }
    return true;
  });

  const inCurve = candidates.filter((c) => c.cmc <= target.maxAvgCmc + 1);
  const outCurve = candidates.filter((c) => c.cmc > target.maxAvgCmc + 1);
  const ordered = [...inCurve, ...outCurve]
    .map((card) => ({
      card,
      score: cardScore(card, deckSoFar, { ...options, keywordFocus: mergeAxesIntoKeywordFocus(options.keywordFocus, deckAxes) }, targetAvgCmc),
    }))
    .sort((a, b) => b.score - a.score);

  const result: DeckEntry[] = [];
  let placed = 0;
  for (const { card } of ordered) {
    if (placed >= need) break;
    const qty = recommendedCopyCount(card, role, need - placed, options.format);
    result.push({ card, quantity: qty, board: "main" });
    placed += qty;
  }
  return result;
}

function recommendedCopyCount(card: CardRecord, role: RoleSlot, remainingNeed: number, format?: GenerateOptions["format"]): number {
  const cap = maxCopiesForCard(card, format);

  // Preserve special "any number" cards when the database/card text allows it.
  if (cap > 4) return Math.min(cap, remainingNeed);

  // Legendary and high-impact singleton-style effects are poor blind 4-of defaults.
  if (card.typeLine.includes("Legendary") || card.gameChanger) {
    return Math.min(cap, remainingNeed, 2);
  }

  switch (role) {
    case "boardWipes":
      return Math.min(cap, remainingNeed, 1);
    case "removal":
    case "counterspells":
    case "cardDraw":
    case "ramp":
      return Math.min(cap, remainingNeed, 2);
    case "threats":
      return Math.min(cap, remainingNeed, card.cmc <= 2 ? 3 : 2);
  }
}

function buildFocusEntries(
  focusSourceEntries: DeckEntry[],
  options: GenerateOptions,
  _target: RoleTarget,
  targetAvgCmc: number,
  reasoning: string[]
): DeckEntry[] {
  const byOracle = new Map<string, DeckEntry>();
  for (const entry of focusSourceEntries) {
    const existing = byOracle.get(entry.card.oracleId);
    if (existing) existing.quantity += entry.quantity;
    else byOracle.set(entry.card.oracleId, { card: entry.card, quantity: entry.quantity, board: "main" });
  }

  const ordered = [...byOracle.values()]
    .map((entry) => ({
      entry,
      score: cardScore(entry.card, [], options, targetAvgCmc),
    }))
    .sort((a, b) => b.score - a.score);

  const result: DeckEntry[] = [];
  for (const { entry } of ordered) {
    const qty = recommendedFocusCopyCount(entry.card, entry.quantity, targetAvgCmc, options.format);
    if (qty <= 0) continue;
    result.push({ card: entry.card, quantity: qty, board: "main" });
    reasoning.push(`Focus: ${entry.card.name} set to ${qty} cop${qty === 1 ? "y" : "ies"} (current ${entry.quantity}, cap ${maxCopiesForCard(entry.card, options.format)})`);
  }

  reasoning.push(`Focus: preserved ${result.length} unique build-around card(s); no strategy card was dropped by an arbitrary focus budget`);

  return result;
}

function recommendedFocusCopyCount(card: CardRecord, currentQuantity: number, targetAvgCmc: number, format?: GenerateOptions["format"]): number {
  const cap = Math.min(maxCopiesForCard(card, format), 4);
  if (cap <= 0) return 0;

  const roles = assignRoles(card);
  let desired = 2;

  if (roles.includes("BoardWipe")) desired = 1;
  else if (isThreat(roles) && card.cmc <= targetAvgCmc + 0.75) desired = 4;
  else if (isThreat(roles)) desired = 3;
  else if (roles.includes("Removal") || roles.includes("Counterspell") || roles.includes("CardDraw") || roles.includes("Ramp")) desired = 3;

  if (card.typeLine.includes("Legendary") || card.gameChanger) desired = Math.min(desired, 2);
  if (card.cmc >= targetAvgCmc + 2) desired = Math.min(desired, 2);

  // Build-around should preserve the user's strategy core, not explode every
  // imported 1-of into a 3–4-of package that crowds out all new candidates.
  return Math.max(1, Math.min(cap, currentQuantity, desired));
}

function matchesRole(slot: RoleSlot, roles: CardRole[]): boolean {
  switch (slot) {
    case "threats":      return isThreat(roles);
    case "removal":      return roles.includes("Removal");
    case "boardWipes":   return roles.includes("BoardWipe");
    case "counterspells":return roles.includes("Counterspell");
    case "cardDraw":     return roles.includes("CardDraw");
    case "ramp":         return roles.includes("Ramp");
  }
}

function pickBasicLands(
  allCards: CardRecord[],
  colors: ManaColor[],
  count: number
): DeckEntry[] {
  if (count <= 0) return [];

  if (colors.length === 0) {
    const wastes = allCards.find((c) => c.name === "Wastes" && BASIC_LAND_NAMES.has(c.name));
    return wastes ? [{ card: wastes, quantity: count, board: "main" }] : [];
  }

  const perColor = Math.floor(count / colors.length);
  const remainder = count - perColor * colors.length;
  const entries: DeckEntry[] = [];

  colors.forEach((color, i) => {
    const name = BASIC_BY_COLOR[color];
    const land = allCards
      .filter((c) => c.name === name && c.typeLine.includes("Basic"))
      .sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0))[0];
    if (!land) return;
    const qty = perColor + (i < remainder ? 1 : 0);
    if (qty > 0) entries.push({ card: land, quantity: qty, board: "main" });
  });

  return entries;
}

function pickManaBaseLands(
  allCards: CardRecord[],
  colors: ManaColor[],
  count: number,
  seedLands: DeckEntry[],
  format?: GenerateOptions["format"]
): DeckEntry[] {
  if (count <= 0) return [];
  if (colors.length < 2) return pickBasicLands(allCards, colors, count);

  const entries: DeckEntry[] = [];
  const existingByOracle = new Map(seedLands.map((entry) => [entry.card.oracleId, entry.quantity]));
  const seedLandTotal = seedLands.reduce((sum, entry) => sum + entry.quantity, 0);
  const seedBasicTotal = seedLands
    .filter((entry) => BASIC_LAND_NAMES.has(entry.card.name))
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const totalLandTarget = seedLandTotal + count;
  const desiredBasicTotal = recommendedBasicLandReserve(colors, totalLandTarget);
  const basicSlots = Math.min(count, Math.max(0, desiredBasicTotal - seedBasicTotal));
  const fixingSlots = Math.max(0, count - basicSlots);
  let remainingFixing = fixingSlots;

  for (const suggestion of recommendDualLands(allCards, colors, fixingSlots, format)) {
    if (remainingFixing <= 0) break;
    const already = existingByOracle.get(suggestion.card.oracleId) ?? 0;
    const available = Math.max(0, maxCopiesForCard(suggestion.card, format) - already);
    const qty = Math.min(remainingFixing, suggestion.quantity, available);
    if (qty <= 0) continue;
    entries.push({ card: suggestion.card, quantity: qty, board: "main" });
    remainingFixing -= qty;
  }

  const usedFixing = fixingSlots - remainingFixing;
  const remaining = count - usedFixing;
  if (remaining > 0) entries.push(...pickBasicLands(allCards, colors, remaining));
  return entries;
}

function recommendedBasicLandReserve(colors: ManaColor[], totalLandTarget: number): number {
  if (totalLandTarget <= 0) return 0;
  if (colors.length < 2) return totalLandTarget;

  const ratio = colors.length === 2 ? 0.32 : 0.24;
  const floor = colors.length === 2 ? 6 : 4;
  const cap = colors.length === 2 ? 8 : 6;
  const reserve = Math.max(floor, Math.ceil(totalLandTarget * ratio));

  return Math.min(totalLandTarget, cap, reserve);
}

function mergeSeedColors(colors: ManaColor[], seed: DeckEntry[]): ManaColor[] {
  const set = new Set(colors);
  for (const e of seed) {
    try {
      const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
      for (const c of ci) set.add(c);
    } catch { /* ignore */ }
  }
  return Array.from(set);
}

function isWithinColorIdentity(card: CardRecord, colors: ManaColor[]): boolean {
  const allowed = new Set(colors);
  try {
    const identity = JSON.parse(card.colorIdentityJson) as ManaColor[];
    return identity.every((c) => allowed.has(c));
  } catch {
    return true;
  }
}

function deriveDeckAxes(options: GenerateOptions, seedProfiles: ReturnType<typeof buildSynergyProfile>[]): MechanicAxis[] {
  return uniqueAxes([
    ...archetypeAxes(options.archetype),
    ...(options.secondaryArchetypes ?? []).flatMap(archetypeAxes),
    ...keywordFocusToAxes(options.keywordFocus ?? []),
    ...inferPrimaryAxes(seedProfiles),
  ]).slice(0, 4);
}

function archetypeAxes(archetype: GenerateOptions["archetype"]): MechanicAxis[] {
  switch (archetype) {
    case "Burn":      return ["spellslinger"];
    case "Tokens":    return ["tokens"];
    case "Graveyard": return ["graveyard", "selfMill"];
    case "Sacrifice": return ["sacrifice", "tokens"];
    case "Tempo":     return ["spellslinger", "etb"];
    case "Combo":     return ["draw", "spellslinger"];
    case "Ramp":      return ["draw"];
    case "Control":   return ["draw"];
    case "Aggro":     return ["counters"];
    case "Midrange":  return ["etb", "draw"];
    case "Unknown":   return [];
  }
}

function uniqueAxes(axes: MechanicAxis[]): MechanicAxis[] {
  return [...new Set(axes)];
}

function mergeAxesIntoKeywordFocus(
  existing: GenerateOptions["keywordFocus"],
  axes: MechanicAxis[]
): GenerateOptions["keywordFocus"] {
  const focus = new Set(existing ?? []);
  for (const axis of axes) {
    if (axis === "tokens") focus.add("Tokens");
    if (axis === "sacrifice") focus.add("Sacrifice");
    if (axis === "graveyard" || axis === "selfMill") focus.add("Graveyard");
    if (axis === "mill") focus.add("Mill");
    if (axis === "lifegain") focus.add("Lifegain");
    if (axis === "counters") focus.add("Counters");
    if (axis === "discard") focus.add("Discard");
    if (axis === "selfMill") focus.add("Graveyard");
  }
  return [...focus];
}

function countSeedRoles(seed: DeckEntry[]): Record<RoleSlot, number> {
  const counts: Record<RoleSlot, number> = {
    threats: 0, removal: 0, boardWipes: 0, counterspells: 0, cardDraw: 0, ramp: 0,
  };
  for (const e of seed) {
    if (e.card.typeLine.includes("Land")) continue;
    const roles = assignRoles(e.card);
    for (const slot of ROLE_ORDER) {
      if (matchesRole(slot, roles)) counts[slot] += e.quantity;
    }
  }
  return counts;
}

function approxAvgCmcForArchetype(t: RoleTarget): number {
  return t.maxAvgCmc;
}

function cloneEntries(entries: DeckEntry[]): DeckEntry[] {
  return entries.map((e) => ({ card: e.card, quantity: e.quantity, board: e.board }));
}

function countMainLands(entries: DeckEntry[]): number {
  return entries
    .filter((e) => e.board === "main" && e.card.typeLine.includes("Land"))
    .reduce((sum, entry) => sum + entry.quantity, 0);
}

function normalizedMainboardSize(options: GenerateOptions): number {
  const rules = getFormatRules(options.format);
  const requested = options.maxMainboardSize ?? options.mainboardSize ?? rules.defaultMainboardSize;
  if (!Number.isFinite(requested)) return rules.defaultMainboardSize;
  return Math.max(rules.minMainboardSize, Math.min(rules.maxMainboardSize, Math.round(requested)));
}

function scaleRoleTarget(target: RoleTarget, mainboardSize: number): RoleTarget {
  if (mainboardSize === 60) return target;
  const ratio = mainboardSize / 60;
  return {
    ...target,
    threats: Math.round(target.threats * ratio),
    removal: Math.round(target.removal * ratio),
    boardWipes: Math.round(target.boardWipes * ratio),
    counterspells: Math.round(target.counterspells * ratio),
    cardDraw: Math.round(target.cardDraw * ratio),
    ramp: Math.round(target.ramp * ratio),
    lands: Math.round(target.lands * ratio),
  };
}

function enforceLandFloor(
  entries: DeckEntry[],
  landFloor: number,
  colors: ManaColor[],
  allCards: CardRecord[],
  lockedIds: Set<string>,
  targetMainboardSize: number,
  reasoning: string[]
): void {
  // Land floor with a small tolerance: don't refuse a deck that's within 2 lands
  // of the recommendation. Below that, top up.
  const tolerance = 2;
  const minLands = Math.max(0, landFloor - tolerance);
  let landCount = countMainLands(entries);
  if (landCount >= minLands) return;

  const needed = landFloor - landCount;
  const before = landCount;

  // Step 1: shed the highest-cmc removable nonlands to make room.
  let total = entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0);
  const headroom = Math.max(0, targetMainboardSize - total);
  let toFree = Math.max(0, needed - headroom);
  if (toFree > 0) {
    const shedCandidates = entries
      .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land") && !lockedIds.has(e.card.oracleId))
      .sort((a, b) => b.card.cmc - a.card.cmc);
    for (const entry of shedCandidates) {
      if (toFree <= 0) break;
      const remove = Math.min(entry.quantity, toFree);
      entry.quantity -= remove;
      toFree -= remove;
      total -= remove;
    }
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].quantity <= 0) entries.splice(i, 1);
  }

  // Step 2: add basics up to landFloor (or until mainboard hits target).
  const room = Math.max(0, targetMainboardSize - entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0));
  const toAdd = Math.min(needed, room);
  if (toAdd > 0) {
    const basics = pickBasicLandsAdditive(allCards, colors, toAdd, entries);
    for (const b of basics) {
      const existing = entries.find((e) => e.board === "main" && e.card.oracleId === b.card.oracleId);
      if (existing) existing.quantity += b.quantity;
      else entries.push(b);
    }
  }

  landCount = countMainLands(entries);
  if (landCount > before) {
    reasoning.push(`Land-floor guard: padded ${landCount - before} basic land(s) to reach recommended ${landFloor} (was ${before})`);
  } else if (landCount < landFloor) {
    reasoning.push(`Land-floor guard: deck is ${landFloor - landCount} land(s) short of recommended ${landFloor} (no room or no basics available)`);
  }
}

function pickBasicLandsAdditive(
  allCards: CardRecord[],
  colors: ManaColor[],
  count: number,
  existing: DeckEntry[]
): DeckEntry[] {
  if (count <= 0) return [];
  // Distribute basics weighted toward colors least represented among existing lands.
  const haveByColor: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const e of existing) {
    if (!e.card.typeLine.includes("Land")) continue;
    try {
      const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
      for (const c of ci) haveByColor[c] = (haveByColor[c] ?? 0) + e.quantity;
    } catch { /* ignore */ }
  }
  return pickBasicLandsBalanced(allCards, colors, count, haveByColor);
}

function pickBasicLandsBalanced(
  allCards: CardRecord[],
  colors: ManaColor[],
  count: number,
  haveByColor: Record<string, number>
): DeckEntry[] {
  if (count <= 0) return [];
  if (colors.length === 0) {
    const wastes = allCards.find((c) => c.name === "Wastes" && BASIC_LAND_NAMES.has(c.name));
    return wastes ? [{ card: wastes, quantity: count, board: "main" }] : [];
  }
  // Greedy: each iteration, add to the color with the lowest current share.
  const out = new Map<string, DeckEntry>();
  const counts: Record<string, number> = { ...haveByColor };
  for (let i = 0; i < count; i++) {
    let bestColor: ManaColor = colors[0];
    let bestVal = Infinity;
    for (const c of colors) {
      const v = counts[c] ?? 0;
      if (v < bestVal) { bestVal = v; bestColor = c; }
    }
    counts[bestColor] = (counts[bestColor] ?? 0) + 1;
    const name = BASIC_BY_COLOR[bestColor];
    const land = allCards
      .filter((c) => c.name === name && c.typeLine.includes("Basic"))
      .sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0))[0];
    if (!land) continue;
    const existing = out.get(land.oracleId);
    if (existing) existing.quantity += 1;
    else out.set(land.oracleId, { card: land, quantity: 1, board: "main" });
  }
  return [...out.values()];
}

function trimMainboardToSize(entries: DeckEntry[], targetSize: number, lockedIds: Set<string>): void {
  let total = entries.filter((e) => e.board === "main").reduce((sum, entry) => sum + entry.quantity, 0);
  if (total <= targetSize) return;

  const removable = entries
    .map((entry, index) => ({ entry, index }))
    .filter(({ entry }) => entry.board === "main" && !lockedIds.has(entry.card.oracleId))
    .sort((a, b) => {
      const landA = a.entry.card.typeLine.includes("Land") ? 1 : 0;
      const landB = b.entry.card.typeLine.includes("Land") ? 1 : 0;
      if (landA !== landB) return landA - landB;
      return b.entry.card.cmc - a.entry.card.cmc;
    });

  for (const { entry } of removable) {
    if (total <= targetSize) break;
    const remove = Math.min(entry.quantity, total - targetSize);
    entry.quantity -= remove;
    total -= remove;
  }

  for (let i = entries.length - 1; i >= 0; i--) {
    if (entries[i].quantity <= 0) entries.splice(i, 1);
  }
}