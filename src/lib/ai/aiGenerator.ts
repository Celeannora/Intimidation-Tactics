import type { CardRecord } from "../types";
import type { DeckEntry } from "../legality";
import { BASIC_LAND_NAMES, maxCopiesForCard } from "../legality";
import { getFormatRules } from "../formats";
import { assignRoles } from "../roles";
import { buildPool } from "../generator/pool";
import { generateDeck as generateOffline } from "../generator/generator";
import { buildScoreBreakdown, cardScoreDetail, deckScore, targetAvgCmcFor } from "../generator/weights";
import { blendRoleTargets } from "../generator/roleTargets";
import { buildSynergyProfile, generateCardReasons, generateTribalReasons, keywordFocusToAxes } from "../generator/synergyModel";
import type {
  GenerateOptions,
  GenerateResult,
  GenerationDiagnostic,
} from "../generator/types";
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
  const userContext = options.userContext?.trim();

  const isRedefine = options.aiPicksAsFinal === true;
  const system = [
    `You are an expert MTG ${formatRules.label} deckbuilder.`,
    `Build ONLY the NONLAND core for a tournament-viable ${targetMainboardSize}-card mainboard${formatRules.sideboardSize ? ` (${formatRules.sideboardSize}-card sideboard if requested)` : ""} using cards from the provided pool.`,
    `IMPORTANT: do NOT return a full ${targetMainboardSize}-card mainboard. An offline mana-base builder will add lands automatically. Return ${targetNonlandMin}-${targetNonlandMax} mainboard nonland cards (spells/creatures/planeswalkers/etc). Do NOT pad with basics or utility lands in main — leave all land slots for the offline builder.`,
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
    `Your JSON main[] target: ${targetNonlandMin}-${targetNonlandMax} nonland cards only`,
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

  // When aiPicksAsFinal is true, treat AI's nonland picks as locked focusEntries
  // so they are guaranteed in the final deck instead of being just soft preferences.
  const useAIPicksAsFinal = options.aiPicksAsFinal === true;
  const offlineRun = generateOffline(
    {
      ...options,
      engine: "offline",
      ...(useAIPicksAsFinal
        ? { focusEntries: mergeEntries(options.focusEntries ?? [], aiNonlandPreferences), preferEntries: options.preferEntries }
        : { preferEntries: mergeEntries(options.preferEntries ?? [], aiNonlandPreferences) }),
      generateSideboard: false,
    },
    allCards
  );
  if (useAIPicksAsFinal) {
    reasoning.push(`aiPicksAsFinal=true: AI's nonland picks locked as focus entries (guaranteed in deck).`);
  }

  const normalizedSide = normalizeSideboard(aiSideEntries, options, reasoning);
  let entries = [...offlineRun.entries.filter((e) => e.board === "main"), ...normalizedSide];
  entries = trimMainboardToSize(entries, targetMainboardSize);

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
    seededCards: (options.seedEntries ?? []).map((e) => e.card),
    focusedCards: (options.focusEntries ?? []).map((e) => e.card),
    cardReasons,
    scoreBreakdown,
    aiSummary: parsed.summary?.trim() || undefined,
    aiGamePlan: parsed.game_plan?.trim() || undefined,
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

function trimMainboardToSize(entries: DeckEntry[], targetSize: number): DeckEntry[] {
  const next = entries.map((entry) => ({ card: entry.card, quantity: entry.quantity, board: entry.board }));
  let total = next.filter((e) => e.board === "main").reduce((sum, entry) => sum + entry.quantity, 0);
  if (total <= targetSize) return next;

  const removable = next
    .filter((entry) => entry.board === "main")
    .sort((a, b) => {
      const landA = a.card.typeLine.includes("Land") ? 1 : 0;
      const landB = b.card.typeLine.includes("Land") ? 1 : 0;
      if (landA !== landB) return landA - landB;
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
