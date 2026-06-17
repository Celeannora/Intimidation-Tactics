import type { CardRecord, ManaColor } from "../types";
import type { DeckEntry } from "../legality";
import { BASIC_LAND_NAMES, maxCopiesForCard } from "../legality";
import { getFormatRules } from "../formats";
import { assignRoles, isThreat, type CardRole } from "../roles";
import {
  recommendDualLands,
  recommendLandCount,
  recommendColorSources,
  classifyColorRoles,
  type ColorRoleTarget,
} from "../manaBase";
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
import { assertOfflineStageOrder } from "./pipeline";

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

/** Absolute minimum lands a deck must have, regardless of any other calculation.
 *  A deck with fewer lands than this is structurally broken and will be
 *  auto-corrected. */
const ABSOLUTE_MINIMUM_LANDS = 10;

/** Synthetic basic land CardRecord entries used as a hard fallback when the
 *  real Scryfall database is missing basic lands (e.g. a filtered import).
 *  These are minimal but sufficient for the generator to always produce a
 *  functioning mana base. */
function syntheticBasicLand(name: string, colors: ManaColor[]): CardRecord {
  const id = `synthetic-basic-${name.toLowerCase()}`;
  return {
    id,
    oracleId: id,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "",
    cmc: 0,
    colorsJson: JSON.stringify(colors),
    colorIdentityJson: JSON.stringify(colors),
    typeLine: `Basic Land${colors.length === 0 ? "" : ` — ${colors.join("/")}`}`,
    oracleText: colors.length === 0
      ? "{T}: Add {C}."
      : `{T}: Add {${colors.join("}, {")}}.`,
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: JSON.stringify(colors),
    legalityStandard: "legal",
    legalityFuture: "legal",
    bannedInStandard: 0,
    legalitiesJson: "{}",
    setCode: "M20",
    setName: "Core Set 2020",
    setType: null,
    collectorNumber: null,
    rarity: "common",
    imageNormal: null,
    priceUsd: 0,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: 99999,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: name.toLowerCase(),
    importedAt: new Date(0).toISOString(),
  };
}

const SYNTHETIC_BASICS: CardRecord[] = [
  syntheticBasicLand("Plains", ["W"]),
  syntheticBasicLand("Island", ["U"]),
  syntheticBasicLand("Swamp", ["B"]),
  syntheticBasicLand("Mountain", ["R"]),
  syntheticBasicLand("Forest", ["G"]),
  syntheticBasicLand("Wastes", []),
];

/** Resolve a basic land by name from the database, falling back to a synthetic
 *  entry when the database doesn't contain it. This guarantees the generator
 *  can always produce a mana base. */
function resolveBasicLand(allCards: CardRecord[], name: string): CardRecord {
  // Prefer cheapest real print (avoids premium foils / masterpieces)
  const real = allCards
    .filter((c) => c.name === name && c.typeLine.includes("Basic"))
    .sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0));
  if (real.length > 0) return real[0];
  // Fallback to synthetic — this ensures zero-land decks are impossible
  const synth = SYNTHETIC_BASICS.find((c) => c.name === name);
  if (synth) {
    console.warn(
      `[generator] Database missing basic land "${name}" — using synthetic fallback. ` +
      `Re-import the full Scryfall dump to restore real card data.`
    );
    return synth;
  }
  // Ultimate fallback — should never happen with SYNTHETIC_BASICS defined above
  return SYNTHETIC_BASICS[0];
}

assertOfflineStageOrder([
  "pool-builder",
  "role-fill",
  "mana-base",
  "optimizer",
  "sideboard",
  "result-assembly",
]);

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
  const idealGeneratedLands = Math.max(0, landBudget - seedLandTotal);

  // Guarantee the mana base has room. Without this guard, if locked/seed nonlands already
  // occupy more slots than (targetMainboardSize - landBudget), trimMainboardToSize is forced
  // to cut the freshly-added lands (the only unlocked cards), producing decks with as few
  // as 7 lands. Fix: shed the highest-CMC *unlocked* nonlands first; then cap generated
  // lands to whatever slots actually remain after locked cards are accounted for.
  const idealNonlandSlots = targetMainboardSize - landBudget - seedLandTotal;
  const currentNonlandTotal = entries.reduce((s, e) => s + e.quantity, 0);
  if (currentNonlandTotal > idealNonlandSlots) {
    const toShed = currentNonlandTotal - idealNonlandSlots;
    const shedable = entries
      .filter((e) => !lockedIds.has(e.card.oracleId))
      .sort((a, b) => b.card.cmc - a.card.cmc);
    let remaining = toShed;
    for (const e of shedable) {
      if (remaining <= 0) break;
      const cut = Math.min(e.quantity, remaining);
      e.quantity -= cut;
      remaining -= cut;
    }
    for (let i = entries.length - 1; i >= 0; i--) if (entries[i].quantity <= 0) entries.splice(i, 1);
    const actualShed = toShed - remaining;
    if (actualShed > 0) {
      reasoning.push(
        `Mana-base reserve: shed ${actualShed} unlocked nonland cop${actualShed === 1 ? "y" : "ies"} (highest CMC first) to guarantee ${landBudget} land slot${landBudget === 1 ? "" : "s"}`
      );
    }
  }

  // Cap generated lands to the actual open slots. If locked nonlands claim all remaining
  // space, we generate only what fits and warn — forcing the user to reduce seed count.
  const placedNonlandCopies = entries.reduce((s, e) => s + e.quantity, 0);
  const availableLandSlots = Math.max(0, targetMainboardSize - placedNonlandCopies - seedLandTotal);
  const remainingLands = Math.min(idealGeneratedLands, availableLandSlots);
  if (remainingLands < idealGeneratedLands) {
    const lockedNonlandCopies = entries
      .filter((e) => lockedIds.has(e.card.oracleId))
      .reduce((s, e) => s + e.quantity, 0);
    reasoning.push(
      `Land-budget constraint: ${lockedNonlandCopies} locked nonland cop${lockedNonlandCopies === 1 ? "y" : "ies"} leave only ${availableLandSlots} slot${availableLandSlots === 1 ? "" : "s"} for lands ` +
      `(target ${landBudget}, generating ${seedLandTotal + remainingLands}). ` +
      `Reduce seed card count to reach the recommended mana base.`
    );
  }
  reasoning.push(
    `Mana base: ${landBudget} target lands (${seedLandTotal} from seed, ${remainingLands} generated lands to add)`
  );
  entries.push(...seedLands);

  // ── Classify colors into main / secondary / splash and compute per-color
  //    source targets BEFORE selecting any lands.  This is the fix for the
  //    "one green splash card → 10 Forests" class of bug: instead of treating
  //    every color in effectiveColors as symmetric, we now assign role-aware
  //    target source counts and honour hard caps for splash colors.
  const nonlandEntriesForClassify = entries.filter((e) => !e.card.typeLine.includes("Land"));
  const colorSourceRecs = recommendColorSources(nonlandEntriesForClassify, landBudget);
  const colorTargets = classifyColorRoles(colorSourceRecs, nonlandEntriesForClassify, targetMainboardSize);
  if (colorTargets.length > 0) {
    const rolesSummary = colorTargets
      .map((t) => `${t.color}=${t.role}(target ${t.targetSources}src)`)
      .join(", ");
    reasoning.push(`Mana-base roles: ${rolesSummary}`);
  }

  const generatedLands = pickManaBaseLands(allCards, colorTargets, effectiveColors, remainingLands, seedLands, effectiveOptions.format);
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
  // Choose the main/secondary-color basic with the greatest remaining source
  // deficit so padding goes where it is most needed rather than always
  // landing on whatever basic came first in generatedLands.
  let total = entries.reduce((s, e) => s + e.quantity, 0);
  if (total < targetMainboardSize) {
    const padDeficit = targetMainboardSize - total;
    // Re-compute current source counts across all lands chosen so far.
    const padSources: Record<string, number> = {};
    for (const t of colorTargets) padSources[t.color] = 0;
    for (const e of entries) {
      if (!e.card.typeLine.includes("Land")) continue;
      try {
        const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
        for (const c of ci) {
          if (c in padSources) padSources[c] = (padSources[c] ?? 0) + e.quantity;
        }
      } catch { /* ignore */ }
    }
    // Pick the color entry with the largest remaining deficit that is NOT a
    // splash (splashes keep their maxBasics cap).
    const basicLandEntries = entries.filter((e) => e.board === "main" && BASIC_LAND_NAMES.has(e.card.name));
    const bestPadEntry = basicLandEntries.filter((e) => {
      try {
        const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
        if (ci.length !== 1) return false;
        const t = colorTargets.find((x) => x.color === ci[0]);
        return !t || t.role !== "splash";
      } catch { return false; }
    }).sort((a, b) => {
      const getDeficit = (entry: DeckEntry) => {
        try {
          const ci = JSON.parse(entry.card.colorIdentityJson) as ManaColor[];
          if (ci.length !== 1) return -Infinity;
          const t = colorTargets.find((x) => x.color === ci[0]);
          return (t?.targetSources ?? 0) - (padSources[ci[0]] ?? 0);
        } catch { return -Infinity; }
      };
      return getDeficit(b) - getDeficit(a);
    })[0] ?? basicLandEntries[0];

    if (bestPadEntry) {
      bestPadEntry.quantity += padDeficit;
      reasoning.push(`Padded ${padDeficit} extra basic ${bestPadEntry.card.name}(s) to reach ${targetMainboardSize}`);
      total = entries.reduce((s, e) => s + e.quantity, 0);
    } else if (total < targetMainboardSize) {
      reasoning.push(`Could not pad (no basic lands found in DB) — short ${targetMainboardSize - total} cards`);
    }
  }
  if (total > targetMainboardSize) {
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
    const wastes = resolveBasicLand(allCards, "Wastes");
    return [{ card: wastes, quantity: count, board: "main" }];
  }

  const perColor = Math.floor(count / colors.length);
  const remainder = count - perColor * colors.length;
  const entries: DeckEntry[] = [];

  colors.forEach((color, i) => {
    const name = BASIC_BY_COLOR[color];
    const land = resolveBasicLand(allCards, name);
    const qty = perColor + (i < remainder ? 1 : 0);
    if (qty > 0) entries.push({ card: land, quantity: qty, board: "main" });
  });

  return entries;
}

/**
 * Demand-driven mana base picker.
 *
 * The OLD version treated every color in `colors` as a symmetric peer: it
 * divided basic land slots evenly and equalised land counts across all
 * colors.  That produced catastrophic results for splash colors (e.g. one
 * green card → 10 Forests).
 *
 * The NEW version works from `colorTargets`, which already encodes:
 *   - role (main / secondary / splash)
 *   - targetSources: how many effective sources this color needs
 *   - maxBasics: hard cap on basic lands for this color (splashes = 2)
 *
 * Algorithm:
 *   1. Fill fixing slots with dual lands, preferring those that serve the
 *      largest combined source deficit.  Count each dual as a source for
 *      each of its colors.
 *   2. Fill remaining basic slots using a deficit-aware greedy loop:
 *      always add a basic for the color with the largest positive
 *      (targetSources − currentSources) that has not yet hit maxBasics.
 *   3. If all targets are satisfied but slots remain, distribute extras to
 *      main colors proportionally (overflow safety net).
 */
function pickManaBaseLands(
  allCards: CardRecord[],
  colorTargets: ColorRoleTarget[],
  colors: ManaColor[],
  count: number,
  seedLands: DeckEntry[],
  format?: GenerateOptions["format"]
): DeckEntry[] {
  if (count <= 0) return [];

  // Fall back to simple even split when there is no role information or only
  // one color — this keeps mono-color and colorless decks working.
  if (colorTargets.length === 0 || colors.length < 2) {
    return pickBasicLands(allCards, colors, count);
  }

  const entries: DeckEntry[] = [];
  const existingByOracle = new Map(seedLands.map((e) => [e.card.oracleId, e.quantity]));

  // Build initial current-sources map from seed lands.
  const currentSources: Record<string, number> = {};
  for (const t of colorTargets) currentSources[t.color] = 0;
  for (const sl of seedLands) {
    try {
      const ci = JSON.parse(sl.card.colorIdentityJson) as ManaColor[];
      for (const c of ci) {
        if (c in currentSources) currentSources[c] = (currentSources[c] ?? 0) + sl.quantity;
      }
    } catch { /* ignore */ }
  }

  // Build per-color target and cap maps.
  const targetMap: Record<string, number> = {};
  const maxBasicsMap: Record<string, number> = {};
  for (const t of colorTargets) {
    targetMap[t.color] = t.targetSources;
    maxBasicsMap[t.color] = t.maxBasics;
  }

  // ── Step 1: dual / fixing lands ────────────────────────────────────────
  // Allocate roughly 60 % of remaining slots to fixing (same rough split as
  // before), but later we can recover any wasted fixing slots into basics.
  const seedLandTotal = seedLands.reduce((sum, e) => sum + e.quantity, 0);
  const totalLandTarget = seedLandTotal + count;
  const fixingSlots = Math.max(0, count - recommendedBasicLandReserve(colors, totalLandTarget));
  let remainingFixing = fixingSlots;

  for (const suggestion of recommendDualLands(allCards, colors, fixingSlots, format)) {
    if (remainingFixing <= 0) break;
    const already = existingByOracle.get(suggestion.card.oracleId) ?? 0;
    const available = Math.max(0, maxCopiesForCard(suggestion.card, format) - already);

    // Greedy cap: don't add a dual if it would push BOTH of its colors past
    // their target (i.e. it's useless for source coverage).
    let ci: ManaColor[] = [];
    try { ci = JSON.parse(suggestion.card.colorIdentityJson) as ManaColor[]; } catch { /* ignore */ }
    const wouldHelp = ci.some((c) => (currentSources[c] ?? 0) < (targetMap[c] ?? 0));
    if (!wouldHelp) continue;

    const qty = Math.min(remainingFixing, suggestion.quantity, available);
    if (qty <= 0) continue;
    entries.push({ card: suggestion.card, quantity: qty, board: "main" });
    remainingFixing -= qty;
    // Update current sources for each color the dual produces.
    for (const c of ci) {
      if (c in currentSources) currentSources[c] = (currentSources[c] ?? 0) + qty;
    }
  }

  // ── Step 2: basics via deficit-aware greedy loop ───────────────────────
  const usedFixing = fixingSlots - remainingFixing;
  const basicSlotsAvailable = count - usedFixing;

  const basicCounts: Record<string, number> = {};
  for (const t of colorTargets) basicCounts[t.color] = 0;

  let slotsLeft = basicSlotsAvailable;

  // First pass: fill deficits up to target, respecting maxBasics cap.
  while (slotsLeft > 0) {
    // Find the color with the largest positive deficit that still has basic headroom.
    let bestColor: ManaColor | null = null;
    let bestDeficit = 0;
    for (const t of colorTargets) {
      const deficit = (targetMap[t.color] ?? 0) - (currentSources[t.color] ?? 0);
      const basicsUsed = basicCounts[t.color] ?? 0;
      const basicsAllowed = maxBasicsMap[t.color] ?? 999;
      if (deficit > bestDeficit && basicsUsed < basicsAllowed) {
        bestDeficit = deficit;
        bestColor = t.color as ManaColor;
      }
    }
    if (!bestColor) break; // all deficits satisfied (or capped), move to overflow pass
    basicCounts[bestColor] = (basicCounts[bestColor] ?? 0) + 1;
    currentSources[bestColor] = (currentSources[bestColor] ?? 0) + 1;
    slotsLeft--;
  }

  // Second pass (overflow): remaining basic slots go to main/secondary colors only.
  // IMPORTANT: only consider colors that classifyColorRoles found pip demand for
  // (i.e. colors present in colorTargets).  Colors that slipped into effectiveColors
  // via color-identity merging but have ZERO pips must never receive basic lands.
  if (slotsLeft > 0) {
    // Use a string-level set so ManaColor and Color types compare correctly.
    const knownColorStrings = new Set<string>(colorTargets.map((t) => String(t.color)));
    const mainColors = colorTargets
      .filter((t) => t.role === "main" || t.role === "secondary")
      .map((t) => t.color as ManaColor);
    // fallback: only pip-bearing colors, never zero-pip stragglers
    const fallbackColors = mainColors.length > 0
      ? mainColors
      : colors.filter((c) => knownColorStrings.has(c));
    while (slotsLeft > 0 && fallbackColors.length > 0) {
      let bestColor: ManaColor = fallbackColors[0];
      let bestVal = Infinity;
      for (const c of fallbackColors) {
        const v = basicCounts[c] ?? 0;
        if (v < bestVal) { bestVal = v; bestColor = c; }
      }
      basicCounts[bestColor] = (basicCounts[bestColor] ?? 0) + 1;
      slotsLeft--;
    }
  }

  // Convert basicCounts map → DeckEntry list.
  const basicOut = new Map<string, DeckEntry>();
  for (const [colorStr, qty] of Object.entries(basicCounts)) {
    if (qty <= 0) continue;
    const color = colorStr as ManaColor;
    if (!(color in BASIC_BY_COLOR)) continue;
    const name = BASIC_BY_COLOR[color];
    const land = allCards
      .filter((c) => c.name === name && c.typeLine.includes("Basic"))
      .sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0))[0]
      ?? resolveBasicLand(allCards, name);
    const existing = basicOut.get(land.oracleId);
    if (existing) existing.quantity += qty;
    else basicOut.set(land.oracleId, { card: land, quantity: qty, board: "main" });
  }
  entries.push(...basicOut.values());

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
    ...(options.themes ?? []),
    ...keywordFocusToAxes(options.keywordFocus ?? []),
    ...inferPrimaryAxes(seedProfiles),
  ]).slice(0, 4);
}

function archetypeAxes(archetype: GenerateOptions["archetype"]): MechanicAxis[] {
  switch (archetype) {
    case "Aggro":    return ["counters"];
    case "Midrange": return ["etb", "draw"];
    case "Control":  return ["draw"];
    case "Tempo":    return ["spellslinger", "etb"];
    case "Combo":    return ["draw", "spellslinger"];
    case "Ramp":     return ["draw"];
    case "Prison":   return ["stax"];
    case "Unknown":  return [];
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

export function enforceLandFloor(
  entries: DeckEntry[],
  landFloor: number,
  colors: ManaColor[],
  allCards: CardRecord[],
  lockedIds: Set<string>,
  targetMainboardSize: number,
  reasoning: string[]
): void {
  /* STRICT land floor — no tolerance. Every deck MUST have at least
   * ABSOLUTE_MINIMUM_LANDS or landFloor (whichever is higher). Synthetic
   * basic land fallback (resolveBasicLand) guarantees we can always add
   * lands even when the real Scryfall database is missing them. */
  const requiredLands = Math.max(ABSOLUTE_MINIMUM_LANDS, landFloor);
  let landCount = countMainLands(entries);
  if (landCount >= requiredLands) return;

  const needed = requiredLands - landCount;
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

  // Step 2: add basics up to requiredLands (or until mainboard hits target).
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
    reasoning.push(`Land-floor guard: padded ${landCount - before} basic land(s) to reach required ${requiredLands} (was ${before})`);
  } else if (landCount < requiredLands) {
    reasoning.push(`ERROR: deck has ${landCount} land(s), required ${requiredLands} minimum. This should not happen — the synthetic basic land fallback guarantees lands are always available.`);
  }
}

function pickBasicLandsAdditive(
  allCards: CardRecord[],
  colors: ManaColor[],
  count: number,
  existing: DeckEntry[]
): DeckEntry[] {
  if (count <= 0) return [];

  // Derive color role targets from the current deck so that the land-floor
  // enforcement never over-populates splash colors the same way the old
  // symmetric equaliser did.
  const nonlandsForTargets = existing.filter((e) => !e.card.typeLine.includes("Land"));
  const colorRecs = recommendColorSources(nonlandsForTargets, count);
  const roleTargets = classifyColorRoles(colorRecs, nonlandsForTargets, 60); // 60-card proxy; ratio is what matters

  // Build current-sources map from ALL existing lands (basic + nonbasic).
  const currentSources: Record<string, number> = {};
  for (const c of colors) currentSources[c] = 0;
  for (const e of existing) {
    if (!e.card.typeLine.includes("Land")) continue;
    try {
      const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
      for (const c of ci) {
        if (c in currentSources) currentSources[c] = (currentSources[c] ?? 0) + e.quantity;
      }
    } catch { /* ignore */ }
  }

  // If we have role data, use deficit-aware greedy selection with splash caps.
  if (roleTargets.length > 0) {
    const targetMap: Record<string, number> = {};
    const maxBasicsMap: Record<string, number> = {};
    for (const t of roleTargets) {
      targetMap[t.color] = t.targetSources;
      maxBasicsMap[t.color] = t.maxBasics;
    }
    // Count existing basics per color (not just land sources) to enforce maxBasics cap.
    const existingBasicsByColor: Record<string, number> = {};
    for (const c of colors) existingBasicsByColor[c] = 0;
    for (const e of existing) {
      if (!e.card.typeLine.includes("Land")) continue;
      if (!BASIC_LAND_NAMES.has(e.card.name)) continue;
      try {
        const ci = JSON.parse(e.card.colorIdentityJson) as ManaColor[];
        for (const c of ci) {
          if (c in existingBasicsByColor)
            existingBasicsByColor[c] = (existingBasicsByColor[c] ?? 0) + e.quantity;
        }
      } catch { /* ignore */ }
    }

    const basicCounts: Record<string, number> = {};
    for (const c of colors) basicCounts[c] = 0;
    let slotsLeft = count;

    // First pass: honour deficits, capped by maxBasics.
    while (slotsLeft > 0) {
      let bestColor: ManaColor | null = null;
      let bestDeficit = 0;
      for (const c of colors) {
        const deficit = (targetMap[c] ?? 0) - (currentSources[c] ?? 0);
        const basicsUsed = (existingBasicsByColor[c] ?? 0) + (basicCounts[c] ?? 0);
        const basicsAllowed = maxBasicsMap[c] ?? 999;
        if (deficit > bestDeficit && basicsUsed < basicsAllowed) {
          bestDeficit = deficit;
          bestColor = c;
        }
      }
      if (!bestColor) break;
      basicCounts[bestColor] = (basicCounts[bestColor] ?? 0) + 1;
      currentSources[bestColor] = (currentSources[bestColor] ?? 0) + 1;
      slotsLeft--;
    }

    // Second pass (overflow): round-robin across non-splash colors only.
    if (slotsLeft > 0) {
      const mainColors = roleTargets
        .filter((t) => t.role !== "splash")
        .map((t) => t.color as ManaColor)
        .filter((c) => colors.includes(c));
      const fallbackColors = mainColors.length > 0 ? mainColors : colors;
      while (slotsLeft > 0 && fallbackColors.length > 0) {
        let bestColor: ManaColor = fallbackColors[0];
        let bestVal = Infinity;
        for (const c of fallbackColors) {
          const v = basicCounts[c] ?? 0;
          if (v < bestVal) { bestVal = v; bestColor = c; }
        }
        basicCounts[bestColor] = (basicCounts[bestColor] ?? 0) + 1;
        slotsLeft--;
      }
    }

    const out = new Map<string, DeckEntry>();
    for (const [colorStr, qty] of Object.entries(basicCounts)) {
      if (qty <= 0) continue;
      const color = colorStr as ManaColor;
      if (!(color in BASIC_BY_COLOR)) continue;
      const name = BASIC_BY_COLOR[color];
      const land = allCards
        .filter((c) => c.name === name && c.typeLine.includes("Basic"))
        .sort((a, b) => (a.priceUsd ?? 0) - (b.priceUsd ?? 0))[0]
        ?? resolveBasicLand(allCards, name);
      const ex = out.get(land.oracleId);
      if (ex) ex.quantity += qty;
      else out.set(land.oracleId, { card: land, quantity: qty, board: "main" });
    }
    return [...out.values()];
  }

  // Fallback (no role data — colorless or mono-color): original symmetric equaliser.
  const haveByColor: Record<string, number> = { W: 0, U: 0, B: 0, R: 0, G: 0 };
  for (const [c, v] of Object.entries(currentSources)) haveByColor[c] = v;
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