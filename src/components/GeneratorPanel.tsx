import { useEffect, useMemo, useRef, useState } from "react";
import { db } from "../lib/db";
import { useDeckStore, useMainboardEntries } from "../store/deckStore";
import { generateDecks } from "../lib/generator/generator";
import { generateDeckAI, refineDeckAI, buildAIPrompts, salvageDeckJSON, DEFAULT_AI_TEMPERATURE, DEFAULT_DIGEST_LIMIT, type AIChatTranscript } from "../lib/ai/aiGenerator";
import { loadAISettings } from "../lib/ai/provider";
import { makeProvider } from "../lib/ai/factory";
import { COMMON_TRIBES, buildSynergyProfile, inferPrimaryAxes, normalizeTribe } from "../lib/generator/synergyModel";
import { assignRoles, isThreat } from "../lib/roles";
import type { Archetype } from "../lib/archetype";
import type { ManaColor } from "../lib/types";
import type {
  GenerateOptions,
  GenerateResult,
  GenerationEngine,
  KeywordFocus,
  SpeedProfile,
  SpellRatio,
  TribalSupportMode,
} from "../lib/generator/types";
import { AISettingsDrawer } from "./AISettingsDrawer";
import { CONSTRUCTED_FORMATS, getFormatRules, type ConstructedFormat, type PlayEnvironment } from "../lib/formats";

const ARCHETYPES: Archetype[] = [
  "Aggro", "Burn", "Midrange", "Tempo", "Control", "Combo", "Ramp", "Tokens", "Graveyard", "Sacrifice",
];

const COLORS: { code: ManaColor; bg: string }[] = [
  { code: "W", bg: "bg-yellow-200 text-yellow-900" },
  { code: "U", bg: "bg-blue-300 text-blue-900" },
  { code: "B", bg: "bg-zinc-700 text-zinc-100" },
  { code: "R", bg: "bg-red-400 text-red-950" },
  { code: "G", bg: "bg-green-400 text-green-950" },
];

const ROLE_ARCHETYPES: Archetype[] = ["Aggro", "Burn", "Midrange", "Tempo", "Control", "Combo", "Ramp", "Tokens", "Graveyard", "Sacrifice"];

const ARCHITECTURE_GROUPS: { title: string; items: { focus: KeywordFocus; description: string }[] }[] = [
  {
    title: "Creature / Combat",
    items: [
      { focus: "Stompy", description: "Prioritizes efficient bodies, pump effects, and combat pressure." },
      { focus: "Voltron/Auras", description: "Builds around one or two enhanced threats with Auras/equipment-style payoffs." },
      { focus: "Flying", description: "Prefers evasive threats that can pressure through board stalls." },
      { focus: "Trample", description: "Boosts large attackers and damage-through-blockers plans." },
      { focus: "+1/+1 Counters", description: "Looks for counter sources, scaling creatures, and counter payoffs." },
    ],
  },
  {
    title: "Go-wide / Sacrifice",
    items: [
      { focus: "Go-Wide Tokens", description: "Creates many bodies and rewards team-wide buffs or token payoffs." },
      { focus: "Aristocrats", description: "Uses sacrifice/death triggers to drain, draw, or grind value." },
      { focus: "Sacrifice", description: "Adds outlets and expendable permanents for sacrifice engines." },
      { focus: "Tribal Support", description: "Rewards a chosen creature type; unlocks Recommended or Exclusive tribal mode." },
    ],
  },
  {
    title: "Graveyard",
    items: [
      { focus: "Graveyard", description: "Values self-mill, recursion, and cards that use the graveyard as a resource." },
      { focus: "Reanimator", description: "Prioritizes ways to return threats from the graveyard." },
      { focus: "Mill", description: "Boosts cards that mill or pay off cards entering graveyards from libraries." },
    ],
  },
  {
    title: "Spells / Control",
    items: [
      { focus: "Spellslinger", description: "Rewards instants/sorceries and cards that trigger from casting spells." },
      { focus: "Prowess", description: "Prefers noncreature spell density with prowess-style attackers." },
      { focus: "Draw-Go Control", description: "Leans toward instant-speed answers, card draw, and reactive play." },
      { focus: "Flash/Draw-Go", description: "Prioritizes flash threats, instant-speed interaction, and passing with mana up." },
    ],
  },
  {
    title: "Disruption / Alternate Plans",
    items: [
      { focus: "Hand Disruption", description: "Prioritizes discard, information advantage, and proactive disruption against combo/control." },
      { focus: "Discard", description: "Adds discard sources and cards that reward players discarding." },
      { focus: "Self-Discard/Looting", description: "Uses loot/rummage and discard outlets to fuel graveyard or reanimation plans." },
      { focus: "Evasion Tempo", description: "Combines evasive threats with cheap interaction to protect a lead." },
    ],
  },
  {
    title: "Value Engines",
    items: [
      { focus: "ETB/Blink", description: "Prioritizes enter-the-battlefield value and repeatable blink/flicker synergies." },
      { focus: "Enchantress", description: "Boosts enchantments and cards rewarded by casting/controlling them." },
      { focus: "Artifacts", description: "Looks for artifact, Treasure, Clue, Food, and artifact-matters packages." },
      { focus: "Artifacts/Tokens", description: "Builds around artifact tokens like Treasure, Clue, Food, Map, and artifact payoffs." },
      { focus: "Lifegain", description: "Combines life sources with cards that reward life gained." },
      { focus: "Ramp", description: "Improves mana acceleration and top-end support." },
      { focus: "Big Mana", description: "Leans into ramp, card advantage, and powerful top-end threats." },
    ],
  },
];

export function GeneratorPanel() {
  const mainEntries = useMainboardEntries();
  const clearDeck = useDeckStore((s) => s.clearDeck);
  const addCard = useDeckStore((s) => s.addCard);
  const setDeckName = useDeckStore((s) => s.setDeckName);
  const pins = useDeckStore((s) => s.pins);

  // Form state
  const [engine, setEngine] = useState<GenerationEngine>("offline");
  const [format, setFormat] = useState<ConstructedFormat>("standard");
  const [playEnvironment, setPlayEnvironment] = useState<PlayEnvironment>("bo1");
  const [archetype, setArchetype] = useState<Archetype>("Midrange");
  const [secondaryArchetypes, setSecondaryArchetypes] = useState<Archetype[]>([]);
  const [colors, setColors] = useState<ManaColor[]>([]);
  const [speed, setSpeed] = useState<SpeedProfile | "">("");
  const [spellRatio, setSpellRatio] = useState<SpellRatio | "">("");
  const [keywordFocus, setKeywordFocus] = useState<KeywordFocus[]>([]);
  const [tribalTribe, setTribalTribe] = useState("");
  const [tribalMode, setTribalMode] = useState<TribalSupportMode>("recommended");
  const [maxCardPrice, setMaxCardPrice] = useState("");
  const [totalBudget, setTotalBudget] = useState("");
  const [mainboardSize, setMainboardSize] = useState(60);
  const [variants, setVariants] = useState(1);
  const [iterations, setIterations] = useState(200);
  const [generateSideboard, setGenSide] = useState(false);
  const [currentDeckMode, setCurrentDeckMode] = useState<"off" | "suggestion" | "tuneCore" | "buildAround" | "lockExact" | "redefine">("buildAround");
  const [seedFuzzSwaps, setSeedFuzzSwaps] = useState<number>(0);
  // Locked spine: AI's nonland picks (and the quantities the LLM specifies) become
  // a locked deck spine the optimizer may only gap-fill around. Default ON for AI;
  // a toggle lets the user relax it back to "soft preferences" behavior.
  const [lockAIPicks, setLockAIPicks] = useState<boolean>(true);
  const [analysisSummary, setAnalysisSummary] = useState<string | null>(null);

  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [results, setResults] = useState<GenerateResult[]>([]);
  const [activeIdx, setActiveIdx] = useState(0);
  const [drawerOpen, setDrawerOpen] = useState(false);
  const [temperature, setTemperature] = useState<number>(DEFAULT_AI_TEMPERATURE);
  const [digestLimit, setDigestLimit] = useState<number>(DEFAULT_DIGEST_LIMIT);
  const [aiIterations, setAiIterations] = useState<number>(1);
  const [userContext, setUserContext] = useState<string>("");

  const [streamedText, setStreamedText] = useState<string>("");
  const [currentPass, setCurrentPass] = useState<{ pass: number; total: number } | null>(null);
  const [rawResponse, setRawResponse] = useState<string | null>(null);
  const [aiTranscript, setAiTranscript] = useState<AIChatTranscript | null>(null);
  const [chatHistory, setChatHistory] = useState<{ role: "user" | "assistant"; text: string }[]>([]);
  const [chatInput, setChatInput] = useState<string>("");
  const lastOptionsRef = useRef<GenerateOptions | null>(null);
  const [previewPrompts, setPreviewPrompts] = useState<{ system: string; user: string; poolSize: number } | null>(null);
  const [elapsedMs, setElapsedMs] = useState(0);
  const startTimeRef = useRef<number | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  useEffect(() => {
    if (!busy) {
      startTimeRef.current = null;
      return;
    }
    startTimeRef.current = performance.now();
    setElapsedMs(0);
    const id = window.setInterval(() => {
      if (startTimeRef.current != null) setElapsedMs(performance.now() - startTimeRef.current);
    }, 200);
    return () => window.clearInterval(id);
  }, [busy]);

  const currentDeckSummary = useMemo(() => {
    if (currentDeckMode === "off" || mainEntries.length === 0) return null;
    const nonland = mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"));
    const nonlandTotal = nonland.reduce((s, e) => s + e.quantity, 0);
    const allTotal = mainEntries.reduce((s, e) => s + e.quantity, 0);
    return { nonlandUnique: nonland.length, nonlandTotal, allTotal, allUnique: mainEntries.length };
  }, [currentDeckMode, mainEntries]);

  const toggleColor = (c: ManaColor) =>
    setColors((p) => (p.includes(c) ? p.filter((x) => x !== c) : [...p, c]));
  const toggleKeyword = (k: KeywordFocus) => {
    setKeywordFocus((p) => {
      const enabled = p.includes(k);
      if (!enabled && k === "Tribal Support") {
        const detected = detectTribe(mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land")));
        if (detected) setTribalTribe(detected);
      }
      return enabled ? p.filter((x) => x !== k) : [...p, k];
    });
  };
  const toggleSecondaryArchetype = (a: Archetype) =>
    setSecondaryArchetypes((p) => (p.includes(a) ? p.filter((x) => x !== a) : [...p, a]));

  const onFormatChange = (nextFormat: ConstructedFormat) => {
    const rules = getFormatRules(nextFormat);
    setFormat(nextFormat);
    setMainboardSize(rules.defaultMainboardSize);
    if (rules.sideboardSize == null) setGenSide(false);
  };

  const analyzeCurrentDeck = () => {
    const mainNonlands = mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"));
    if (mainNonlands.length === 0) {
      setAnalysisSummary("Current mainboard has no nonland cards to analyze.");
      return;
    }

    const detectedColors = detectDeckColors(mainEntries);
    const detectedSpeed = detectSpeed(mainNonlands);
    const detectedSpellRatio = detectSpellRatio(mainNonlands);
    const profiles = mainNonlands.flatMap((e) => Array.from({ length: e.quantity }, () => buildSynergyProfile(e.card)));
    const axes = inferPrimaryAxes(profiles);
    const detectedFocus = detectKeywordFocus(mainNonlands, axes);
    const detectedPrimary = detectPrimaryArchetype(mainNonlands, axes, detectedSpeed, detectedColors);
    const detectedSecondary = detectSecondaryArchetypes(detectedPrimary, mainNonlands, axes);
    const detectedTribe = detectTribe(mainNonlands);

    setColors(detectedColors);
    setSpeed(detectedSpeed);
    setSpellRatio(detectedSpellRatio);
    setArchetype(detectedPrimary);
    setSecondaryArchetypes(detectedSecondary);
    setKeywordFocus(detectedFocus);
    if (detectedTribe) {
      setTribalTribe(detectedTribe);
      setTribalMode("recommended");
    }

    setAnalysisSummary(
      `Detected ${detectedPrimary}${detectedSecondary.length ? ` + ${detectedSecondary.join("/")}` : ""}, ${detectedColors.join("") || "colorless"}, ${detectedSpeed}, ${detectedSpellRatio}${detectedTribe ? `, ${detectedTribe} tribal` : ""}.`
    );
  };

  const detectCurrentDeckSettings = () => {
    const mainNonlands = mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"));
    if (mainNonlands.length === 0) return null;
    const detectedColors = detectDeckColors(mainEntries);
    const detectedSpeed = detectSpeed(mainNonlands);
    const detectedSpellRatio = detectSpellRatio(mainNonlands);
    const profiles = mainNonlands.flatMap((e) => Array.from({ length: e.quantity }, () => buildSynergyProfile(e.card)));
    const axes = inferPrimaryAxes(profiles);
    const detectedFocus = detectKeywordFocus(mainNonlands, axes);
    const detectedPrimary = detectPrimaryArchetype(mainNonlands, axes, detectedSpeed, detectedColors);
    const detectedSecondary = detectSecondaryArchetypes(detectedPrimary, mainNonlands, axes);
    const detectedTribe = detectTribe(mainNonlands);
    return { detectedColors, detectedSpeed, detectedSpellRatio, detectedFocus, detectedPrimary, detectedSecondary, detectedTribe };
  };

  const buildAutoDetectedOverrides = () => {
    const detected = detectCurrentDeckSettings();
    if (!detected) return {};
    const formLooksUnconfigured =
      colors.length === 0 ||
      (archetype === "Midrange" && secondaryArchetypes.length === 0 && keywordFocus.length === 0 && !speed && !spellRatio);
    if (!formLooksUnconfigured) return {};
    return {
      colors: colors.length === 0 ? detected.detectedColors : colors,
      archetype: archetype === "Midrange" && keywordFocus.length === 0 ? detected.detectedPrimary : archetype,
      secondaryArchetypes: secondaryArchetypes.length === 0 ? detected.detectedSecondary : secondaryArchetypes,
      speed: speed || detected.detectedSpeed,
      spellRatio: spellRatio || detected.detectedSpellRatio,
      keywordFocus: keywordFocus.length === 0 ? detected.detectedFocus : keywordFocus,
      tribalTribe: tribalTribe.trim() || detected.detectedTribe || "",
    };
  };

  const buildCurrentDeckEntries = () => {
    const nonlandMain = mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"));
    const base = buildCurrentDeckEntriesForMode(nonlandMain);
    return applyPinnedLocks(base);
  };

  // Pinned cards are always locked seeds at their pinned quantity, regardless of the
  // current-deck mode. They are removed from focus/prefer lists so they are not
  // double-counted, guaranteeing the optimizer never swaps or reduces them.
  const applyPinnedLocks = (base: ReturnType<typeof buildCurrentDeckEntriesForMode>) => {
    const pinnedIds = Object.keys(pins);
    if (pinnedIds.length === 0) return base;
    const pinnedSet = new Set(pinnedIds);
    const pinnedEntries = mainEntries
      .filter((e) => e.board === "main" && pinnedSet.has(e.card.oracleId))
      .map((e) => ({ card: e.card, quantity: Math.min(pins[e.card.oracleId], e.quantity), board: "main" as const }));

    const dropPinned = (list: typeof base.seedEntries) =>
      list ? list.filter((e) => !pinnedSet.has(e.card.oracleId)) : list;

    const mergedSeeds = [
      ...(base.seedEntries ? base.seedEntries.filter((e) => !pinnedSet.has(e.card.oracleId)) : []),
      ...pinnedEntries,
    ];

    return {
      seedEntries: mergedSeeds.length ? mergedSeeds : undefined,
      focusEntries: dropPinned(base.focusEntries),
      preferEntries: dropPinned(base.preferEntries),
      seedFuzzSwaps: base.seedFuzzSwaps,
    };
  };

  const buildCurrentDeckEntriesForMode = (nonlandMain: typeof mainEntries) => {
    switch (currentDeckMode) {
      case "off":
        return { seedEntries: undefined, focusEntries: undefined, preferEntries: undefined, seedFuzzSwaps: undefined };
      case "suggestion":
        return { seedEntries: undefined, focusEntries: undefined, preferEntries: nonlandMain.length ? nonlandMain : undefined, seedFuzzSwaps: undefined };
      case "tuneCore":
        return {
          seedEntries: undefined,
          focusEntries: nonlandMain.length ? nonlandMain.map((entry) => ({ ...entry, quantity: Math.max(1, entry.quantity - 1) })) : undefined,
          preferEntries: undefined,
          seedFuzzSwaps: undefined,
        };
      case "buildAround":
        return { seedEntries: undefined, focusEntries: nonlandMain.length ? nonlandMain : undefined, preferEntries: undefined, seedFuzzSwaps: undefined };
      case "lockExact":
        return { seedEntries: mainEntries.length ? mainEntries : undefined, focusEntries: undefined, preferEntries: undefined, seedFuzzSwaps: seedFuzzSwaps > 0 ? seedFuzzSwaps : undefined };
      case "redefine":
        return { seedEntries: undefined, focusEntries: undefined, preferEntries: undefined, seedFuzzSwaps: undefined };
    }
  };

  const buildOptionsForPrompt = (): GenerateOptions => {
    const overrides = buildAutoDetectedOverrides();
    const effectiveColors = overrides.colors ?? colors;
    const effectiveArchetype = overrides.archetype ?? archetype;
    const effectiveSecondaryArchetypes = overrides.secondaryArchetypes ?? secondaryArchetypes;
    const effectiveSpeed = overrides.speed ?? speed;
    const effectiveSpellRatio = overrides.spellRatio ?? spellRatio;
    const effectiveKeywordFocus = overrides.keywordFocus ?? keywordFocus;
    const effectiveTribalInput = overrides.tribalTribe ?? tribalTribe.trim();
    const effectiveTribalTribe = effectiveKeywordFocus.includes("Tribal Support")
      ? detectTribe(mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))) ?? effectiveTribalInput
      : "";
    const currentDeck = buildCurrentDeckEntries();
    return {
      engine,
      format,
      playEnvironment,
      archetype: effectiveArchetype,
      secondaryArchetypes: effectiveSecondaryArchetypes,
      colors: effectiveColors,
      ...currentDeck,
      speed: effectiveSpeed || undefined,
      spellRatio: effectiveSpellRatio || undefined,
      keywordFocus: effectiveKeywordFocus.length ? effectiveKeywordFocus : undefined,
      tribalSupport: effectiveKeywordFocus.includes("Tribal Support") && effectiveTribalTribe
        ? { tribe: effectiveTribalTribe, mode: tribalMode }
        : undefined,
      maxCardPriceUsd: parsePositiveFloat(maxCardPrice),
      totalBudgetUsd: parsePositiveFloat(totalBudget),
      mainboardSize,
      maxMainboardSize: mainboardSize,
      variants,
      optimizationIterations: iterations,
      aiIterations,
      aiPicksAsFinal: engine === "ai" && (lockAIPicks || currentDeckMode === "redefine"),
      userContext: userContext.trim() || undefined,
      generateSideboard: getFormatRules(format).sideboardSize == null ? false : generateSideboard,
    };
  };

  const onPreviewPrompt = async () => {

    try {
      const allCards = await db.cards.toArray();
      if (allCards.length === 0) {
        setError("No cards in database. Import oracle_cards.json first.");
        return;
      }
      const opts = buildOptionsForPrompt();
      const prompts = buildAIPrompts(opts, allCards, digestLimit);
      setPreviewPrompts(prompts);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    }
  };

  const onGenerate = async () => {
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setBusy(true);
    setError(null);
    setResults([]);
    setStreamedText("");
    setRawResponse(null);
    setAiTranscript(null);
    setChatHistory([]);
    setChatInput("");
    try {
      const allCards = await db.cards.toArray();
      if (allCards.length === 0) {
        setError("No cards in database. Import oracle_cards.json first.");
        return;
      }

      const overrides = buildAutoDetectedOverrides();
      const effectiveColors = overrides.colors ?? colors;
      const effectiveArchetype = overrides.archetype ?? archetype;
      const effectiveSecondaryArchetypes = overrides.secondaryArchetypes ?? secondaryArchetypes;
      const effectiveSpeed = overrides.speed ?? speed;
      const effectiveSpellRatio = overrides.spellRatio ?? spellRatio;
      const effectiveKeywordFocus = overrides.keywordFocus ?? keywordFocus;
      const effectiveTribalInput = overrides.tribalTribe ?? tribalTribe.trim();
      const effectiveTribalTribe = effectiveKeywordFocus.includes("Tribal Support")
        ? detectTribe(mainEntries.filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))) ?? effectiveTribalInput
        : "";

      const currentDeck = buildCurrentDeckEntries();
      const opts: GenerateOptions = {
        engine,
        format,
        playEnvironment,
        archetype: effectiveArchetype,
        secondaryArchetypes: effectiveSecondaryArchetypes,
        colors: effectiveColors,
        ...currentDeck,
        speed: effectiveSpeed || undefined,
        spellRatio: effectiveSpellRatio || undefined,
        keywordFocus: effectiveKeywordFocus.length ? effectiveKeywordFocus : undefined,
        tribalSupport: effectiveKeywordFocus.includes("Tribal Support") && effectiveTribalTribe
          ? { tribe: effectiveTribalTribe, mode: tribalMode }
          : undefined,
        maxCardPriceUsd: parsePositiveFloat(maxCardPrice),
        totalBudgetUsd: parsePositiveFloat(totalBudget),
        mainboardSize,
        maxMainboardSize: mainboardSize,
        variants,
        optimizationIterations: iterations,
        aiIterations,
        aiPicksAsFinal: engine === "ai" && (lockAIPicks || currentDeckMode === "redefine"),
        userContext: userContext.trim() || undefined,
        generateSideboard: getFormatRules(format).sideboardSize == null ? false : generateSideboard,
      };

      let produced: GenerateResult[];

      if (engine === "ai") {
        const settings = loadAISettings();
        const provider = makeProvider(settings);
        if (!provider) {
          setError("AI engine selected but no provider configured. Open AI Settings.");
          return;
        }
        if (!(await provider.isReady())) {
          setError(`AI provider (${provider.label}) not ready. Open AI Settings.`);
          return;
        }
        // AI mode produces a single result; ignore variants count.
        const aiResult = await generateDeckAI(opts, allCards, provider, {
          temperature,
          digestLimit,
          signal: abortController.signal,
          onToken: (chunk) => setStreamedText((s) => s + chunk),
          onRaw: (r) => setRawResponse(r),
          onPassStart: (pass, total) => {
            setCurrentPass({ pass, total });
            setStreamedText("");
          },
        });
        produced = [aiResult];
        if (aiResult.transcript) setAiTranscript(aiResult.transcript);
        lastOptionsRef.current = opts;
      } else {
        produced = generateDecks(opts, allCards).variants;
      }

      setResults(produced);
      setActiveIdx(0);
      applyToDeck(produced[0]);
    } catch (e) {
      setError(isAbortError(e) ? "AI generation cancelled." : e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
      setBusy(false);
    }
  };

  const onChatSend = async () => {
    const message = chatInput.trim();
    if (!message || !aiTranscript || !lastOptionsRef.current) return;
    abortRef.current?.abort();
    const abortController = new AbortController();
    abortRef.current = abortController;
    setBusy(true);
    setError(null);
    setStreamedText("");
    setRawResponse(null);
    setChatHistory((h) => [...h, { role: "user", text: message }]);
    setChatInput("");
    try {
      const allCards = await db.cards.toArray();
      const settings = loadAISettings();
      const provider = makeProvider(settings);
      if (!provider) throw new Error("AI provider not configured.");
      const refined = await refineDeckAI(
        lastOptionsRef.current,
        allCards,
        provider,
        aiTranscript,
        message,
        {
          temperature,
          digestLimit,
          signal: abortController.signal,
          onToken: (chunk) => setStreamedText((s) => s + chunk),
          onRaw: (r) => setRawResponse(r),
          onPassStart: (pass, total) => {
            setCurrentPass({ pass, total });
            setStreamedText("");
          },
        }
      );
      setResults([refined]);
      setActiveIdx(0);
      setAiTranscript(refined.transcript);
      setChatHistory((h) => [...h, { role: "assistant", text: `Updated deck (score ${refined.diagnostics.deckScore.toFixed(1)}).${refined.aiSummary ? " " + refined.aiSummary : ""}` }]);
      applyToDeck(refined);
    } catch (e) {
      setError(isAbortError(e) ? "AI refinement cancelled." : e instanceof Error ? e.message : String(e));
    } finally {
      if (abortRef.current === abortController) abortRef.current = null;
      setBusy(false);
    }
  };

  const onCancel = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setBusy(false);
    setError("Generation cancelled.");
  };

  const applyToDeck = (result: GenerateResult) => {
    clearDeck();
    setDeckName(`${getFormatRules(format).label} ${result.archetype} (${colors.join("") || "C"}) — ${engine}`);
    for (const entry of result.entries) {
      for (let i = 0; i < entry.quantity; i++) addCard(entry.card, entry.board);
    }
  };

  const switchVariant = (i: number) => {
    if (i === activeIdx || !results[i]) return;
    setActiveIdx(i);
    applyToDeck(results[i]);
  };

  const active = results[activeIdx];

  return (
    <div className="space-y-4 text-sm text-zinc-200">
      {/* Engine + AI settings */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
        <div className="mb-2 flex items-center justify-between">
          <span className="text-xs font-medium text-zinc-400">Engine</span>
          <button
            onClick={() => setDrawerOpen(true)}
            className="text-xs text-teal-400 hover:text-teal-300"
          >
            AI Settings…
          </button>
        </div>
        <div role="radiogroup" className="flex gap-2">
          {(["offline", "ai"] as GenerationEngine[]).map((e) => (
            <button
              key={e}
              role="radio"
              aria-checked={engine === e}
              onClick={() => setEngine(e)}
              className={`flex-1 rounded-md border px-3 py-1.5 text-xs font-medium ${
                engine === e
                  ? "border-teal-400 bg-teal-600/20 text-teal-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              {e === "offline" ? "Offline (research-weighted)" : "AI Feed"}
            </button>
          ))}
        </div>
      </div>

      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs">
        <div className="flex items-center justify-between gap-3">
          <div>
            <div className="font-medium text-zinc-300">Analyze current deck</div>
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">
              Prefills colors, primary/secondary archetypes, speed, spell ratio, architecture focuses, and tribal settings from the current mainboard.
            </p>
          </div>
          <button
            onClick={analyzeCurrentDeck}
            className="shrink-0 rounded-md border border-teal-600 bg-teal-600/10 px-3 py-1.5 text-xs font-medium text-teal-200 hover:bg-teal-600/20"
          >
            Analyze
          </button>
        </div>
        {analysisSummary && <p className="mt-2 text-[11px] text-zinc-500">{analysisSummary}</p>}
      </div>

      {/* Format + environment */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Format</label>
          <select
            value={format}
            onChange={(e) => onFormatChange(e.target.value as ConstructedFormat)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            {CONSTRUCTED_FORMATS.map((f) => <option key={f.id} value={f.id}>{f.label}</option>)}
          </select>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            Filters the card pool by Scryfall legality. Commander/Brawl use singleton deck sizes for generation.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Environment</label>
          <select
            value={playEnvironment}
            onChange={(e) => setPlayEnvironment(e.target.value as PlayEnvironment)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            <option value="bo1">Ladder Bo1</option>
            <option value="bo3">Ladder Bo3</option>
            <option value="casual">Casual / kitchen table</option>
          </select>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            Standard Bo1 uses the Untapped Platinum ladder profile: cheap interaction, flexible answers, and tighter curve.
          </p>
        </div>
      </div>

      {/* Archetype + colors */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Primary archetype</label>
          <select
            value={archetype}
            onChange={(e) => setArchetype(e.target.value as Archetype)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            {ARCHETYPES.map((a) => <option key={a} value={a}>{a}</option>)}
          </select>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            Macro shell: curve, role budget, interaction density, and main game plan.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Colors</label>
          <div className="flex gap-1">
            {COLORS.map((c) => {
              const on = colors.includes(c.code);
              return (
                <button
                  key={c.code}
                  onClick={() => toggleColor(c.code)}
                  aria-pressed={on}
                  className={`h-7 w-7 rounded-full text-xs font-bold border ${c.bg} ${
                    on ? "border-teal-400 ring-1 ring-teal-400/40" : "border-zinc-700 opacity-40"
                  }`}
                >
                  {c.code}
                </button>
              );
            })}
          </div>
        </div>
      </div>

      {/* Secondary archetypes */}
      <div>
        <div className="mb-1 text-xs font-medium text-zinc-400">Secondary archetypes (optional)</div>
        <div className="flex flex-wrap gap-1">
          {ARCHETYPES.filter((a) => a !== archetype).map((a) => {
            const on = secondaryArchetypes.includes(a);
            return (
              <button
                key={a}
                onClick={() => toggleSecondaryArchetype(a)}
                className={`rounded-full border px-2 py-0.5 text-xs ${
                  on
                    ? "border-purple-400 bg-purple-600/20 text-purple-200"
                    : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                }`}
              >
                {a}
              </button>
            );
          })}
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          Optional subplans: blended into role targets and synergy axes without replacing the primary shell, e.g. Tempo + Tokens or Sacrifice + Graveyard.
        </p>
      </div>

      {/* Current deck handling */}
      <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 text-xs space-y-2">
        <label className="block">
          <span className="mb-1 block text-xs font-medium text-zinc-400">Use current deck</span>
          <select
            value={currentDeckMode}
            onChange={(e) => setCurrentDeckMode(e.target.value as typeof currentDeckMode)}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            <option value="off">Off — ignore current deck</option>
            <option value="suggestion">Suggestion — strongly prefer current cards, may swap</option>
            <option value="tuneCore">Tune (keep core) — keep each current nonland, free some copy slots</option>
            <option value="buildAround">Build-around — keep cards, tune quantities</option>
            <option value="lockExact">Lock exact — keep cards AND quantities</option>
            {engine === "ai" && <option value="redefine">Redefine (AI from scratch) — AI fully rebuilds the deck</option>}
          </select>
        </label>
        <p className="text-[11px] leading-snug text-zinc-500">
          {currentDeckMode === "off" && "Generator ignores your current deck entirely."}
          {currentDeckMode === "suggestion" && "Your nonland cards get a strong score bonus so the optimizer is biased to include them, but it may drop weaker ones for better picks."}
          {currentDeckMode === "tuneCore" && "Every current nonland is guaranteed to appear, but 2×+ cards may free one copy slot for upgrades."}
          {currentDeckMode === "buildAround" && "Your nonland cards are guaranteed to appear at up to their current quantities while the generator adds support around them."}
          {currentDeckMode === "lockExact" && "Your current cards and quantities are pinned. Lands are still rebuilt by the manabase optimizer."}
          {currentDeckMode === "redefine" && "AI rebuilds the deck from scratch with full authority. Your current deck is ignored; the AI picks every nonland card. Offline pipeline only constructs the mana base around the AI's choices."}
          {currentDeckSummary && (
            <>
              {" "}<span className="text-zinc-400">({currentDeckMode === "lockExact" ? `${currentDeckSummary.allUnique} unique / ${currentDeckSummary.allTotal} copies` : `${currentDeckSummary.nonlandUnique} unique / ${currentDeckSummary.nonlandTotal} nonland copies`})</span>
            </>
          )}
          {!currentDeckSummary && currentDeckMode !== "off" && " (deck is empty)"}
        </p>
        {currentDeckMode === "lockExact" && (
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500">
              Fuzz: allow optimizer to swap up to {seedFuzzSwaps} weak seed cop{seedFuzzSwaps === 1 ? "y" : "ies"}
            </label>
            <input
              type="range" min={0} max={20} step={1}
              value={seedFuzzSwaps}
              onChange={(e) => setSeedFuzzSwaps(Number(e.target.value))}
              className="w-full accent-teal-500"
            />
            <p className="mt-0.5 text-[11px] leading-snug text-zinc-600">
              0 = strict lock. Higher values let the optimizer drop your lowest-scoring seed copies (kept as soft preferences) and replace them with better picks.
            </p>
          </div>
        )}
      </div>

      {/* Tuning row */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Speed</label>
          <select
            value={speed}
            onChange={(e) => setSpeed(e.target.value as SpeedProfile | "")}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            <option value="">(archetype default)</option>
            <option value="fast">Fast (T1–T3)</option>
            <option value="midrange">Midrange (T3–T5)</option>
            <option value="slow">Slow (T6+)</option>
          </select>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Spell ratio</label>
          <select
            value={spellRatio}
            onChange={(e) => setSpellRatio(e.target.value as SpellRatio | "")}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          >
            <option value="">(balanced)</option>
            <option value="creature-heavy">Creature-heavy</option>
            <option value="balanced">Balanced</option>
            <option value="spell-heavy">Spell-heavy</option>
          </select>
        </div>
      </div>

      {/* Deck architecture focus */}
      <div>
        <div className="mb-1 text-xs font-medium text-zinc-400">Deck architecture / mechanical focus</div>
        <div className="space-y-2 rounded-lg border border-zinc-800 bg-zinc-950/30 p-2">
          {ARCHITECTURE_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">{group.title}</div>
              <div className="grid gap-1 sm:grid-cols-2">
                {group.items.map(({ focus, description }) => {
                  const on = keywordFocus.includes(focus);
                  return (
                    <button
                      key={focus}
                      onClick={() => toggleKeyword(focus)}
                      className={`rounded-md border p-2 text-left text-xs ${
                        on
                          ? "border-teal-400 bg-teal-600/20 text-teal-100"
                          : "border-zinc-800 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
                      }`}
                    >
                      <span className="block font-medium">{focus}</span>
                      <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">{description}</span>
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <p className="mt-1 text-[11px] text-zinc-600">
          These are strategy packages, not cosmetic tags: they drive source/payoff axes, card scoring, and per-card explanations.
        </p>
        {keywordFocus.includes("Tribal Support") && (
          <div className="mt-2 rounded-lg border border-purple-900/70 bg-purple-950/20 p-3">
            <div className="mb-2 text-xs font-medium text-purple-200">Tribal Support settings</div>
            <div className="grid grid-cols-2 gap-3">
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">Chosen tribe</label>
                <input
                  list="tribe-options"
                  value={tribalTribe}
                  onChange={(e) => setTribalTribe(e.target.value)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
                  placeholder="Human, Vampire, Zombie…"
                />
                <datalist id="tribe-options">
                  {COMMON_TRIBES.map((tribe) => <option key={tribe} value={tribe} />)}
                </datalist>
              </div>
              <div>
                <label className="mb-1 block text-[11px] text-zinc-500">Mode</label>
                <select
                  value={tribalMode}
                  onChange={(e) => setTribalMode(e.target.value as TribalSupportMode)}
                  className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
                >
                  <option value="recommended">Recommended</option>
                  <option value="exclusive">Exclusive</option>
                </select>
              </div>
            </div>
            <p className="mt-2 text-[11px] leading-snug text-zinc-500">
              <strong className="text-zinc-400">Recommended</strong> boosts the chosen tribe and tribal payoffs while allowing strong staples. <strong className="text-zinc-400">Exclusive</strong> restricts nonland candidates toward tribe cards/references, but keeps essential interaction and support so the deck remains playable.
            </p>
          </div>
        )}
      </div>

      {/* Budget */}
      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Max $/card</label>
          <input
            type="number" min={0} step="0.01"
            value={maxCardPrice}
            onChange={(e) => setMaxCardPrice(e.target.value)}
            placeholder="—"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          />
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Total budget $</label>
          <input
            type="number" min={0} step="1"
            value={totalBudget}
            onChange={(e) => setTotalBudget(e.target.value)}
            placeholder="—"
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          />
        </div>
      </div>

      {/* Optimizer + variants + sideboard */}
      <div className="grid grid-cols-4 gap-3">
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Deck size</label>
          <input
            type="number" min={60} max={80} step={1}
            value={mainboardSize}
            onChange={(e) => {
              const rules = getFormatRules(format);
              setMainboardSize(clampInteger(Number(e.target.value), rules.minMainboardSize, rules.maxMainboardSize, rules.defaultMainboardSize));
            }}
            disabled={getFormatRules(format).minMainboardSize === getFormatRules(format).maxMainboardSize}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
          />
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            {getFormatRules(format).label} default is {getFormatRules(format).defaultMainboardSize}. Higher is allowed only where the format permits it.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Variants</label>
          <select
            value={variants}
            onChange={(e) => setVariants(Number(e.target.value))}
            disabled={engine === "ai"}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs disabled:opacity-50"
          >
            <option value={1}>1</option>
            <option value={2}>2</option>
            <option value={3}>3</option>
          </select>
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            1 = fastest single result. 2–3 = alternate seeded runs with more diversity, but slower.
          </p>
        </div>
        <div>
          <label className="mb-1 block text-xs font-medium text-zinc-400">Iterations</label>
          <input
            type="number" min={0} max={2000} step={50}
            value={iterations}
            onChange={(e) => setIterations(Number(e.target.value))}
            disabled={engine === "ai"}
            className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs disabled:opacity-50"
          />
          <p className="mt-1 text-[11px] leading-snug text-zinc-600">
            0 = greedy only. 100–300 = quick refinement. 500+ = deeper but slower and can overfit scoring.
          </p>
        </div>
        <label className="flex items-end gap-2 pb-1.5 text-xs">
          <input
            type="checkbox"
            checked={generateSideboard}
            onChange={(e) => setGenSide(e.target.checked)}
            disabled={getFormatRules(format).sideboardSize == null}
            className="h-4 w-4 accent-teal-500"
          />
          Sideboard{getFormatRules(format).sideboardSize == null ? " unavailable" : ""}
        </label>
      </div>

      {engine === "ai" && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3 space-y-2">
          <div className="text-xs font-medium text-zinc-400">AI tuning</div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Temperature: {temperature.toFixed(2)}</label>
              <input
                type="range" min={0} max={1} step={0.05}
                value={temperature}
                onChange={(e) => setTemperature(Number(e.target.value))}
                className="w-full accent-teal-500"
              />
              <p className="mt-1 text-[11px] leading-snug text-zinc-600">
                Controls LLM randomness. 0.0–0.2 = nearly deterministic (best for repeatable, stapled lists). 0.3–0.5 = balanced creativity (recommended). 0.7+ = more brewing/variety but more invalid names, off-archetype picks, and JSON errors.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Digest size (pool lines)</label>
              <input
                type="number" min={50} max={500} step={10}
                value={digestLimit}
                onChange={(e) => setDigestLimit(clampInteger(Number(e.target.value), 50, 500, DEFAULT_DIGEST_LIMIT))}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
              />
              <p className="mt-1 text-[11px] leading-snug text-zinc-600">
                How many top-scored nonland candidates are shown to the LLM. Smaller (80–120) = tighter, faster, more on-archetype but may miss niche tech. Larger (250–400) = broader selection at the cost of bigger prompt and slower response.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[11px] text-zinc-500">Auto-refine iterations</label>
              <input
                type="number" min={1} max={4} step={1}
                value={aiIterations}
                onChange={(e) => setAiIterations(clampInteger(Number(e.target.value), 1, 4, 1))}
                className="w-full rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
              />
              <p className="mt-1 text-[11px] leading-snug text-zinc-600">
                1 = single shot. 2–4 = AI proposes, sees its score + weakest cards, then proposes swaps. Best-scoring pass is kept.
              </p>
            </div>
          </div>
          <div>
            <label className="mb-1 block text-[11px] text-zinc-500">User context / instructions</label>
            <textarea
              value={userContext}
              onChange={(e) => setUserContext(e.target.value)}
              rows={4}
              placeholder="Example: Keep the deck close to my current shell, preserve mana rocks, improve removal, avoid expensive staples, tune for creature-heavy meta…"
              className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs"
            />
            <p className="mt-1 text-[11px] leading-snug text-zinc-600">
              Sent directly to the LLM with the generated prompt. Use this for playstyle, meta notes, pet cards, cards to preserve, or constraints the controls do not capture.
            </p>
          </div>
          <label className="flex items-start gap-2 rounded-md border border-zinc-800 bg-zinc-900/60 p-2 text-xs">
            <input
              type="checkbox"
              checked={lockAIPicks}
              onChange={(e) => setLockAIPicks(e.target.checked)}
              className="mt-0.5 accent-teal-500"
            />
            <span>
              <span className="font-medium text-zinc-200">Lock AI picks (spine)</span>
              <span className="mt-0.5 block text-[11px] leading-snug text-zinc-500">
                {lockAIPicks
                  ? "On (recommended): the AI's nonland picks and the quantities it requests are locked as the deck spine. The offline optimizer only gap-fills the remaining slots (lands, curve fill, removal) and never removes or reduces an AI pick."
                  : "Off: the AI's picks are treated as strong soft preferences. The offline optimizer is free to swap weaker AI choices for higher-scoring cards."}
              </span>
            </span>
          </label>
          <button
            onClick={onPreviewPrompt}
            className="w-full rounded-md border border-teal-700 bg-teal-600/10 px-3 py-1.5 text-xs text-teal-200 hover:bg-teal-600/20"
          >
            Preview prompt
          </button>
        </div>
      )}

      <div className="grid grid-cols-1 gap-2">
        <button
          onClick={onGenerate}
          disabled={busy}
          className="w-full rounded-lg bg-teal-600 px-4 py-2 text-sm font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
        >
          {busy ? "Generating…" : "Generate Deck"}
        </button>
        {busy && (
          <button
            onClick={onCancel}
            className="w-full rounded-lg border border-red-800 bg-red-950/30 px-4 py-2 text-sm font-medium text-red-200 hover:bg-red-950/50"
          >
            Cancel generation
          </button>
        )}
      </div>

      {busy && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-950/60 p-2">
          <div className="mb-1 flex items-center justify-between text-[11px] font-medium text-zinc-400">
            <span>
              {engine === "ai"
                ? `${currentPass && currentPass.total > 1 ? `Pass ${currentPass.pass}/${currentPass.total} · ` : ""}${streamedText ? "Streaming tokens…" : "Waiting for first token…"}`
                : "Optimizing deck…"}
            </span>
            <span className="font-mono text-zinc-500">
              {(elapsedMs / 1000).toFixed(1)}s
              {streamedText
                ? ` · ${streamedText.length} chars · ${elapsedMs > 0 ? Math.round((streamedText.length / elapsedMs) * 1000) : 0} c/s`
                : ""}
            </span>
          </div>
          {engine === "ai" && streamedText && (
            <pre className="max-h-48 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-300">
              {streamedText}
            </pre>
          )}
        </div>
      )}

      {error && (
        <div className="rounded-lg border border-red-800 bg-red-950/40 p-3 text-xs text-red-200">
          {error}
        </div>
      )}

      {results.length > 1 && (
        <div className="flex gap-1.5">
          {results.map((r, i) => (
            <button
              key={i}
              onClick={() => switchVariant(i)}
              className={`flex-1 rounded-md border px-2 py-1 text-xs ${
                i === activeIdx
                  ? "border-teal-400 bg-teal-600/20 text-teal-200"
                  : "border-zinc-700 bg-zinc-900 text-zinc-400 hover:bg-zinc-800"
              }`}
            >
              Variant {i + 1} · {r.diagnostics.deckScore.toFixed(0)}
            </button>
          ))}
        </div>
      )}

      {active && (active.aiSummary || active.aiGamePlan) && (
        <div className="rounded-lg border border-teal-900/70 bg-teal-950/20 p-3 text-xs">
          <div className="mb-1 text-[11px] font-semibold uppercase tracking-wide text-teal-300">LLM summary</div>
          {active.aiSummary && (
            <p className="text-zinc-200 leading-snug">{active.aiSummary}</p>
          )}
          {active.aiGamePlan && (
            <>
              <div className="mt-2 text-[11px] font-semibold uppercase tracking-wide text-teal-300">Game plan</div>
              <p className="text-zinc-200 leading-snug">{active.aiGamePlan}</p>
            </>
          )}
        </div>
      )}

      {active && (
        <div className="rounded-lg border border-zinc-800 bg-zinc-900/50 p-3 text-xs">
          <div className="mb-2 grid grid-cols-2 gap-x-4 gap-y-1 text-zinc-300">
            <div>Score: <strong className="text-teal-300">{active.diagnostics.deckScore.toFixed(1)}</strong></div>
            <div>Cards: {active.totalCards}</div>
            <div>Curve dev: {active.diagnostics.curveDeviation.toFixed(2)}</div>
            <div>Mana cov: {(active.diagnostics.manaBaseCoverage * 100).toFixed(0)}%</div>
            <div>Optimizer: {active.diagnostics.optimizerSteps} steps</div>
            <div>Seeded: {active.seededCards.length}</div>
            <div>Focused: {active.focusedCards.length}</div>
            <div>Card subtotal: {active.scoreBreakdown.totals.cardScoreSum.toFixed(1)}</div>
            <div>Penalties: -{(active.scoreBreakdown.totals.curvePenalty + active.scoreBreakdown.totals.manaPenalty).toFixed(1)}</div>
            <div className="col-span-2">
              Axes: {active.diagnostics.primaryAxes.length ? active.diagnostics.primaryAxes.join(", ") : "none"}
            </div>
          </div>
          <details className="mb-2">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Score breakdown</summary>
            <div className="mt-2 space-y-2">
              <div className="grid grid-cols-2 gap-2 text-[11px] text-zinc-400">
                <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                  Card score subtotal: <strong className="text-teal-300">{active.scoreBreakdown.totals.cardScoreSum.toFixed(1)}</strong>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                  Final score: <strong className="text-teal-300">{active.scoreBreakdown.totals.finalScore.toFixed(1)}</strong>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                  Curve penalty: <strong className="text-red-300">-{active.scoreBreakdown.totals.curvePenalty.toFixed(1)}</strong>
                </div>
                <div className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                  Mana penalty: <strong className="text-red-300">-{active.scoreBreakdown.totals.manaPenalty.toFixed(1)}</strong>
                </div>
              </div>
              <div>
                <div className="mb-1 text-[11px] font-medium text-zinc-500">Top card contributors</div>
                <div className="space-y-1.5">
                  {active.scoreBreakdown.cardScores
                    .filter((score) => score.board === "main")
                    .slice(0, 12)
                    .map((score) => (
                      <div key={score.oracleId} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                        <div className="flex items-center justify-between gap-2">
                          <span className="font-medium text-zinc-200">{score.quantity}× {score.name}</span>
                          <span className="text-teal-300">+{score.contribution.toFixed(1)} total · {score.perCopyScore.toFixed(1)} each</span>
                        </div>
                        <div className="mt-1 text-[11px] leading-snug text-zinc-500">
                          role×power +{score.rolePowerContribution.toFixed(1)} ({score.roleMultiplier.toFixed(1)}×{score.powerScore.toFixed(1)}) · synergy +{score.synergyContribution.toFixed(1)} · directional +{score.directionalContribution.toFixed(1)} · signal +{score.signalContribution.toFixed(1)}
                          {score.efficiencyContribution ? ` · efficiency +${score.efficiencyContribution.toFixed(1)}` : ""}
                          {score.flexibilityContribution ? ` · flexibility +${score.flexibilityContribution.toFixed(1)}` : ""}
                          {score.ladderContribution ? ` · ladder +${score.ladderContribution.toFixed(1)}` : ""}
                          {score.focusCardBonus ? ` · focus card +${score.focusCardBonus.toFixed(1)}` : ""}
                          {(score.focusBonus || score.tribalBonus) ? ` · focus/tribal +${(score.focusBonus + score.tribalBonus).toFixed(1)}` : ""}
                          {(score.cmcPenalty || score.pricePenalty) ? ` · penalties -${(score.cmcPenalty + score.pricePenalty).toFixed(1)}` : ""}
                        </div>
                      </div>
                    ))}
                </div>
              </div>
            </div>
          </details>
          <details className="mb-2">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Why these cards?</summary>
            <div className="mt-2 space-y-2">
              {active.entries
                .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
                .map((entry) => (
                  <div key={entry.card.oracleId} className="rounded border border-zinc-800 bg-zinc-950/60 p-2">
                    <div className="mb-1 font-medium text-zinc-200">
                      {entry.quantity}× {entry.card.name}
                    </div>
                    <ul className="space-y-0.5 text-[11px] text-zinc-500">
                      {(active.cardReasons[entry.card.oracleId] ?? ["Selected by optimizer scoring."])
                        .slice(0, 4)
                        .map((reason, i) => <li key={i}>• {reason}</li>)}
                    </ul>
                  </div>
                ))}
            </div>
          </details>
          <details>
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Reasoning log</summary>
            <ul className="mt-2 space-y-0.5 font-mono text-[11px] text-zinc-500">
              {active.diagnostics.reasoning.map((line, i) => <li key={i}>{line}</li>)}
            </ul>
          </details>
        </div>
      )}

      {rawResponse && active && (() => {
        const v = validateAIResponse(rawResponse, active);
        return (
          <details open className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-xs">
            <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">
               AI validation: {v.ok ? <span className="text-teal-300">PASS</span> : <span className="text-amber-300">{v.issues.length} issue{v.issues.length === 1 ? "" : "s"}</span>}
              {" · "}nonland core {v.requestedMain}{v.targetMain > 0 ? ` / target ${v.targetMain}` : ""} (resolved {v.resolvedMain})
              {v.requestedSide > 0 ? ` · side ${v.resolvedSide}/${v.requestedSide}` : ""}
            </summary>
            <div className="mt-2 space-y-1 text-[11px] text-zinc-400">
              {v.issues.length === 0 && <div className="text-teal-300">All requested cards resolved at the requested quantities.</div>}
              {v.issues.map((iss, i) => <div key={i}>• {iss}</div>)}
              {v.unresolvedNames.length > 0 && (
                <div>
                  <div className="mt-1 font-medium text-zinc-300">Unresolved names ({v.unresolvedNames.length}):</div>
                  <div className="font-mono text-[11px] text-zinc-500">{v.unresolvedNames.join(", ")}</div>
                </div>
              )}
              {v.cappedNames.length > 0 && (
                <div>
                  <div className="mt-1 font-medium text-zinc-300">Quantity-capped ({v.cappedNames.length}):</div>
                  <div className="font-mono text-[11px] text-zinc-500">{v.cappedNames.join(", ")}</div>
                </div>
              )}
            </div>
          </details>
        );
      })()}

      {rawResponse && (
        <details className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-2 text-xs">
          <summary className="cursor-pointer text-zinc-400 hover:text-zinc-200">Raw AI response ({rawResponse.length} chars)</summary>
          <pre className="mt-2 max-h-72 overflow-auto whitespace-pre-wrap break-words font-mono text-[11px] text-zinc-400">
            {rawResponse}
          </pre>
        </details>
      )}

      {engine === "ai" && aiTranscript && active && (
        <div className="rounded-lg border border-teal-900/70 bg-teal-950/10 p-3 text-xs space-y-2">
          <div className="flex items-center justify-between">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-teal-300">Chat with AI · refine deck</div>
            <span className="text-[10px] text-zinc-500">{chatHistory.length} message{chatHistory.length === 1 ? "" : "s"}</span>
          </div>
          <p className="text-[11px] leading-snug text-zinc-500">
            Comment on the deck (e.g. "swap in more removal", "cut the 5-drops", "add a wincon for control matchups") and the AI will regenerate using the full conversation context. The offline pipeline still rebuilds the mana base around the AI's picks.
          </p>
          {chatHistory.length > 0 && (
            <div className="max-h-64 space-y-1.5 overflow-auto rounded border border-zinc-800 bg-zinc-950/60 p-2">
              {chatHistory.map((msg, i) => (
                <div
                  key={i}
                  className={`rounded p-1.5 text-[11px] leading-snug ${
                    msg.role === "user"
                      ? "border border-zinc-700 bg-zinc-900 text-zinc-200"
                      : "border border-teal-900/60 bg-teal-950/30 text-teal-100"
                  }`}
                >
                  <div className="mb-0.5 text-[10px] font-semibold uppercase tracking-wide opacity-60">
                    {msg.role === "user" ? "You" : "AI"}
                  </div>
                  {msg.text}
                </div>
              ))}
            </div>
          )}
          <textarea
            value={chatInput}
            onChange={(e) => setChatInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && (e.ctrlKey || e.metaKey) && !busy) {
                e.preventDefault();
                onChatSend();
              }
            }}
            placeholder="Feedback for the AI (Ctrl+Enter to send)…"
            rows={3}
            disabled={busy}
            className="w-full resize-y rounded-md border border-zinc-700 bg-zinc-900 px-2 py-1.5 text-xs disabled:opacity-50"
          />
          <button
            onClick={onChatSend}
            disabled={busy || !chatInput.trim()}
            className="w-full rounded-md bg-teal-600 px-3 py-1.5 text-xs font-medium text-white hover:bg-teal-500 disabled:cursor-not-allowed disabled:opacity-60"
          >
            {busy ? "Refining…" : "Send & Regenerate"}
          </button>
        </div>
      )}

      {drawerOpen && <AISettingsDrawer onClose={() => setDrawerOpen(false)} />}

      {previewPrompts && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
          onClick={() => setPreviewPrompts(null)}
        >
          <div
            className="max-h-[90vh] w-full max-w-3xl overflow-auto rounded-lg border border-zinc-700 bg-zinc-950 p-4"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <div className="text-sm font-medium text-zinc-200">Prompt preview (pool size: {previewPrompts.poolSize})</div>
              <div className="flex gap-2">
                <button
                  onClick={() => navigator.clipboard?.writeText(`SYSTEM:\n${previewPrompts.system}\n\nUSER:\n${previewPrompts.user}`)}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Copy
                </button>
                <button
                  onClick={() => setPreviewPrompts(null)}
                  className="rounded-md border border-zinc-700 px-2 py-1 text-xs text-zinc-300 hover:bg-zinc-800"
                >
                  Close
                </button>
              </div>
            </div>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">System</div>
            <pre className="mb-3 max-h-48 overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] text-zinc-300">
              {previewPrompts.system}
            </pre>
            <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-zinc-500">User</div>
            <pre className="max-h-[50vh] overflow-auto whitespace-pre-wrap break-words rounded border border-zinc-800 bg-zinc-900 p-2 font-mono text-[11px] text-zinc-300">
              {previewPrompts.user}
            </pre>
          </div>
        </div>
      )}
    </div>
  );
}

interface AIValidation {
  ok: boolean;
  targetMain: number;
  requestedMain: number;
  resolvedMain: number;
  requestedSide: number;
  resolvedSide: number;
  unresolvedNames: string[];
  cappedNames: string[];
  issues: string[];
}

function validateAIResponse(raw: string, result: GenerateResult): AIValidation {
  const issues: string[] = [];
  const unresolvedNames: string[] = [];
  const cappedNames: string[] = [];
  let requestedMain = 0;
  let requestedSide = 0;
  let targetMain = 0;
  const requested: { name: string; qty: number; board: "main" | "side" }[] = [];

  const stripped = raw.replace(/^```(?:json)?\s*/i, "").replace(/```\s*$/i, "").trim();
  type RawLine = { name?: string; quantity?: number; qty?: number };
  let parsed:
    | {
        main?: RawLine[];
        side?: RawLine[];
        mainboard?: RawLine[];
        sideboard?: RawLine[];
        target_main_count?: number;
      }
    | null = null;
  try {
    parsed = JSON.parse(stripped);
  } catch (err) {
    // Truncated/malformed JSON — salvage what we can and surface as a warning,
    // not a fatal error, so the user can still see resolved counts.
    const salvaged = salvageDeckJSON(stripped);
    if (salvaged.main.length === 0 && salvaged.side.length === 0) {
      return {
        ok: false,
        targetMain: 0,
        requestedMain: 0,
        resolvedMain: result.entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0),
        requestedSide: 0,
        resolvedSide: result.entries.filter((e) => e.board === "side").reduce((s, e) => s + e.quantity, 0),
        unresolvedNames: [],
        cappedNames: [],
        issues: [`Failed to parse AI JSON (${err instanceof Error ? err.message : String(err)}) and no entries were salvageable.`],
      };
    }
    parsed = { main: salvaged.main, side: salvaged.side };
    issues.push(`AI JSON was truncated/malformed (${err instanceof Error ? err.message : String(err)}); salvaged ${salvaged.main.length} main / ${salvaged.side.length} side entries via regex.`);
  }
  targetMain = result.entries
    .filter((e) => e.board === "main" && !e.card.typeLine.includes("Land"))
    .reduce((s, e) => s + e.quantity, 0);
  for (const e of parsed?.main ?? parsed?.mainboard ?? []) {
    const qty = Number(e.qty ?? e.quantity) || 0;
    requested.push({ name: String(e.name ?? ""), qty, board: "main" });
    requestedMain += qty;
  }
  for (const e of parsed?.side ?? parsed?.sideboard ?? []) {
    const qty = Number(e.qty ?? e.quantity) || 0;
    requested.push({ name: String(e.name ?? ""), qty, board: "side" });
    requestedSide += qty;
  }

  // Use fuzzy resolution: exact name → prefix → substring (matches resolver.ts) so
  // the validator agrees with what the generator actually built.
  const resolvedByExact = new Map<string, { qty: number; board: "main" | "side" }>();
  const resolvedList: { name: string; lower: string; qty: number; board: "main" | "side" }[] = [];
  for (const entry of result.entries) {
    const lower = entry.card.name.toLowerCase();
    const rec = { qty: entry.quantity, board: entry.board };
    resolvedByExact.set(`${entry.board}::${lower}`, rec);
    resolvedList.push({ name: entry.card.name, lower, qty: entry.quantity, board: entry.board });
  }
  const findResolved = (name: string, board: "main" | "side") => {
    const lower = name.trim().toLowerCase();
    if (!lower) return undefined;
    const exact = resolvedByExact.get(`${board}::${lower}`);
    if (exact) return exact;
    const front = lower.split(/\s*\/\/\s*/)[0];
    const pre = resolvedList.find((r) => r.board === board && (r.lower.startsWith(lower) || (front && r.lower.startsWith(front))));
    if (pre) return { qty: pre.qty, board: pre.board };
    const sub = resolvedList.find((r) => r.board === board && r.lower.includes(lower));
    return sub ? { qty: sub.qty, board: sub.board } : undefined;
  };
  let resolvedMain = 0;
  let resolvedSide = 0;
  for (const r of requested) {
    const hit = findResolved(r.name, r.board);
    if (!hit) {
      if (r.name) unresolvedNames.push(`${r.qty}× ${r.name}`);
      continue;
    }
    if (r.board === "main") resolvedMain += Math.min(hit.qty, r.qty);
    else resolvedSide += Math.min(hit.qty, r.qty);
    if (hit.qty < r.qty) cappedNames.push(`${r.name} (${hit.qty}/${r.qty})`);
  }

  const minCore = Math.max(1, Math.floor(result.totalCards * 0.55));
  const maxCore = Math.max(minCore, Math.ceil(result.totalCards * 0.65));
  if (requestedMain > 0 && (requestedMain < minCore || requestedMain > maxCore)) {
    issues.push(`Requested nonland core total ${requestedMain} is outside expected ${minCore}-${maxCore}.`);
  }
  if (unresolvedNames.length > 0) issues.push(`${unresolvedNames.length} card name(s) not found in pool.`);
  if (cappedNames.length > 0) issues.push(`${cappedNames.length} card(s) capped to legal quantity.`);
  const finalMain = result.entries.filter((e) => e.board === "main").reduce((s, e) => s + e.quantity, 0);
  if (finalMain !== result.totalCards) {
    issues.push(`Final mainboard size ${finalMain} ≠ generated total ${result.totalCards}.`);
  }

  return {
    ok: issues.length === 0,
    targetMain,
    requestedMain,
    resolvedMain,
    requestedSide,
    resolvedSide,
    unresolvedNames,
    cappedNames,
    issues,
  };
}

function parsePositiveFloat(s: string): number | undefined {
  const n = Number(s);
  return Number.isFinite(n) && n > 0 ? n : undefined;
}

function clampInteger(value: number, min: number, max: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.max(min, Math.min(max, Math.round(value)));
}

function isAbortError(e: unknown): boolean {
  return e instanceof DOMException && (e.name === "AbortError" || e.name === "TimeoutError");
}

function detectDeckColors(entries: ReturnType<typeof useMainboardEntries>): ManaColor[] {
  const ordered: ManaColor[] = ["W", "U", "B", "R", "G"];
  const found = new Set<ManaColor>();
  for (const entry of entries.filter((e) => e.board === "main")) {
    try {
      const identity = JSON.parse(entry.card.colorIdentityJson) as ManaColor[];
      for (const color of identity) found.add(color);
    } catch {
      /* ignore malformed identity */
    }
  }
  return ordered.filter((color) => found.has(color));
}

function detectSpeed(nonlands: ReturnType<typeof useMainboardEntries>): SpeedProfile {
  const total = nonlands.reduce((sum, entry) => sum + entry.quantity, 0);
  if (total === 0) return "midrange";
  let cheap = 0;
  let fourPlus = 0;
  let fivePlus = 0;
  for (const entry of nonlands) {
    if (entry.card.cmc <= 2) cheap += entry.quantity;
    if (entry.card.cmc >= 4) fourPlus += entry.quantity;
    if (entry.card.cmc >= 5) fivePlus += entry.quantity;
  }
  const cheapShare = cheap / total;
  const fourPlusShare = fourPlus / total;
  const fivePlusShare = fivePlus / total;
  if (cheapShare >= 0.4 && fivePlusShare <= 0.15) return "fast";
  if (fivePlusShare >= 0.25 || (fourPlusShare >= 0.2 && cheapShare <= 0.25)) return "slow";
  return "midrange";
}

function detectSpellRatio(nonlands: ReturnType<typeof useMainboardEntries>): SpellRatio {
  const total = nonlands.reduce((sum, entry) => sum + entry.quantity, 0);
  const creatures = nonlands
    .filter((entry) => entry.card.typeLine.includes("Creature"))
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const creatureShare = total > 0 ? creatures / total : 0.5;
  if (creatureShare >= 0.62) return "creature-heavy";
  if (creatureShare <= 0.38) return "spell-heavy";
  return "balanced";
}

function detectPrimaryArchetype(
  nonlands: ReturnType<typeof useMainboardEntries>,
  axes: string[],
  deckSpeed: SpeedProfile,
  deckColors: ManaColor[],
): Archetype {
  const roleCounts = countRoles(nonlands);
  const total = nonlands.reduce((sum, entry) => sum + entry.quantity, 0);
  const threatShare = total > 0 ? roleCounts.threats / total : 0;
  const interaction = roleCounts.removal + roleCounts.counterspells + roleCounts.boardWipes;
  const highCmcCount = nonlands.filter((entry) => entry.card.cmc >= 4).reduce((sum, entry) => sum + entry.quantity, 0);
  const avgCmc = total > 0 ? nonlands.reduce((sum, entry) => sum + entry.card.cmc * entry.quantity, 0) / total : 3;
  const primaryAxis = axes[0];

  // Axis-first evaluation: mechanical signals are more reliable than role-count heuristics
  if (primaryAxis === "sacrifice") return "Sacrifice";
  if (primaryAxis === "tokens") return "Tokens";
  if (primaryAxis === "graveyard" || primaryAxis === "selfMill") return "Graveyard";
  if (primaryAxis === "mill") return "Control";

  // Axis-guided archetype matches with role count guards
  if (axes.includes("spellslinger") && roleCounts.counterspells >= 3 && deckSpeed === "fast") return "Tempo";
  if (axes.includes("spellslinger") && deckSpeed === "fast" && deckColors.includes("R") && roleCounts.removal >= 4) return "Burn";
  if ((roleCounts.cardDraw >= 6 && axes.includes("draw")) || (roleCounts.tutor >= 2 && roleCounts.cardDraw >= 4)) return "Combo";

  // Speed + role-count heuristics (only when axes don't clearly indicate an archetype)
  if (deckSpeed === "fast" && threatShare >= 0.55 && roleCounts.threats >= interaction * 1.5) return "Aggro";
  if ((deckSpeed === "slow" || highCmcCount / Math.max(1, total) >= 0.2) && interaction >= 7) return "Control";

  // Ramp needs strong signal — raised threshold to avoid false positives from incidental mana rocks
  if (roleCounts.ramp >= 10 && avgCmc >= 3.2) return "Ramp";

  return "Midrange";
}

function detectSecondaryArchetypes(
  primary: Archetype,
  nonlands: ReturnType<typeof useMainboardEntries>,
  axes: string[],
): Archetype[] {
  const suggestions = new Set<Archetype>();
  const roleCounts = countRoles(nonlands);
  if (axes.includes("tokens") && primary !== "Tokens") suggestions.add("Tokens");
  if (axes.includes("sacrifice") && primary !== "Sacrifice") suggestions.add("Sacrifice");
  if ((axes.includes("graveyard") || axes.includes("selfMill")) && primary !== "Graveyard") suggestions.add("Graveyard");
  if (axes.includes("spellslinger") && roleCounts.counterspells >= 2 && primary !== "Tempo") suggestions.add("Tempo");
  if (roleCounts.ramp >= 6 && primary !== "Ramp") suggestions.add("Ramp");
  if (roleCounts.boardWipes + roleCounts.counterspells >= 6 && primary !== "Control") suggestions.add("Control");
  return [...suggestions].filter((a) => a !== primary && ROLE_ARCHETYPES.includes(a)).slice(0, 3);
}

/** Count how many unique nonland cards match the given regex on their oracle+type+keyword text. */
function countMatchingCards(nonlands: ReturnType<typeof useMainboardEntries>, regex: RegExp): number {
  let count = 0;
  for (const entry of nonlands) {
    const haystack = `${entry.card.oracleText ?? ""} ${entry.card.typeLine} ${entry.card.keywordsJson}`;
    if (regex.test(haystack)) count++;
  }
  return count;
}

function detectKeywordFocus(nonlands: ReturnType<typeof useMainboardEntries>, axes: string[]): KeywordFocus[] {
  const focus = new Set<KeywordFocus>();
  if (axes.includes("tokens")) focus.add("Go-Wide Tokens");
  if (axes.includes("sacrifice")) focus.add("Sacrifice");
  if (axes.includes("graveyard")) focus.add("Graveyard");
  if (axes.includes("selfMill")) focus.add("Graveyard");
  if (axes.includes("mill")) focus.add("Mill");
  if (axes.includes("lifegain")) focus.add("Lifegain");
  if (axes.includes("counters")) focus.add("+1/+1 Counters");
  if (axes.includes("discard")) focus.add("Discard");
  if (axes.includes("discard") && countRoles(nonlands).removal + countRoles(nonlands).counterspells >= 2) focus.add("Hand Disruption");
  if (axes.includes("spellslinger")) focus.add("Spellslinger");
  if (axes.includes("blink") || axes.includes("etb")) focus.add("ETB/Blink");
  if (axes.includes("enchantress")) focus.add("Enchantress");
  if (axes.includes("tribal") || detectTribe(nonlands)) focus.add("Tribal Support");

  // Path B: regex-based checks with minimum card-count thresholds.
  // These prevent single incidental cards (e.g. one mana rock, one "noncreature" text)
  // from triggering themes that aren't actually present in the deck.

  // Prowess — remove "noncreature" which is generic MTG templating, not Prowess
  if (countMatchingCards(nonlands, /\bprowess\b/i) >= 3) focus.add("Prowess");

  // Flying
  if (countMatchingCards(nonlands, /\bflying\b/i) >= 4) focus.add("Flying");

  // Trample / Stompy
  if (countMatchingCards(nonlands, /\btrample\b/i) >= 4) focus.add("Trample");

  // Artifacts — require \bartifact\b word boundary to avoid matching "artifacts" in flavor text
  if (countMatchingCards(nonlands, /\bartifact\b/i) >= 4) focus.add("Artifacts");

  // Voltron/Auras
  if (countMatchingCards(nonlands, /aura|equip|enchanted creature|equipped creature/i) >= 3) focus.add("Voltron/Auras");

  // Draw-Go Control
  if (countMatchingCards(nonlands, /counter target|flash|instant/i) >= 3 && countRoles(nonlands).counterspells >= 2) {
    focus.add("Draw-Go Control");
  }

  // Flash/Draw-Go
  if (countMatchingCards(nonlands, /\bflash\b|as though.*flash|instant/i) >= 3 && countRoles(nonlands).counterspells + countRoles(nonlands).removal >= 4) {
    focus.add("Flash/Draw-Go");
  }

  // Self-Discard/Looting
  if (countMatchingCards(nonlands, /you may discard|discard a card|draw.*discard|discard.*draw|loot|rummage/i) >= 3) {
    focus.add("Self-Discard/Looting");
  }

  // Artifacts/Tokens
  if (countMatchingCards(nonlands, /treasure token|clue token|food token|map token|artifact token/i) >= 3) {
    focus.add("Artifacts/Tokens");
  }

  // Evasion Tempo
  if (countMatchingCards(nonlands, /\bflying\b|\bmenace\b|can't be blocked|unblockable/i) >= 3
      && countRoles(nonlands).counterspells + countRoles(nonlands).removal >= 3) {
    focus.add("Evasion Tempo");
  }

  const roles = countRoles(nonlands);
  if (roles.ramp >= 6) focus.add("Ramp");
  if (roles.ramp >= 8) focus.add("Big Mana");

  return prioritizeKeywordFocus([...focus]).slice(0, 6);
}

function detectTribe(nonlands: ReturnType<typeof useMainboardEntries>): string | null {
  const counts = new Map<string, number>();
  for (const entry of nonlands) {
    if (!entry.card.typeLine.includes("Creature")) continue;
    const subtypes = parseCreatureTypes(entry.card.typeLine);
    for (const subtype of subtypes) {
      const normalized = normalizeTribe(subtype);
      if (!normalized) continue;
      counts.set(normalized, (counts.get(normalized) ?? 0) + entry.quantity);
    }
  }
  const totalCreatures = nonlands
    .filter((entry) => entry.card.typeLine.includes("Creature"))
    .reduce((sum, entry) => sum + entry.quantity, 0);
  const best = [...counts.entries()].sort((a, b) => b[1] - a[1])[0];
  if (!best || best[1] < 6 || best[1] / Math.max(1, totalCreatures) < 0.35) return null;
  return best[0][0].toUpperCase() + best[0].slice(1);
}

function parseCreatureTypes(typeLine: string): string[] {
  const [, subtypes = ""] = typeLine.split(/[—-]/, 2);
  return subtypes.split(/\s+/).map((s) => s.trim()).filter(Boolean);
}

function prioritizeKeywordFocus(focuses: KeywordFocus[]): KeywordFocus[] {
  const priority: KeywordFocus[] = [
    "Tribal Support", "Go-Wide Tokens", "Sacrifice", "Aristocrats", "Graveyard", "Reanimator", "Mill",
    "Spellslinger", "Prowess", "Draw-Go Control", "Flash/Draw-Go", "ETB/Blink", "Enchantress",
    "Artifacts/Tokens", "Artifacts", "Lifegain", "+1/+1 Counters", "Counters", "Discard",
    "Hand Disruption", "Self-Discard/Looting", "Ramp", "Big Mana", "Voltron/Auras", "Stompy",
    "Flying", "Trample", "Evasion Tempo", "Tokens",
  ];
  return focuses.sort((a, b) => priority.indexOf(a) - priority.indexOf(b));
}

function countRoles(nonlands: ReturnType<typeof useMainboardEntries>) {
  const counts = { threats: 0, removal: 0, boardWipes: 0, counterspells: 0, cardDraw: 0, ramp: 0, tutor: 0 };
  for (const entry of nonlands) {
    const roles = assignRoles(entry.card);
    const buckets = [
      isThreat(roles) ? "threats" : null,
      roles.includes("Removal") ? "removal" : null,
      roles.includes("BoardWipe") ? "boardWipes" : null,
      roles.includes("Counterspell") ? "counterspells" : null,
      roles.includes("CardDraw") ? "cardDraw" : null,
      roles.includes("Ramp") ? "ramp" : null,
      roles.includes("Tutor") ? "tutor" : null,
    ].filter(Boolean) as (keyof typeof counts)[];
    const weight = entry.quantity / Math.max(1, buckets.length);
    for (const bucket of buckets) counts[bucket] += weight;
  }
  return counts;
}