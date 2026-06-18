import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import { BASIC_LAND_NAMES, maxCopiesForCard, validateDeck } from "../legality";
import { getCardLegality, getFormatRules } from "../formats";
import { assignRoles } from "../roles";
import { buildPool } from "../generator/pool";
import { generateDeck as generateOffline } from "../generator/generator";
import { buildScoreBreakdown, cardScoreDetail, deckScore, targetAvgCmcFor } from "../generator/weights";
import { blendRoleTargets } from "../generator/roleTargets";
import { buildSynergyProfile, generateCardReasons, generateTribalReasons, keywordFocusToAxes } from "../generator/synergyModel";
import { analyzeSeeds, formatSeedSummaryForPrompt } from "../analysis/seedAnalyzer";
import { buildSeedSynergyGraph, formatSynergyGraphForPrompt } from "../analysis/synergyGraph";
import type {
  GenerateOptions,
  GenerateResult,
  GenerationDiagnostic,
} from "../generator/types";
import { enforceLandFloor } from "../generator/generator";
import { recommendLandCount } from "../manaBase";
import type { ManaColor } from "../types";
import { resolveLines } from "./resolver";
import type { AIProvider, AIChatMessage as ChatMessage } from "./provider";


export const DEFAULT_DIGEST_LIMIT = 220;
export const DEFAULT_AI_TEMPERATURE = 0.4;
const DEFAULT_LAND_DIGEST_LIMIT = 30;
const DEFAULT_AI_MAX_TOKENS = 8000;
const LOCAL_PROVIDER_DIGEST_WARNING_LIMIT = 300;

export interface AIPrompts {
  system: string;
  user: string;
  poolSize: number;
}

export interface AIGenerateConfig {
  temperature?: number;
  digestLimit?: number;
  signal?: AbortSignal;
  timeoutMs?: number;
  onToken?: (chunk: string) => void;
  onRaw?: (raw: string) => void;
  /** Called at the start of every iteration (1-indexed) so the UI can reset its streaming buffer. */
  onPassStart?: (pass: number, totalPasses: number) => void;
}

/**
 * Conversation transcript carried across chat refinements so the LLM keeps
 * context (initial system+user prompt + every prior deck JSON + every user
 * comment). Returned alongside the result so the UI can store it.
 */
export interface AIChatTranscript {
  messages: ChatMessage[];
}


// ────────────────────────────────────────────────────────────────────────────
// Pool analysis + weighted digest
// ────────────────────────────────────────────────────────────────────────────

interface ScoredCard {
  card: CardRecord;
  score: number;
  detail: ReturnType<typeof cardScoreDetail>;
  fromDeck?: boolean;
}

function scoreNonlandPool(
  options: GenerateOptions,
  allCards: CardRecord[],
  digestLimit: number,
  deckOracleIds?: Set<string>
): { scored: ScoredCard[]; lands: CardRecord[]; targetAvgCmc: number; fullPoolSize: number } {
  const fullPool = buildPool(allCards, options);
  const nonland = fullPool.filter((c) => !c.typeLine.includes("Land"));
  const lands = fullPool.filter(
    (c) => c.typeLine.includes("Land") && !BASIC_LAND_NAMES.has(c.name)
  );
  const target = blendRoleTargets(options.archetype, options.secondaryArchetypes);
  const targetAvgCmc = targetAvgCmcFor(options, target.maxAvgCmc);
  const seedEntries = options.seedEntries ?? [];
  const scored: ScoredCard[] = nonland
    .map((card) => {
      const detail = cardScoreDetail(card, seedEntries, options, targetAvgCmc);
      return { card, score: detail.total, detail, fromDeck: deckOracleIds?.has(card.oracleId) ?? false };
    })
    .sort((a, b) => b.score - a.score)
    .slice(0, digestLimit);
  return { scored, lands, targetAvgCmc, fullPoolSize: fullPool.length };
}

function digestScoredCard(s: ScoredCard): string {
  const roles = assignRoles(s.card).join(",") || "—";
  const oracle = (s.card.oracleText ?? "").replace(/\s+/g, " ").trim().slice(0, 120);
  const price = s.card.priceUsd != null ? `$${s.card.priceUsd.toFixed(2)}` : "—";
  const cost = s.card.manaCost ?? "—";
  const synergyTotal = s.detail.synergyContribution + s.detail.directionalContribution + s.detail.compositionBonus;
  const penalties = s.detail.cmcPenalty + s.detail.pricePenalty;
  const signalTags = scoreSignalTags(s.detail);
  const scoreBreakdown = [
    `total=${s.score.toFixed(1)}`,
    `power=${s.detail.rolePowerContribution.toFixed(1)}`,
    `syn=${synergyTotal.toFixed(1)}`,
    `role=${s.detail.signalContribution.toFixed(1)}`,
    `utility=${(s.detail.efficiencyContribution + s.detail.flexibilityContribution + s.detail.ladderContribution).toFixed(1)}`,
    penalties > 0 ? `pen=-${penalties.toFixed(1)}` : "pen=0.0",
    `mult=${s.detail.synergyMultiplier.toFixed(2)}`,
    signalTags.length ? `tags=${signalTags.join("+")}` : "tags=raw",
  ].join(",");
  return `${s.card.name} | ${cost} CMC${s.card.cmc} | ${s.card.typeLine} | [${roles}] | score(${scoreBreakdown}) | "${oracle}" | ${price}`;
}

function scoreSignalTags(detail: ReturnType<typeof cardScoreDetail>): string[] {
  const tags: string[] = [];
  const synergyTotal = detail.synergyContribution + detail.directionalContribution + detail.compositionBonus;
  if (detail.synergyMultiplier >= 1.22) tags.push("syn-dense");
  else if (synergyTotal >= 12) tags.push("syn-ready");
  if (detail.compositionBonus > 0) tags.push("composition");
  if (detail.rolePowerContribution >= 35 && synergyTotal < 10) tags.push("raw-power");
  if (detail.focusCardBonus > 0 || detail.preferCardBonus > 0) tags.push("user-context");
  return tags;
}

function digestLand(card: CardRecord): string {
  const oracle = (card.oracleText ?? "").replace(/\s+/g, " ").trim().slice(0, 100);
  return `${card.name} | ${card.typeLine} | "${oracle}"`;
}

function summarizeDeckEntries(entries: DeckEntry[], label: string, poolIds: Set<string>): string {
  const inPool = entries.filter((entry) => poolIds.has(entry.card.oracleId));
  if (inPool.length === 0) return "";
  const total = inPool.reduce((sum, entry) => sum + entry.quantity, 0);
  const examples = inPool
    .slice(0, 6)
    .map((e) => `${e.quantity}x ${e.card.name}`)
    .join("; ");
  const suffix = inPool.length > 6 ? `; +${inPool.length - 6} more` : "";
  const dropped = entries.length - inPool.length;
  const droppedText = dropped > 0 ? `; omitted ${dropped} out-of-pool card${dropped === 1 ? "" : "s"}` : "";
  return `${label}: ${inPool.length} unique / ${total} copies (${examples}${suffix}${droppedText})`;
}

function dedupeCardsByOracle(cards: CardRecord[]): CardRecord[] {
  const seen = new Set<string>();
  const out: CardRecord[] = [];
  for (const card of cards) {
    if (seen.has(card.oracleId)) continue;
    seen.add(card.oracleId);
    out.push(card);
  }
  return out;
}

/** Build the exact system+user messages that will be sent to the AI provider. */
export function buildAIPrompts(
  options: GenerateOptions,
  allCards: CardRecord[],
  digestLimit: number = DEFAULT_DIGEST_LIMIT
): AIPrompts {
  const targetMainboardSize = normalizedMainboardSize(options);
  const targetNonlandMin = Math.max(1, Math.floor(targetMainboardSize * 0.55));
  const targetNonlandMax = Math.max(targetNonlandMin, Math.ceil(targetMainboardSize * 0.65));
  const formatRules = getFormatRules(options.format);

  // Collect oracleIds from all deck-related entries so scoreNonlandPool can tag them.
  const deckOracleIds = new Set<string>();
  for (const entries of [options.seedEntries ?? [], options.focusEntries ?? [], options.preferEntries ?? []]) {
    for (const entry of entries) deckOracleIds.add(entry.card.oracleId);
  }

  const { scored, lands, fullPoolSize } = scoreNonlandPool(options, allCards, digestLimit, deckOracleIds);
  const fullPoolIds = new Set(buildPool(allCards, options).map((card) => card.oracleId));

  // Separate scored cards into deck cards (user's current picks) and pool candidates.
  const deckCards = scored.filter((s) => s.fromDeck);
  const poolCards = scored.filter((s) => !s.fromDeck);

  // Reserve up to 60% of digestLimit for deck cards, ensuring all user-chosen cards
  // appear in the prompt if possible. Fill remaining slots with top pool candidates.
  const DECK_SLOT_MAX = Math.max(1, Math.floor(digestLimit * 0.6));
  const deckCardsInDigest = deckCards.slice(0, DECK_SLOT_MAX);
  const remainingSlots = Math.max(0, digestLimit - deckCardsInDigest.length);
  const poolCardsInDigest = poolCards.slice(0, remainingSlots);

  // Build the section-labeled digest text.
  const digestParts: string[] = [];
  if (deckCardsInDigest.length > 0) {
    digestParts.push(
      "=== YOUR DECK (cards from your current build — strongly consider keeping these) ===",
      ...deckCardsInDigest.map(digestScoredCard),
      ""
    );
  }
  if (poolCardsInDigest.length > 0) {
    digestParts.push(
      "=== CANDIDATES (highest-scoring pool cards for filling remaining slots) ===",
      ...poolCardsInDigest.map(digestScoredCard),
      ""
    );
  }
  const nonlandDigest = digestParts.join("\n");

  const landDigest = lands.slice(0, DEFAULT_LAND_DIGEST_LIMIT).map(digestLand).join("\n");

  const seedList = summarizeDeckEntries(options.seedEntries ?? [], "Current locked/seed deck context", fullPoolIds);
  const focusList = summarizeDeckEntries(options.focusEntries ?? [], "Current synergy core / build-around context", fullPoolIds);
  const preferList = summarizeDeckEntries(options.preferEntries ?? [], "Current preferred deck context", fullPoolIds);
  const intentSeeds = [
    ...(options.focusEntries ?? []),
    ...(options.seedEntries ?? []),
    ...(options.preferEntries ?? []),
  ].map((entry) => entry.card);
  const uniqueIntentSeeds = dedupeCardsByOracle(intentSeeds);
  const seedSummary = analyzeSeeds(uniqueIntentSeeds);
  const seedGraph = buildSeedSynergyGraph(uniqueIntentSeeds);
  const seedIntentBlock = intentSeeds.length > 0
    ? [formatSeedSummaryForPrompt(seedSummary), "", formatSynergyGraphForPrompt(seedGraph)].join("\n")
    : "";
  const userContext = options.userContext?.trim();

  const isRedefine = options.aiPicksAsFinal === true;
  const system = [
    `You are an expert MTG ${formatRules.label} deckbuilder.`,
    `Build ONLY the NONLAND core for a tournament-viable ${targetMainboardSize}-card mainboard${formatRules.sideboardSize ? ` (${formatRules.sideboardSize}-card sideboard if requested)` : ""} using cards from the provided pool.`,
    `IMPORTANT: do NOT return a full ${targetMainboardSize}-card mainboard. An offline mana-base builder will add lands automatically. Return ${targetNonlandMin}-${targetNonlandMax} mainboard nonland cards (spells/creatures/planeswalkers/etc). Do NOT pad with basics or utility lands in main — leave all land slots for the offline builder.`,
    `HARD CAP: main[] quantities must sum to AT MOST ${targetNonlandMax} nonland copies. Anything beyond that will be trimmed automatically (highest mana value first), so exceeding the cap only damages your own curve.`,
    "Seed cards are evidence of user intent, not necessarily mandatory deck slots. Infer the plan from seed intent analysis, then build the most competitive version of that plan. If a seed is off-plan or too weak, mention the tension in summary/game_plan and let the offline optimizer replace it if needed.",
    "When seed intent confidence is low, choose the most coherent competitive interpretation and explain the ambiguity briefly in `summary`.",
    "Each candidate has `score(total=...,power=...,syn=...,role=...,utility=...,pen=...,mult=...,tags=...)` from the offline engine. Treat `syn`, `mult`, and tags like `syn-dense`/`composition` as evidence that the card connects to the current deck; do not blindly pick raw-power cards over synergistic engine pieces.",
    "Do NOT invent or include cards that are not in the pool — that includes lands. Use ONLY the listed nonbasic lands when adding any utility land.",
    "Respond with strict JSON ONLY (no prose, no markdown fences) with this exact shape:",
    "{\"summary\":string, \"game_plan\":string, \"main\":[{\"name\":string,\"qty\":number,\"reason\":string}], \"side\":[{\"name\":string,\"qty\":number,\"reason\":string}]}.",
    "`summary` is 2–4 sentences describing the deck's overall identity and key synergies.",
    "`game_plan` is 2–4 sentences covering early/mid/late game and how the deck wins.",
    "Every card MUST include a short (≤ 20 words) `reason` explaining why it was chosen and at what quantity — cite roles (threat, removal, ramp, draw, finisher, sideboard answer) and synergies.",
    `Quantities must be integers. Non-basic cards are capped at ${formatRules.maxCopies} ${formatRules.maxCopies === 1 ? "copy" : "copies"} in ${formatRules.label} unless their text says 'A deck can have any number of cards named' (e.g. Rat Colony, Dragon's Approach).`,
    "Use exact card names as listed in the pool.",
    ...(isRedefine
      ? ["YOU HAVE FULL DECK-BUILDING AUTHORITY. You are rebuilding the deck from scratch. The current deck is being ignored — pick the best cards for a cohesive, competitive build. Your nonland picks will be locked into the final deck (quantities may be adjusted for balance). The offline pipeline only adds lands around your choices."]
      : ["Your nonland picks will be treated as soft preferences — the offline optimizer may swap weaker ones for higher-scoring alternatives."]),
  ].join(" ");

  const user = [
    `Archetype: ${options.archetype}`,
    `Format: ${formatRules.label}`,
    options.playEnvironment ? `Environment: ${options.playEnvironment}` : "",
    `Final mainboard size after offline lands: exactly ${targetMainboardSize} cards`,
    `Your JSON main[] target: ${targetNonlandMin}-${targetNonlandMax} nonland cards only (hard cap: ${targetNonlandMax} total copies)`,
    options.secondaryArchetypes?.length ? `Secondary archetypes: ${options.secondaryArchetypes.join(", ")}` : "",
    `Colors: ${options.colors.join("") || "(colorless)"}`,
    options.speed ? `Speed: ${options.speed}` : "",
    options.spellRatio ? `Spell ratio: ${options.spellRatio}` : "",
    options.keywordFocus?.length ? `Keyword focus: ${options.keywordFocus.join(", ")}` : "",
    options.tribalSupport?.tribe ? `Tribal support: ${options.tribalSupport.tribe} (${options.tribalSupport.mode})` : "",
    options.totalBudgetUsd ? `Total budget: $${options.totalBudgetUsd}` : "",
    options.maxCardPriceUsd ? `Max card price: $${options.maxCardPriceUsd}` : "",
    options.generateSideboard ? "Include a 15-card sideboard." : "Mainboard only (no sideboard).",
    seedList ? `${seedList}. Strongly consider keeping this structure, but improve weak/off-plan cards when needed.` : "",
    focusList ? `${focusList}. Treat these as a starting synergy core, not a literal shopping list.` : "",
    preferList ? `${preferList}. Prefer preserving important support pieces and mana rocks unless clearly off-plan.` : "",
    seedIntentBlock,
    userContext ? `User context / instructions: ${userContext}` : "",
    "",
    `Candidate pool (${deckCardsInDigest.length} deck + ${poolCardsInDigest.length} candidates = ${deckCardsInDigest.length + poolCardsInDigest.length} of ${fullPoolSize} pre-scored by offline engine):`,
    "name | mana_cost CMC | type | [roles] | score(total,power,syn,role,utility,pen,mult,tags) | \"oracle\" | price",
    nonlandDigest,
    "",
    `Nonbasic land options for reference only (${lands.slice(0, DEFAULT_LAND_DIGEST_LIMIT).length} of ${lands.length} legal lands; do not include these in main[]):`,
    landDigest || "(none — use basic lands only)",
  ]
    .filter(Boolean)
    .join("\n");

  return { system, user, poolSize: scored.length };
}

// ────────────────────────────────────────────────────────────────────────────
// Iteration loop
// ────────────────────────────────────────────────────────────────────────────

/**
 * AI-feed generator with optional auto-refine iterations. Each pass:
 *  1. Send prompt (initial or refinement) to the LLM.
 *  2. Parse / salvage the JSON response.
 *  3. Treat the AI's mainboard as soft preferences and run the offline scoring
 *     pipeline (mana base, role gap-fill, optimizer) on top.
 * Best-scoring iteration is returned. Multi-iteration runs feed each prior
 * deck's score breakdown and lowest contributors back to the LLM and ask for
 * swaps that raise the final score.
 */
export async function generateDeckAI(
  options: GenerateOptions,
  allCards: CardRecord[],
  provider: AIProvider,
  config: AIGenerateConfig = {}
): Promise<GenerateResult & { transcript?: AIChatTranscript }> {
  const targetMainboardSize = normalizedMainboardSize(options);
  const formatRules = getFormatRules(options.format);
  const digestLimit = config.digestLimit ?? DEFAULT_DIGEST_LIMIT;
  const temperature = config.temperature ?? DEFAULT_AI_TEMPERATURE;
  const iterations = Math.max(1, Math.min(4, options.aiIterations ?? 1));

  const reasoning: string[] = [
    `Engine: AI feed (${provider.label})`,
    `Format: ${formatRules.label}${options.playEnvironment ? ` (${options.playEnvironment.toUpperCase()})` : ""}`,
    `Deck size target: ${targetMainboardSize} mainboard cards`,
    `Auto-refine iterations: ${iterations}`,
  ];

  const { system, user, poolSize } = buildAIPrompts(options, allCards, digestLimit);
  reasoning.push(`Sent weighted digest of top ${poolSize} candidate cards (digest=${digestLimit}, temp=${temperature})`);
  if (isLocalProvider(provider.id) && digestLimit > LOCAL_PROVIDER_DIGEST_WARNING_LIMIT) {
    reasoning.push(
      `Warning: digest=${digestLimit} is large for local models and may exceed LM Studio/llama.cpp context or stream limits; if the AI aborts, retry with digest 100–250.`
    );
  }

  let best: GenerateResult | undefined;
  let lastRawJSON: string | undefined;
  const messages: ChatMessage[] = [
    { role: "system", content: system },
    { role: "user", content: user },
  ];

  for (let i = 0; i < iterations; i++) {
    const passLabel = `Pass ${i + 1}/${iterations}`;
    reasoning.push(`— ${passLabel} —`);
    config.onPassStart?.(i + 1, iterations);
    let raw: string;
    try {
      const req = { messages: [...messages], temperature, maxTokens: DEFAULT_AI_MAX_TOKENS, signal: config.signal, timeoutMs: config.timeoutMs };
      if (provider.generateStream && config.onToken) {
        raw = await provider.generateStream(req, config.onToken);
      } else {
        raw = await provider.generate(req);
      }
      if (i === iterations - 1) config.onRaw?.(raw);
    } catch (e) {
      reasoning.push(`${passLabel}: AI call failed (${e instanceof Error ? e.message : String(e)}).`);
      break;
    }

    const passReasoning: string[] = [];
    const result = buildResultFromAIResponse(options, allCards, raw, passReasoning, targetMainboardSize);
    if (!result) {
      reasoning.push(`${passLabel}: no usable cards parsed; keeping previous best.`);
      continue;
    }
    for (const line of passReasoning) reasoning.push(`  ${line}`);
    reasoning.push(`${passLabel}: final score ${result.diagnostics.deckScore.toFixed(1)} (mana ${(result.diagnostics.manaBaseCoverage * 100).toFixed(0)}%, curve dev ${result.diagnostics.curveDeviation.toFixed(2)})`);

    lastRawJSON = stripCodeFences(raw);
    if (!best || result.diagnostics.deckScore > best.diagnostics.deckScore) {
      best = result;
      reasoning.push(`${passLabel}: new best deck (Δ score ${best === result ? "—" : "+"}).`);
    } else {
      reasoning.push(`${passLabel}: did not beat best (${best.diagnostics.deckScore.toFixed(1)}).`);
    }

    // Set up refinement prompt for next pass (if any).
    if (i < iterations - 1 && best) {
      const feedback = buildRefinementPrompt(best, targetMainboardSize);
      messages.push({ role: "assistant", content: lastRawJSON });
      messages.push({ role: "user", content: feedback });
    }
  }

  if (!best) {
    reasoning.push("All AI passes failed; falling back to offline engine.");
    const fallback = generateOffline(options, allCards);
    fallback.diagnostics.reasoning = [...reasoning, "—", ...fallback.diagnostics.reasoning];
    return fallback;
  }

  best.diagnostics.reasoning = [...reasoning, "— Best iteration retained —", ...best.diagnostics.reasoning];

  // Attach final transcript: include the latest assistant JSON response so the
  // user can chat further with full context.
  const finalMessages: ChatMessage[] = [...messages];
  if (lastRawJSON) finalMessages.push({ role: "assistant", content: lastRawJSON });
  (best as GenerateResult & { transcript?: AIChatTranscript }).transcript = { messages: finalMessages };
  return best;
}

// ────────────────────────────────────────────────────────────────────────────
// Sequential seed-chain generation
// ────────────────────────────────────────────────────────────────────────────

/**
 * Sequential seed-chain AI generation.
 *
 * When the user provides a seed set and selects sequential mode the deck is
 * built incrementally rather than in one shot:
 *
 *  Step 0  – The AI sees the full scored candidate pool + the initial seed
 *            cards and proposes the next `stepSize` nonland additions.
 *  Step N  – The newly confirmed cards are merged into `seedEntries`, the pool
 *            is re-scored against the growing deck, and the AI proposes the
 *            next batch.  This repeats until the nonland budget is satisfied.
 *
 * After every step the accepted picks are run through the offline pipeline
 * (same as the normal AI path) so mana-base coverage and role gaps are visible
 * to the LLM in the subsequent refinement prompt.
 *
 * The final step passes the completed nonland spine back through the normal
 * buildResultFromAIResponse → offline pipeline exactly as generateDeckAI does,
 * so the returned GenerateResult is identical in shape.
 */
export async function generateDeckAISequential(
  options: GenerateOptions,
  allCards: CardRecord[],
  provider: AIProvider,
  config: AIGenerateConfig = {}
): Promise<GenerateResult & { transcript?: AIChatTranscript }> {
  // Resolve the step-size schedule from the option value.
  // A single number becomes a 1-element array; the last element repeats for any
  // steps beyond the schedule length.
  const rawStepSizes = options.aiSequentialStepSize;
  const stepSchedule: number[] = (
    Array.isArray(rawStepSizes)
      ? rawStepSizes.map((n) => Math.max(1, Math.min(20, Math.round(n))))
      : [Math.max(2, Math.min(10, (rawStepSizes as number | undefined) ?? 4))]
  ).filter((n) => n > 0);
  if (stepSchedule.length === 0) stepSchedule.push(4);

  /** Return the configured step size for a given 1-based step index. */
  const stepSizeAt = (step: number): number =>
    stepSchedule[Math.min(step - 1, stepSchedule.length - 1)];

  const scheduleLabel =
    stepSchedule.length === 1
      ? `uniform ${stepSchedule[0]}`
      : `[${stepSchedule.join(", ")}] (last repeats)`;

  const targetMainboardSize = normalizedMainboardSize(options);
  const formatRules = getFormatRules(options.format);
  const digestLimit = config.digestLimit ?? DEFAULT_DIGEST_LIMIT;
  const temperature = config.temperature ?? DEFAULT_AI_TEMPERATURE;

  // Nonland budget: 60 % of the mainboard (midpoint of the 55–65 % heuristic).
  const nonlandBudget = Math.round(targetMainboardSize * 0.60);

  // Running seed list — starts with the user's explicit seeds and grows each step.
  let currentSeeds: DeckEntry[] = [...(options.seedEntries ?? [])];

  const reasoning: string[] = [
    `Engine: AI sequential seed-chain (${provider.label})`,
    `Format: ${formatRules.label}`,
    `Deck size target: ${targetMainboardSize} mainboard cards`,
    `Nonland budget: ${nonlandBudget} | Step schedule: ${scheduleLabel}`,
    `Initial seeds: ${currentSeeds.length} card(s)`,
  ];

  const messages: ChatMessage[] = [];
  let stepIndex = 0;
  let lastRawJSON: string | undefined;

  const seedNonlandCopies = () =>
    currentSeeds
      .filter((e) => e.board !== "side" && !e.card.typeLine.includes("Land"))
      .reduce((s, e) => s + e.quantity, 0);

  while (seedNonlandCopies() < nonlandBudget) {
    const remaining = nonlandBudget - seedNonlandCopies();
    stepIndex++;
    const thisStepSize = stepSizeAt(stepIndex);
    const thisStepTarget = Math.min(thisStepSize, remaining);
    // Estimate total steps using average of the schedule for the label (best-effort).
    const avgStepSize = stepSchedule.reduce((a, b) => a + b, 0) / stepSchedule.length;
    const totalSteps = Math.ceil(nonlandBudget / avgStepSize);
    const passLabel = `Step ${stepIndex}/${totalSteps}`;
    reasoning.push(`— ${passLabel} (locked ${seedNonlandCopies()}/${nonlandBudget} nonland, adding up to ${thisStepTarget} [schedule size: ${thisStepSize}]) —`);
    config.onPassStart?.(stepIndex, totalSteps);

    // Build a fresh prompt with the updated (growing) seed list.
    const stepOptions: GenerateOptions = { ...options, seedEntries: currentSeeds };
    const { system, user } = buildAIPrompts(stepOptions, allCards, digestLimit);

    if (stepIndex === 1) {
      messages.push({ role: "system", content: system });
      messages.push({
        role: "user",
        content: [
          user,
          ``,
          `SEQUENTIAL BUILD MODE — you are building this deck incrementally.`,
          `This is step ${stepIndex} of ~${totalSteps}.`,
          `Currently locked in the deck: ${seedNonlandCopies()} nonland copies (listed above as YOUR DECK).`,
          `For THIS step, propose EXACTLY ${thisStepTarget} new nonland copies (not already in the deck) that best synergise with the current spine.`,
          `Return only those ${thisStepTarget} cards in main[]. Omit all already-locked cards from main[] — they are confirmed and do not need re-listing.`,
          `Do NOT fill out a complete deck list. Only propose the next batch.`,
          `Return the same strict JSON shape (summary, game_plan, main, side) — no prose, no fences.`,
        ].filter(Boolean).join("\n"),
      });
    } else {
      const spineLines = currentSeeds
        .filter((e) => e.board !== "side" && !e.card.typeLine.includes("Land"))
        .map((e) => `${e.quantity}× ${e.card.name}`)
        .join("; ");
      messages.push({
        role: "user",
        content: [
          `Step ${stepIndex} of ~${totalSteps}.`,
          `Confirmed nonland spine so far (${seedNonlandCopies()} copies): ${spineLines || "(none yet)"}.`,
          `Re-scored candidate pool for this step:`,
          ``,
          user,
          ``,
          `SEQUENTIAL BUILD — propose EXACTLY ${thisStepTarget} NEW nonland copies not already in the confirmed spine.`,
          `Return only those ${thisStepTarget} cards in main[]. Do NOT re-list already-confirmed cards.`,
          `Return the same strict JSON shape (summary, game_plan, main, side) — no prose, no fences.`,
        ].filter(Boolean).join("\n"),
      });
    }

    let raw: string;
    try {
      const req = { messages: [...messages], temperature, maxTokens: DEFAULT_AI_MAX_TOKENS, signal: config.signal, timeoutMs: config.timeoutMs };
      if (provider.generateStream && config.onToken) {
        raw = await provider.generateStream(req, config.onToken);
      } else {
        raw = await provider.generate(req);
      }
    } catch (e) {
      reasoning.push(`${passLabel}: AI call failed (${e instanceof Error ? e.message : String(e)}); aborting chain.`);
      break;
    }

    lastRawJSON = stripCodeFences(raw);
    messages.push({ role: "assistant", content: lastRawJSON });

    let parsed: { summary?: string; game_plan?: string; main?: { name?: string; qty?: number; quantity?: number; reason?: string }[]; side?: { name?: string; qty?: number; quantity?: number; reason?: string }[] };
    try {
      parsed = JSON.parse(lastRawJSON);
    } catch {
      const salvaged = salvageDeckJSON(lastRawJSON);
      parsed = { main: salvaged.main, side: salvaged.side, summary: salvaged.summary, game_plan: salvaged.game_plan };
    }

    const proposedLines = (parsed.main ?? [])
      .map((m) => ({
        name: m.name ?? "",
        quantity: Math.max(1, Math.floor(Number(m.qty ?? m.quantity ?? 1))),
        board: "main" as const,
      }))
      .filter((l) => l.name);

    if (proposedLines.length === 0) {
      reasoning.push(`${passLabel}: AI returned no new cards; stopping chain early.`);
      break;
    }

    const { resolved, unresolved } = resolveLines(proposedLines, allCards);
    if (unresolved.length > 0) {
      reasoning.push(`${passLabel}: dropped ${unresolved.length} unresolved name(s): ${unresolved.slice(0, 4).map((u) => u.name).join(", ")}`);
    }

    const lockedIds = new Set(currentSeeds.map((e) => e.card.oracleId));
    const newEntries: DeckEntry[] = [];
    for (const r of resolved) {
      if (lockedIds.has(r.card.oracleId)) {
        reasoning.push(`${passLabel}: skipped already-locked card ${r.card.name}.`);
        continue;
      }
      const cap = maxCopiesForCard(r.card, options.format);
      newEntries.push({ card: r.card, quantity: Math.min(cap, r.quantity), board: "main" });
      lockedIds.add(r.card.oracleId);
    }

    if (newEntries.length === 0) {
      reasoning.push(`${passLabel}: all proposed cards already locked; stopping chain.`);
      break;
    }

    reasoning.push(`${passLabel}: accepted ${newEntries.length} new card(s): ${newEntries.map((e) => `${e.quantity}× ${e.card.name}`).join(", ")}`);
    currentSeeds = [...currentSeeds, ...newEntries];

    if (seedNonlandCopies() >= nonlandBudget) break;
  }

  reasoning.push(`— Sequential chain complete: ${seedNonlandCopies()} nonland copies locked. Running final offline pipeline. —`);
  config.onPassStart?.(stepIndex + 1, stepIndex + 1);

  if (lastRawJSON === undefined) {
    reasoning.push("Sequential chain produced no cards; falling back to offline engine.");
    const fallback = generateOffline(options, allCards);
    fallback.diagnostics.reasoning = [...reasoning, "—", ...fallback.diagnostics.reasoning];
    return fallback;
  }

  const fullSpineNonland = currentSeeds.filter(
    (e) => e.board !== "side" && !e.card.typeLine.includes("Land")
  );
  const syntheticJSON = JSON.stringify({
    summary: `Sequential seed-chain build (${stepIndex} step${stepIndex === 1 ? "" : "s"}, ${seedNonlandCopies()} nonland cards locked).`,
    game_plan: `Deck built incrementally step-by-step; each step re-scored the pool against the growing synergy spine.`,
    main: fullSpineNonland.map((e) => ({ name: e.card.name, qty: e.quantity, reason: "Locked by sequential seed chain." })),
    side: [],
  });

  const finalPassReasoning: string[] = [...reasoning];
  const finalOptions: GenerateOptions = {
    ...options,
    seedEntries: currentSeeds,
    aiPicksAsFinal: true,
  };
  const result = buildResultFromAIResponse(finalOptions, allCards, syntheticJSON, finalPassReasoning, targetMainboardSize);

  if (!result) {
    reasoning.push("Final pipeline pass failed; falling back to offline engine.");
    const fallback = generateOffline(options, allCards);
    fallback.diagnostics.reasoning = [...reasoning, "—", ...fallback.diagnostics.reasoning];
    return fallback;
  }

  result.diagnostics.reasoning = finalPassReasoning;

  const finalMessages: ChatMessage[] = [...messages];
  finalMessages.push({ role: "assistant", content: syntheticJSON });
  (result as GenerateResult & { transcript?: AIChatTranscript }).transcript = { messages: finalMessages };
  return result;
}


/**
 * Chat-based refinement: take an existing transcript + the user's free-form
 * feedback, send it to the LLM, and rebuild the deck (using the new picks as
 * nonland preferences for the offline manabase / optimizer pipeline). Returns
 * a new GenerateResult with an updated transcript.
 */
export async function refineDeckAI(
  options: GenerateOptions,
  allCards: CardRecord[],
  provider: AIProvider,
  transcript: AIChatTranscript,
  userMessage: string,
  config: AIGenerateConfig = {}
): Promise<GenerateResult & { transcript: AIChatTranscript }> {
  const targetMainboardSize = normalizedMainboardSize(options);
  const temperature = config.temperature ?? DEFAULT_AI_TEMPERATURE;

  const wrapped =
    `User feedback on the previous deck:\n${userMessage.trim()}\n\n` +
    (options.userContext?.trim() ? `Original user context/instructions:\n${options.userContext.trim()}\n\n` : "") +
    `Apply this feedback and return an improved nonland core for a ${targetMainboardSize}-card mainboard ` +
    `(plus sideboard if previously requested) using ONLY cards from the original pool. Do not return mainboard lands. ` +
    `Return the same strict JSON shape (summary, game_plan, main, side) — no prose, no fences.`;

  const messages: ChatMessage[] = [...transcript.messages, { role: "user", content: wrapped }];

  config.onPassStart?.(1, 1);
  const req = { messages, temperature, maxTokens: DEFAULT_AI_MAX_TOKENS, signal: config.signal, timeoutMs: config.timeoutMs };
  let raw: string;
  if (provider.generateStream && config.onToken) {
    raw = await provider.generateStream(req, config.onToken);
  } else {
    raw = await provider.generate(req);
  }
  config.onRaw?.(raw);

  const passReasoning: string[] = [
    `Engine: AI chat-refine (${provider.label})`,
    `User comment: ${userMessage.trim().slice(0, 200)}${userMessage.trim().length > 200 ? "…" : ""}`,
  ];
  const result = buildResultFromAIResponse(options, allCards, raw, passReasoning, targetMainboardSize);
  if (!result) {
    throw new Error("AI refinement returned no usable cards.");
  }
  result.diagnostics.reasoning = [...passReasoning, "—", ...result.diagnostics.reasoning];

  const nextTranscript: AIChatTranscript = {
    messages: [...messages, { role: "assistant", content: stripCodeFences(raw) }],
  };
  return Object.assign(result, { transcript: nextTranscript });
}

function buildRefinementPrompt(prev: GenerateResult, targetMainboardSize: number): string {
  const lowest = prev.scoreBreakdown.cardScores
    .filter((s) => s.board === "main")
    .sort((a, b) => a.perCopyScore - b.perCopyScore)
    .slice(0, 8)
    .map((s) => `${s.quantity}× ${s.name} (per-copy ${s.perCopyScore.toFixed(1)})`)
    .join("; ");
  return [
    `That deck scored ${prev.diagnostics.deckScore.toFixed(1)} (mana coverage ${(prev.diagnostics.manaBaseCoverage * 100).toFixed(0)}%, curve dev ${prev.diagnostics.curveDeviation.toFixed(2)}).`,
    `The lowest per-copy contributors were: ${lowest || "(none)"}.`,
    `Propose an improved nonland core for a ${targetMainboardSize}-card mainboard using ONLY cards from the original pool (do not invent cards; do not include mainboard lands).`,
    "Swap weak cards for higher-scoring alternatives that strengthen the deck's primary axes, improve interaction, or fix the curve / mana base.",
    "Return the same strict JSON shape (summary, game_plan, main, side) — no prose, no fences.",
  ].join(" ");
}

function isLocalProvider(providerId: string): boolean {
  return providerId === "llamacpp" || providerId === "ollama";
}

// ────────────────────────────────────────────────────────────────────────────
// Single-pass result builder
// ────────────────────────────────────────────────────────────────────────────

type ParsedLine = { name?: string; qty?: number; quantity?: number; reason?: string };
type Parsed = {
  summary?: string;
  game_plan?: string;
  main?: ParsedLine[];
  side?: ParsedLine[];
  mainboard?: ParsedLine[];
  sideboard?: ParsedLine[];
};

export interface AIProposalValidationIssue {
  code:
    | "UNRESOLVED_CARD"
    | "OUT_OF_POOL"
    | "NOT_LEGAL"
    | "QUANTITY_CLAMPED"
    | "MAINBOARD_LAND_IGNORED"
    | "SIDEBOARD_NORMALIZED"
    | "FINAL_DECK_VIOLATION";
  message: string;
  cardNames?: string[];
}

export interface AIProposalValidationResult {
  ok: boolean;
  issues: AIProposalValidationIssue[];
}

export interface ValidateAIProposalInput {
  resolvedEntries: DeckEntry[];
  unresolvedNames?: string[];
  allCards: CardRecord[];
  options: GenerateOptions;
  finalEntries?: DeckEntry[];
}

function buildResultFromAIResponse(
  options: GenerateOptions,
  allCards: CardRecord[],
  raw: string,
  reasoning: string[],
  targetMainboardSize: number
): GenerateResult | null {
  let parsed: Parsed;
  try {
    parsed = JSON.parse(stripCodeFences(raw));
  } catch (err) {
    reasoning.push(`AI JSON parse failed (${err instanceof Error ? err.message : String(err)}); attempting salvage.`);
    const salvaged = salvageDeckJSON(stripCodeFences(raw));
    if (salvaged.main.length === 0 && salvaged.side.length === 0) {
      reasoning.push("Salvage found no usable card entries.");
      return null;
    }
    reasoning.push(`Salvaged ${salvaged.main.length} main / ${salvaged.side.length} side entries from truncated JSON.`);
    parsed = { main: salvaged.main, side: salvaged.side, summary: salvaged.summary, game_plan: salvaged.game_plan };
  }

  const aiReasonByName = new Map<string, string>();
  const lines: { name: string; quantity: number; board: "main" | "side" }[] = [];
  const pushLine = (raw: ParsedLine | undefined, board: "main" | "side") => {
    if (!raw?.name) return;
    const qty = Number(raw.qty ?? raw.quantity ?? 0);
    if (!Number.isFinite(qty) || qty <= 0) return;
    lines.push({ name: raw.name, quantity: Math.max(1, Math.floor(qty)), board });
    if (typeof raw.reason === "string" && raw.reason.trim()) {
      aiReasonByName.set(raw.name.toLowerCase(), raw.reason.trim());
    }
  };
  for (const m of parsed.main ?? parsed.mainboard ?? []) pushLine(m, "main");
  for (const s of parsed.side ?? parsed.sideboard ?? []) pushLine(s, "side");

  if (lines.length === 0) {
    reasoning.push("AI returned no card entries.");
    return null;
  }

  if (parsed.summary?.trim()) reasoning.push(`AI summary: ${parsed.summary.trim()}`);
  if (parsed.game_plan?.trim()) reasoning.push(`AI game plan: ${parsed.game_plan.trim()}`);

  const { resolved, unresolved } = resolveLines(lines, allCards);
  const proposalValidation = validateAIProposal({
    resolvedEntries: resolved,
    unresolvedNames: unresolved.map((entry) => entry.name),
    allCards,
    options,
  });
  appendAIProposalValidationReasoning(proposalValidation, reasoning);
  if (unresolved.length > 0) {
    reasoning.push(`Dropped ${unresolved.length} unresolved card name(s): ${unresolved.slice(0, 6).map((u) => u.name).join(", ")}${unresolved.length > 6 ? "…" : ""}`);
  }

  const aggregated = new Map<string, DeckEntry>();
  for (const r of resolved) {
    const key = `${r.card.oracleId}|${r.board}`;
    const cap = maxCopiesForCard(r.card, options.format);
    const prev = aggregated.get(key);
    if (prev) prev.quantity = Math.min(cap, prev.quantity + r.quantity);
    else aggregated.set(key, { card: r.card, quantity: Math.min(cap, r.quantity), board: r.board });
  }
  const aiEntries = Array.from(aggregated.values());
  const aiMainEntries = aiEntries.filter((e) => e.board === "main");
  const aiSideEntries = aiEntries.filter((e) => e.board === "side");

  // Treat the AI's nonland picks as strong soft preferences instead of locked
  // seeds so the offline optimizer can still correct weak/off-plan LLM choices.
  const aiNonlandPreferences = aiMainEntries.filter((e) => !e.card.typeLine.includes("Land"));
  const aiLandPicks = aiMainEntries.filter((e) => e.card.typeLine.includes("Land"));
  if (aiLandPicks.length > 0) {
    const landTotal = aiLandPicks.reduce((s, e) => s + e.quantity, 0);
    reasoning.push(`AI picked ${landTotal} land(s) across ${aiLandPicks.length} name(s); offline manabase builder will rebuild the land suite around the AI's nonland preferences.`);
  }

  // When aiPicksAsFinal is true, treat AI's nonland picks (and the quantities the
  // LLM requested) as a locked spine: route them through seedEntries so the offline
  // pipeline locks them at the exact requested copy count and never removes/reduces
  // them — the optimizer may only gap-fill the remaining slots (lands, curve, removal).
  // Otherwise they remain soft preferences the optimizer is free to correct.
  //
  // CRITICAL: the locked spine MUST be clamped so it never crowds out the mana
  // base. The prompt asks for 55-65% nonland cards, but LLMs routinely overshoot
  // (e.g. returning 53 nonland copies for a 60-card deck). Without this clamp,
  // every nonland is locked, the size-trim can only remove the freshly generated
  // lands, and the land-floor guard cannot shed any locked card — shipping decks
  // with 7-land mana bases.
  const useAIPicksAsFinal = options.aiPicksAsFinal === true;
  let lockedAIPreferences = aiNonlandPreferences;
  if (useAIPicksAsFinal) {
    const clamp = clampAINonlandSpine(aiNonlandPreferences, options.seedEntries ?? [], targetMainboardSize);
    lockedAIPreferences = clamp.entries;
    if (clamp.trimmedCopies > 0) {
      reasoning.push(
        `AI overshot its nonland budget: returned ${clamp.originalCopies} nonland copies, clamped to ${clamp.maxCopies} (trimmed ${clamp.trimmedCopies} highest-cmc cop${clamp.trimmedCopies === 1 ? "y" : "ies"}) to reserve ${clamp.landBudget} slots for the offline mana base.`
      );
    }
  }
  const offlineRun = generateOffline(
    {
      ...options,
      engine: "offline",
      ...(useAIPicksAsFinal
        ? {
            seedEntries: mergeEntries(options.seedEntries ?? [], lockedAIPreferences),
            preferEntries: options.preferEntries,
          }
        : { preferEntries: mergeEntries(options.preferEntries ?? [], aiNonlandPreferences) }),
      generateSideboard: false,
    },
    allCards
  );
  if (useAIPicksAsFinal) {
    const lockedCopies = lockedAIPreferences.reduce((s, e) => s + e.quantity, 0);
    reasoning.push(`aiPicksAsFinal=true: AI's ${lockedAIPreferences.length} nonland pick(s) (${lockedCopies} copies) locked as the deck spine at requested quantities — optimizer gap-fills remaining slots only.`);
  }

  const normalizedSide = normalizeSideboard(aiSideEntries, options, reasoning);
  let entries = [...offlineRun.entries.filter((e) => e.board === "main"), ...normalizedSide];
  const lockedSpineIds = useAIPicksAsFinal
    ? new Set([...(options.seedEntries ?? []), ...lockedAIPreferences].map((e) => e.card.oracleId))
    : undefined;
  // CRITICAL: trimMainboardToSize prefers cutting lands over nonlands (lands sort
  // first for removal). After trimming, restore the land floor with enforceLandFloor.
  // The offline generator already runs this internally, but the post-trim step above
  // can undo it — so we run it again here.
  entries = trimMainboardToSize(entries, targetMainboardSize, lockedSpineIds);
  const mainColors = (options.colors.length > 0 ? options.colors : ["W", "U", "B", "R", "G"]) as ManaColor[];
  const targetLands = recommendLandCount(entries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))).recommended;
  enforceLandFloor(entries, targetLands, mainColors, allCards, lockedSpineIds ?? new Set(), targetMainboardSize, reasoning);

  const finalValidation = validateAIProposal({
    resolvedEntries: aiEntries,
    allCards,
    options,
    finalEntries: entries,
  });
  appendAIProposalValidationReasoning(finalValidation, reasoning);

  reasoning.push("— Offline pipeline (AI cards as soft preferences) —");
  for (const line of offlineRun.diagnostics.reasoning) reasoning.push(line);

  const target = blendRoleTargets(options.archetype, options.secondaryArchetypes);
  const targetAvgCmc = targetAvgCmcFor(options, target.maxAvgCmc);
  const score = deckScore(entries, options, targetAvgCmc);
  const scoreBreakdown = buildScoreBreakdown(entries, options, targetAvgCmc);

  const primaryAxes = keywordFocusToAxes(options.keywordFocus ?? []);
  const diagnostics: GenerationDiagnostic = {
    reasoning: [...reasoning],
    deckScore: score.total,
    cardScoreSum: score.cardScoreSum,
    curveDeviation: score.curveDeviation,
    manaBaseCoverage: score.manaBaseCoverage,
    optimizerSteps: offlineRun.diagnostics.optimizerSteps,
    primaryAxes,
  };

  const deckProfiles = entries
    .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
    .map((e) => buildSynergyProfile(e.card));
  const aiPickedOracleIds = new Set(aiMainEntries.map((e) => e.card.oracleId));
  const cardReasons: Record<string, string[]> = {};
  for (const e of entries) {
    if (e.card.typeLine.includes("Land")) continue;
    const aiReason = aiReasonByName.get(e.card.name.toLowerCase());
    const wasAIPicked = aiPickedOracleIds.has(e.card.oracleId);
    const offlineReasons = offlineRun.cardReasons[e.card.oracleId] ?? [];
    cardReasons[e.card.oracleId] = [
      ...(aiReason ? [`AI: ${aiReason}`] : []),
      ...(!wasAIPicked && offlineReasons.length === 0 ? ["Added by offline scoring engine to fill role gaps / mana base."] : []),
      ...(!wasAIPicked ? offlineReasons : []),
      ...generateTribalReasons(e.card, options.tribalSupport),
      ...generateCardReasons(buildSynergyProfile(e.card), primaryAxes, deckProfiles, "AI"),
    ];
  }

  return {
    entries,
    archetype: options.archetype,
    totalCards: entries.reduce((s, e) => s + e.quantity, 0),
    diagnostics,
    seededCards: useAIPicksAsFinal
      ? [...(options.seedEntries ?? []), ...lockedAIPreferences].map((e) => e.card)
      : (options.seedEntries ?? []).map((e) => e.card),
    focusedCards: (options.focusEntries ?? []).map((e) => e.card),
    cardReasons,
    scoreBreakdown,
    aiSummary: parsed.summary?.trim() || undefined,
    aiGamePlan: parsed.game_plan?.trim() || undefined,
  };
}

export function validateAIProposal(input: ValidateAIProposalInput): AIProposalValidationResult {
  const issues: AIProposalValidationIssue[] = [];
  const poolIds = new Set(buildPool(input.allCards, input.options).map((card) => card.oracleId));

  if (input.unresolvedNames?.length) {
    issues.push({
      code: "UNRESOLVED_CARD",
      message: `AI referenced ${input.unresolvedNames.length} card name(s) that could not be resolved.`,
      cardNames: [...new Set(input.unresolvedNames)],
    });
  }

  const combinedCounts = new Map<string, { card: CardRecord; requested: number }>();
  for (const entry of input.resolvedEntries) {
    if (!poolIds.has(entry.card.oracleId)) {
      issues.push({
        code: "OUT_OF_POOL",
        message: `AI referenced a resolved card outside the selected pool: ${entry.card.name}.`,
        cardNames: [entry.card.name],
      });
    }
    if (getCardLegality(entry.card, input.options.format) !== "legal") {
      issues.push({
        code: "NOT_LEGAL",
        message: `AI referenced a card that is not legal for the selected format: ${entry.card.name}.`,
        cardNames: [entry.card.name],
      });
    }
    if (entry.board === "main" && entry.card.typeLine.includes("Land")) {
      issues.push({
        code: "MAINBOARD_LAND_IGNORED",
        message: `AI included mainboard land ${entry.card.name}; offline mana-base builder will ignore/rebuild lands.`,
        cardNames: [entry.card.name],
      });
    }
    const aggregate = combinedCounts.get(entry.card.oracleId);
    if (aggregate) aggregate.requested += entry.quantity;
    else combinedCounts.set(entry.card.oracleId, { card: entry.card, requested: entry.quantity });
  }

  for (const { card, requested } of combinedCounts.values()) {
    const cap = maxCopiesForCard(card, input.options.format);
    if (requested > cap) {
      issues.push({
        code: "QUANTITY_CLAMPED",
        message: `AI requested ${requested} copies of ${card.name}; capped at ${cap}.`,
        cardNames: [card.name],
      });
    }
  }

  if (input.finalEntries) {
    const finalValidation = validateDeck(input.finalEntries, input.options.format);
    if (!finalValidation.legal) {
      for (const violation of finalValidation.violations) {
        issues.push({
          code: "FINAL_DECK_VIOLATION",
          message: violation.message,
          cardNames: violation.cardNames,
        });
      }
    }
  }

  return { ok: issues.length === 0, issues };
}

function appendAIProposalValidationReasoning(validation: AIProposalValidationResult, reasoning: string[]): void {
  if (validation.issues.length === 0) return;
  const grouped = new Map<AIProposalValidationIssue["code"], AIProposalValidationIssue[]>();
  for (const issue of validation.issues) {
    const bucket = grouped.get(issue.code) ?? [];
    bucket.push(issue);
    grouped.set(issue.code, bucket);
  }
  for (const [code, issues] of grouped) {
    const examples = issues
      .slice(0, 3)
      .map((issue) => issue.cardNames?.join(", ") || issue.message)
      .join("; ");
    reasoning.push(`AI proposal validation: ${code} ×${issues.length}${examples ? ` (${examples}${issues.length > 3 ? "…" : ""})` : ""}`);
  }
}

/**
 * Clamp the AI's locked nonland spine so the offline manabase builder always
 * has room for a full land suite. Returns the (possibly trimmed) entries plus
 * diagnostics. User seed entries are never touched — they only shrink the
 * budget available to the AI's picks. Trimming removes highest-cmc copies
 * first (mirroring trimMainboardToSize) so the cheap curve survives.
 */
export function clampAINonlandSpine(
  aiNonlandEntries: DeckEntry[],
  userSeedEntries: DeckEntry[],
  targetMainboardSize: number
): { entries: DeckEntry[]; originalCopies: number; maxCopies: number; trimmedCopies: number; landBudget: number } {
  const userSeedMain = userSeedEntries.filter((e) => e.board === "main");
  const userSeedNonlandCopies = userSeedMain
    .filter((e) => !e.card.typeLine.includes("Land"))
    .reduce((s, e) => s + e.quantity, 0);
  // Estimate the land budget from the same nonland mix the offline builder
  // will see (user seeds + AI picks); recommendLandCount ignores lands itself.
  const landBudget = recommendLandCount([...userSeedMain, ...aiNonlandEntries]).recommended;
  const maxCopies = Math.max(0, targetMainboardSize - landBudget - userSeedNonlandCopies);
  const originalCopies = aiNonlandEntries.reduce((s, e) => s + e.quantity, 0);
  if (originalCopies <= maxCopies) {
    return { entries: aiNonlandEntries, originalCopies, maxCopies, trimmedCopies: 0, landBudget };
  }
  const next = aiNonlandEntries.map((e) => ({ ...e }));
  const order = [...next].sort((a, b) => b.card.cmc - a.card.cmc);
  let toTrim = originalCopies - maxCopies;
  for (const entry of order) {
    if (toTrim <= 0) break;
    const remove = Math.min(entry.quantity, toTrim);
    entry.quantity -= remove;
    toTrim -= remove;
  }
  return {
    entries: next.filter((e) => e.quantity > 0),
    originalCopies,
    maxCopies,
    trimmedCopies: originalCopies - maxCopies,
    landBudget,
  };
}

function mergeEntries(base: DeckEntry[], additions: DeckEntry[]): DeckEntry[] {
  const merged = new Map<string, DeckEntry>();
  for (const entry of [...base, ...additions]) {
    const key = `${entry.card.oracleId}|${entry.board}`;
    const existing = merged.get(key);
    if (existing) existing.quantity += entry.quantity;
    else merged.set(key, { card: entry.card, quantity: entry.quantity, board: entry.board });
  }
  return [...merged.values()];
}

function normalizeSideboard(sideEntries: DeckEntry[], options: GenerateOptions, reasoning: string[]): DeckEntry[] {
  const rules = getFormatRules(options.format);
  if (rules.sideboardSize == null || !options.generateSideboard) {
    if (sideEntries.length > 0) reasoning.push(`Dropped AI sideboard because ${rules.label} sideboards are disabled or unavailable.`);
    return [];
  }
  const normalized: DeckEntry[] = [];
  const combinedCounts = new Map<string, number>();
  for (const entry of sideEntries) {
    const already = combinedCounts.get(entry.card.oracleId) ?? 0;
    const qty = Math.max(0, Math.min(entry.quantity, maxCopiesForCard(entry.card, options.format) - already));
    if (qty <= 0) continue;
    normalized.push({ ...entry, quantity: qty, board: "side" });
    combinedCounts.set(entry.card.oracleId, already + qty);
  }
  let total = normalized.reduce((sum, entry) => sum + entry.quantity, 0);
  if (total > rules.sideboardSize) {
    let over = total - rules.sideboardSize;
    for (let i = normalized.length - 1; i >= 0 && over > 0; i--) {
      const remove = Math.min(normalized[i].quantity, over);
      normalized[i].quantity -= remove;
      over -= remove;
    }
    total = rules.sideboardSize;
  }
  const trimmed = normalized.filter((entry) => entry.quantity > 0);
  if (sideEntries.length > 0) reasoning.push(`AI sideboard normalized to ${total}/${rules.sideboardSize} cards.`);
  return trimmed;
}

// ────────────────────────────────────────────────────────────────────────────
// JSON helpers
// ────────────────────────────────────────────────────────────────────────────

function stripCodeFences(raw: string): string {
  return raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
}

/** Best-effort recovery of a truncated/malformed deck JSON response. */
export function salvageDeckJSON(text: string): {
  main: { name: string; qty: number; reason?: string }[];
  side: { name: string; qty: number; reason?: string }[];
  summary?: string;
  game_plan?: string;
} {
  const summary = matchTopLevelString(text, "summary");
  const game_plan = matchTopLevelString(text, "game_plan");

  const findSection = (key: string): string => {
    const re = new RegExp(`"${key}"\\s*:\\s*\\[`, "i");
    const m = re.exec(text);
    if (!m) return "";
    const start = m.index + m[0].length;
    let depth = 1;
    let i = start;
    let inStr = false;
    let esc = false;
    for (; i < text.length; i++) {
      const c = text[i];
      if (inStr) {
        if (esc) esc = false;
        else if (c === "\\") esc = true;
        else if (c === '"') inStr = false;
        continue;
      }
      if (c === '"') { inStr = true; continue; }
      if (c === "[") depth++;
      else if (c === "]") { depth--; if (depth === 0) break; }
    }
    return text.slice(start, i);
  };

  const parseEntries = (section: string): { name: string; qty: number; reason?: string }[] => {
    const out: { name: string; qty: number; reason?: string }[] = [];
    const objRe = /\{[^{}]*\}/g;
    let m: RegExpExecArray | null;
    while ((m = objRe.exec(section)) !== null) {
      const obj = m[0];
      const nameM = /"name"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(obj);
      const qtyM = /"(?:qty|quantity)"\s*:\s*(\d+)/i.exec(obj);
      const reasonM = /"reason"\s*:\s*"((?:[^"\\]|\\.)*)"/i.exec(obj);
      if (nameM && qtyM) {
        out.push({
          name: nameM[1].replace(/\\"/g, '"'),
          qty: Number(qtyM[1]),
          reason: reasonM ? reasonM[1].replace(/\\"/g, '"') : undefined,
        });
      }
    }
    return out;
  };

  const mainSection = findSection("main") || findSection("mainboard");
  const sideSection = findSection("side") || findSection("sideboard");
  return {
    main: parseEntries(mainSection),
    side: parseEntries(sideSection),
    summary,
    game_plan,
  };
}

function matchTopLevelString(text: string, key: string): string | undefined {
  const re = new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)"`, "i");
  const m = re.exec(text);
  return m ? m[1].replace(/\\"/g, '"').replace(/\\n/g, " ") : undefined;
}

function normalizedMainboardSize(options: GenerateOptions): number {
  const rules = getFormatRules(options.format);
  const requested = options.maxMainboardSize ?? options.mainboardSize ?? rules.defaultMainboardSize;
  if (!Number.isFinite(requested)) return rules.defaultMainboardSize;
  return Math.max(rules.minMainboardSize, Math.min(rules.maxMainboardSize, Math.round(requested)));
}

function trimMainboardToSize(entries: DeckEntry[], targetSize: number, lockedIds?: Set<string>): DeckEntry[] {
  const next = entries.map((entry) => ({ card: entry.card, quantity: entry.quantity, board: entry.board }));
  let total = next.filter((e) => e.board === "main").reduce((sum, entry) => sum + entry.quantity, 0);
  if (total <= targetSize) return next;

  // NEVER trim lands first — sort nonlands ahead of lands for removal.
  const removable = next
    .filter((entry) => entry.board === "main" && !(lockedIds?.has(entry.card.oracleId)))
    .sort((a, b) => {
      const landA = a.card.typeLine.includes("Land") ? 1 : 0;
      const landB = b.card.typeLine.includes("Land") ? 1 : 0;
      if (landA !== landB) return landB - landA;
      return b.card.cmc - a.card.cmc;
    });

  for (const entry of removable) {
    if (total <= targetSize) break;
    const remove = Math.min(entry.quantity, total - targetSize);
    entry.quantity -= remove;
    total -= remove;
  }

  return next.filter((entry) => entry.quantity > 0);
}
