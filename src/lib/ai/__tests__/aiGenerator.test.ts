import { describe, expect, it, vi, afterEach } from "vitest";
import type { CardRecord } from "../../types";
import type { GenerateOptions } from "../../generator/types";
import { buildAIPrompts, buildDeltaDigest, clampAINonlandSpine, salvageDeckJSON, validateAIProposal, SEQUENTIAL_DELTA_CANDIDATE_LIMIT } from "../aiGenerator";
import { OllamaProvider } from "../ollama";

function makeCard(overrides: Partial<CardRecord> & { name: string; typeLine?: string; oracleText?: string }): CardRecord {
  const { name, ...rest } = overrides;
  return {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: overrides.manaCost ?? "{1}{G}",
    cmc: overrides.cmc ?? 2,
    colorsJson: JSON.stringify(["G"]),
    colorIdentityJson: JSON.stringify(["G"]),
    typeLine: overrides.typeLine ?? "Creature — Beast",
    oracleText: overrides.oracleText ?? "Trample.",
    keywordsJson: "[]",
    power: null,
    toughness: null,
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
    legalitiesJson: JSON.stringify({ standard: "legal" }),
    setCode: "TST",
    setName: "Test",
    setType: null,
    collectorNumber: null,
    rarity: null,
    imageNormal: null,
    priceUsd: null,
    priceUsdFoil: null,
    priceEur: null,
    edhrecRank: null,
    gameChanger: 0,
    flavorText: null,
    artist: null,
    searchText: "",
    importedAt: "",
    ...rest,
  } as CardRecord;
}

const options: GenerateOptions = {
  engine: "ai",
  format: "standard",
  archetype: "Midrange",
  colors: ["G"],
  mainboardSize: 60,
  maxMainboardSize: 60,
};

afterEach(() => {
  vi.restoreAllMocks();
});

describe("AI prompt generation", () => {
  it("asks for a nonland core instead of a full 60-card mainboard", () => {
    const prompts = buildAIPrompts(options, [makeCard({ name: "Test Beast" })], 10);

    expect(prompts.system).toContain("Build ONLY the NONLAND core");
    expect(prompts.system).toContain("do NOT return a full 60-card mainboard");
    expect(prompts.user).toContain("Your JSON main[] target: 33-39 nonland cards only");
    expect(prompts.user).not.toContain("Mainboard size: exactly 60 cards");
  });

  it("includes user context and summarizes preferred cards", () => {
    const preferred = Array.from({ length: 8 }, (_, i) => ({
      card: makeCard({ name: `Preferred Card ${i + 1}` }),
      quantity: 1,
      board: "main" as const,
    }));
    const prompts = buildAIPrompts(
      { ...options, preferEntries: preferred, userContext: "Preserve mana rocks and keep the shell close." },
      preferred.map((e) => e.card),
      10
    );

    expect(prompts.user).toContain("User context / instructions: Preserve mana rocks and keep the shell close.");
    expect(prompts.user).toContain("Current preferred deck context: 8 unique / 8 copies");
    expect(prompts.user).toContain("+2 more");
    expect(prompts.user).toContain("Prefer preserving important support pieces and mana rocks");
  });

  it("omits current-deck context cards that are outside the selected pool", () => {
    const inPool = makeCard({ name: "In Pool Card", colorIdentityJson: JSON.stringify(["G"]) });
    const outOfPool = makeCard({ name: "Out Of Pool Card", colorIdentityJson: JSON.stringify(["R"]) });
    const prompts = buildAIPrompts(
      {
        ...options,
        colors: ["G"],
        preferEntries: [
          { card: inPool, quantity: 1, board: "main" },
          { card: outOfPool, quantity: 1, board: "main" },
        ],
      },
      [inPool, outOfPool],
      10
    );

    expect(prompts.user).toContain("1x In Pool Card");
    expect(prompts.user).not.toContain("1x Out Of Pool Card");
    expect(prompts.user).toContain("omitted 1 out-of-pool card");
  });

  it("passes score components to the LLM instead of only an opaque total", () => {
    const prompts = buildAIPrompts(options, [makeCard({ name: "Synergy Beast", oracleText: "Create a 1/1 green Saproling creature token." })], 10);

    expect(prompts.system).toContain("score(total=...,power=...,syn=...");
    expect(prompts.system).toContain("do not blindly pick raw-power cards");
    expect(prompts.user).toContain("score(total,power,syn,role,utility,pen,mult,tags)");
    expect(prompts.user).toMatch(/Synergy Beast .*score\(total=.+power=.+syn=.+mult=.+tags=/);
  });

  describe("deck card prioritization", () => {
    it("places user's deck cards under a 'YOUR DECK' section label", () => {
      const deckCard = makeCard({ name: "My Deck Card" });
      const prompts = buildAIPrompts(
        { ...options, seedEntries: [{ card: deckCard, quantity: 2, board: "main" }] },
        [deckCard],
        10
      );

      expect(prompts.user).toContain("=== YOUR DECK");
      expect(prompts.user).toContain("My Deck Card");
    });

    it("places non-deck pool cards under a 'CANDIDATES' section label", () => {
      const prompts = buildAIPrompts(options, [makeCard({ name: "Pool Card Only" })], 10);

      expect(prompts.user).toContain("=== CANDIDATES");
      expect(prompts.user).toContain("Pool Card Only");
      expect(prompts.user).not.toContain("=== YOUR DECK");
    });

    it("includes both YOUR DECK and CANDIDATES sections when both deck cards and pool cards exist", () => {
      const deckCard = makeCard({ name: "My Seed Card" });
      const poolCard = makeCard({ name: "Pool Suggestion" });
      const prompts = buildAIPrompts(
        { ...options, seedEntries: [{ card: deckCard, quantity: 1, board: "main" }] },
        [deckCard, poolCard],
        10
      );

      expect(prompts.user).toContain("=== YOUR DECK");
      expect(prompts.user).toContain("My Seed Card");
      expect(prompts.user).toContain("=== CANDIDATES");
      expect(prompts.user).toContain("Pool Suggestion");
    });

    it("caps deck cards at 60% of digest limit when user has many deck cards", () => {
      // Create 20 deck cards - with digestLimit=10, DECK_SLOT_MAX=6, only 6 should appear.
      // All 20 cards are deck cards (same score), so they fill the top 10 slots, leaving
      // no pool candidates. Only 6 of the 10 scored deck cards are included in the digest.
      const manyCards = Array.from({ length: 20 }, (_, i) =>
        makeCard({ name: `Deck Card ${i + 1}` })
      );
      const entries = manyCards.map((card) => ({
        card,
        quantity: 1,
        board: "main" as const,
      }));
      const prompts = buildAIPrompts(
        { ...options, preferEntries: entries },
        manyCards,
        10
      );

      expect(prompts.user).toContain("=== YOUR DECK");
      // The deck section should include the first 6 card references (60% of 10)
      expect(prompts.user).toContain("Deck Card 1");
      expect(prompts.user).toContain("Deck Card 6");
      // Cards past the 60% cap should not appear in YOUR DECK
      expect(prompts.user).not.toContain("Deck Card 11");
      expect(prompts.user).not.toContain("Deck Card 20");
      // No CANDIDATES section since no pool cards made it into the top 10 scored
      expect(prompts.user).not.toContain("=== CANDIDATES");
      // The header shows "6 deck + 0 candidates"
      expect(prompts.user).toMatch(/6 deck \+ 0 candidates/);
    });

    it("tags cards from seedEntries, focusEntries, and preferEntries all as deck cards", () => {
      const seedCard = makeCard({ name: "Seed Card" });
      const focusCard = makeCard({ name: "Focus Card" });
      const preferCard = makeCard({ name: "Prefer Card" });
      const poolOnly = makeCard({ name: "Pool Only Card" });
      const prompts = buildAIPrompts(
        {
          ...options,
          seedEntries: [{ card: seedCard, quantity: 1, board: "main" }],
          focusEntries: [{ card: focusCard, quantity: 1, board: "main" }],
          preferEntries: [{ card: preferCard, quantity: 1, board: "main" }],
        },
        [seedCard, focusCard, preferCard, poolOnly],
        10
      );

      // All three entry types appear in YOUR DECK section
      expect(prompts.user).toContain("=== YOUR DECK");
      expect(prompts.user).toContain("Seed Card");
      expect(prompts.user).toContain("Focus Card");
      expect(prompts.user).toContain("Prefer Card");
      // Pool-only card is in CANDIDATES section
      expect(prompts.user).toContain("=== CANDIDATES");
      expect(prompts.user).toContain("Pool Only Card");
    });
  });
});

describe("salvageDeckJSON", () => {
  it("recovers entries from truncated JSON", () => {
    const salvaged = salvageDeckJSON(
      `{"summary":"Green beatdown","main":[{"name":"Test Beast","qty":4,"reason":"efficient threat"}],"side":[{"name":"Naturalize","qty":2,"reason":"artifact answer"}`
    );

    expect(salvaged.summary).toBe("Green beatdown");
    expect(salvaged.main).toEqual([{ name: "Test Beast", qty: 4, reason: "efficient threat" }]);
    expect(salvaged.side).toEqual([{ name: "Naturalize", qty: 2, reason: "artifact answer" }]);
  });

  // Fix 8: the old `/\{[^{}]*\}/g` object matcher broke on any nested braces and
  // silently produced zero entries. The hardened matcher tolerates one level of
  // nesting (e.g. a metadata sub-object) so those cards are still recovered.
  it("recovers entries when an object contains one level of nested braces", () => {
    const salvaged = salvageDeckJSON(
      `{"summary":"x","main":[{"name":"Test Beast","qty":4,"reason":"threat","meta":{"tier":1}},{"name":"Second Beast","qty":2,"reason":"backup"}]}`
    );
    expect(salvaged.main.map((m) => m.name)).toEqual(["Test Beast", "Second Beast"]);
    expect(salvaged.main[0].qty).toBe(4);
  });
});


describe("validateAIProposal", () => {
  it("reports unresolved, out-of-pool, illegal, land, and quantity issues", () => {
    const legal = makeCard({ name: "Legal Beast" });
    const offColor = makeCard({
      name: "Red Intruder",
      colorsJson: JSON.stringify(["R"]),
      colorIdentityJson: JSON.stringify(["R"]),
    });
    const banned = makeCard({
      name: "Banned Beast",
      legalitiesJson: JSON.stringify({ standard: "banned" }),
      legalityStandard: "banned",
    });
    const forest = makeCard({
      name: "Forest",
      typeLine: "Basic Land — Forest",
      manaCost: "",
      cmc: 0,
      oracleText: "({T}: Add {G}.)",
    });

    const result = validateAIProposal({
      resolvedEntries: [
        { card: legal, quantity: 9, board: "main" },
        { card: offColor, quantity: 1, board: "main" },
        { card: banned, quantity: 1, board: "main" },
        { card: forest, quantity: 4, board: "main" },
      ],
      unresolvedNames: ["Imaginary Card"],
      allCards: [legal, offColor, banned, forest],
      options,
    });

    expect(result.ok).toBe(false);
    expect(result.issues.map((issue) => issue.code)).toEqual(expect.arrayContaining([
      "UNRESOLVED_CARD",
      "OUT_OF_POOL",
      "NOT_LEGAL",
      "MAINBOARD_LAND_IGNORED",
      "QUANTITY_CLAMPED",
    ]));
  });
});

describe("OllamaProvider", () => {
  it("maps maxTokens to num_predict", async () => {
    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ message: { content: "{}" } }), { status: 200 })
    );
    const provider = new OllamaProvider({ providerId: "ollama", ollamaBaseUrl: "http://localhost:11434", ollamaModel: "test" });

    await provider.generate({ messages: [{ role: "user", content: "json" }], temperature: 0.2, maxTokens: 1234 });

    const body = JSON.parse(String(fetchMock.mock.calls[0][1]?.body));
    expect(body.options).toMatchObject({ temperature: 0.2, num_predict: 1234 });
  });
});
describe("clampAINonlandSpine", () => {
  const entry = (name: string, qty: number, cmc = 2, typeLine = "Creature — Cat Cleric") => ({
    card: makeCard({ name, cmc, typeLine }),
    quantity: qty,
    board: "main" as const,
  });

  it("leaves a within-budget spine untouched", () => {
    const spine = [entry("A", 4), entry("B", 4), entry("C", 4)];
    const res = clampAINonlandSpine(spine, [], 60);
    expect(res.trimmedCopies).toBe(0);
    expect(res.entries).toBe(spine);
  });

  it("clamps a 53-copy AI spine so the mana base keeps its full land budget (7-land regression)", () => {
    // Reproduces the reported bug: AI ignored the 55-65% guidance and returned
    // 53 nonland copies for a 60-card deck. Pre-fix, all 53 were locked and the
    // offline pipeline could only fit 7 lands.
    const spine = [
      entry("Ajani's Pridemate", 4, 2), entry("Starscape Cleric", 4, 2),
      entry("Leonardo, Cutting Edge", 4, 3), entry("Momo, Playful Pet", 3, 2),
      entry("Essence Channeler", 2, 2), entry("Marauding Blight-Priest", 2, 3),
      entry("Raven Eagle", 2, 2), entry("Experimental Confectioner", 2, 2),
      entry("Featherbrained Filcher", 2, 4), entry("Mintstrosity", 2, 1),
      entry("Charming Prince", 2, 2), entry("Lunar Convocation", 2, 3),
      entry("Enduring Tenacity", 2, 4), entry("Scavenger's Talent", 2, 1),
      entry("Sheltered by Ghosts", 2, 2), entry("Moseo, Vein's New Dean", 1, 2),
      entry("Haliya, Guided by Light", 1, 3), entry("Syr Ginger, the Meal Ender", 1, 3),
      entry("Sweettooth Witch", 1, 3), entry("Cat Collector", 1, 2),
      entry("Vito, Fanatic of Aclazotz", 1, 3), entry("Midnight Snack", 2, 2),
      entry("Minwu, White Mage", 1, 3), entry("Preacher of the Schism", 1, 3),
      entry("Exemplar of Light", 1, 3), entry("Nullpriest of Oblivion", 1, 4),
      entry("Lyra Dawnbringer", 2, 5), entry("Bloodthirsty Conqueror", 1, 5),
      entry("Rottenmouth Viper", 1, 5),
    ];
    expect(spine.reduce((s, e) => s + e.quantity, 0)).toBe(53);

    const res = clampAINonlandSpine(spine, [], 60);
    const clampedCopies = res.entries.reduce((s, e) => s + e.quantity, 0);
    expect(res.trimmedCopies).toBe(53 - res.maxCopies);
    expect(clampedCopies).toBe(res.maxCopies);
    // The land budget must survive: locked spine + recommended lands fit in 60.
    expect(clampedCopies + res.landBudget).toBeLessThanOrEqual(60);
    // Sanity: a real Standard mana base, not 7 lands.
    expect(res.landBudget).toBeGreaterThanOrEqual(18);
  });

  it("trims highest-cmc copies first so the cheap curve survives", () => {
    const spine = [
      entry("Cheap", 4, 1),
      entry("Mid", 4, 3),
      entry("Expensive", 4, 6),
    ];
    // Force a tiny budget via a huge seed lock.
    const seeds = [entry("Seed", 30, 2)];
    const res = clampAINonlandSpine(spine, seeds, 60);
    const byName = new Map(res.entries.map((e) => [e.card.name, e.quantity]));
    expect(byName.get("Cheap")).toBe(4);
    expect(byName.get("Expensive") ?? 0).toBeLessThan(4);
  });

  it("counts user seed nonlands against the budget but never trims them", () => {
    const seeds = [entry("UserSeed", 10, 2)];
    const spine = Array.from({ length: 12 }, (_, i) => entry(`AI${i}`, 4, 2));
    const res = clampAINonlandSpine(spine, seeds, 60);
    const clampedCopies = res.entries.reduce((s, e) => s + e.quantity, 0);
    expect(clampedCopies + 10 + res.landBudget).toBeLessThanOrEqual(60);
    expect(res.entries.every((e) => e.card.name.startsWith("AI"))).toBe(true);
  });
});

// ────────────────────────────────────────────────────────────────────────────
// generateDeckAISequential
// ────────────────────────────────────────────────────────────────────────────

import { generateDeckAISequential, generateDeckAI, createCallBudget, CallBudgetExceededError, DEFAULT_CALL_BUDGET } from "../aiGenerator";
import type { AIProvider, AIGenerationRequest } from "../provider";

/** Build a minimal pool of N unique creature cards. */
function makePool(n: number): CardRecord[] {
  return Array.from({ length: n }, (_, i) =>
    makeCard({ name: `Pool Card ${i + 1}`, cmc: (i % 5) + 1 })
  );
}

describe("buildDeltaDigest", () => {
  it("summarizes the locked spine and excludes locked cards from candidates", () => {
    const pool = makePool(50);
    const lockedSpine = [
      { card: pool[0], quantity: 2, board: "main" as const },
      { card: pool[1], quantity: 1, board: "main" as const },
    ];
    const { spineSummary, candidateDigest, candidateCount } = buildDeltaDigest(options, pool, lockedSpine);

    expect(spineSummary).toContain(`2× ${pool[0].name}`);
    expect(spineSummary).toContain(`1× ${pool[1].name}`);
    // Locked cards must never reappear as fresh candidates.
    expect(candidateDigest).not.toContain(`${pool[0].name} |`);
    expect(candidateDigest).not.toContain(`${pool[1].name} |`);
    expect(candidateCount).toBeGreaterThan(0);
    expect(candidateCount).toBeLessThanOrEqual(SEQUENTIAL_DELTA_CANDIDATE_LIMIT);
  });

  it("caps candidates at the delta limit — far smaller than the full digest", () => {
    const pool = makePool(120);
    const { candidateCount } = buildDeltaDigest(options, pool, []);
    expect(candidateCount).toBeLessThanOrEqual(SEQUENTIAL_DELTA_CANDIDATE_LIMIT);
    expect(spineSummaryEmpty(pool)).toBe("(none yet)");
  });
});

function spineSummaryEmpty(pool: CardRecord[]): string {
  return buildDeltaDigest(options, pool, []).spineSummary;
}

/** Provider that returns one JSON batch of `batchSize` cards per call. */
function makeBatchProvider(pool: CardRecord[], batchSize: number, callLog: string[][]): AIProvider {
  let callIndex = 0;
  return {
    id: "mock",
    label: "Mock",
    isReady: async () => true,
    generate: async (req: AIGenerationRequest) => {
      // Pull the next batchSize cards from the pool that haven't been emitted yet.
      // Fix 5 changed the delta-step spine summary to a multi-line format where
      // each locked card is its own line: `${qty}× ${name} (CMC${cmc}) [roles]
      // score=N "oracle"`. Extract locked names from those lines across all user
      // messages. Candidate-digest lines use a different `name | ...` shape and
      // never start with `${qty}× `, so this cannot pick them up by accident.
      const alreadyLocked = new Set<string>();
      const lineRe = /^\d+× (.+?) \(CMC\d+\)/gm;
      for (const msg of req.messages) {
        if (msg.role !== "user") continue;
        let m: RegExpExecArray | null;
        while ((m = lineRe.exec(msg.content)) !== null) {
          const nm = m[1].trim();
          if (nm && nm !== "(none yet)") alreadyLocked.add(nm);
        }
      }
      const batch = pool.filter((c) => !alreadyLocked.has(c.name)).slice(0, batchSize);
      callLog.push(batch.map((c) => c.name));
      callIndex++;
      return JSON.stringify({
        summary: `Batch ${callIndex}`,
        game_plan: "Incremental build.",
        main: batch.map((c) => ({ name: c.name, qty: 1, reason: "synergy" })),
        side: [],
      });
    },
  };
}

describe("generateDeckAISequential", () => {
  it("calls the provider multiple times when stepSize < nonland budget", async () => {
    const pool = makePool(40);
    const callLog: string[][] = [];
    const provider = makeBatchProvider(pool, 4, callLog);

    const result = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: 4, seedEntries: [] },
      pool,
      provider
    );

    // Should have made more than one call (stepSize=4, budget≈36 → ~9 steps).
    expect(callLog.length).toBeGreaterThan(1);
    // The final deck should have cards in it.
    expect(result.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
  });

  it("does not include already-locked seed cards in the final deck's nonland spine", async () => {
    const pool = makePool(20);
    const seedCard = pool[0];
    const callLog: string[][] = [];
    const provider = makeBatchProvider(pool, 4, callLog);

    const result = await generateDeckAISequential(
      {
        ...options,
        aiSequentialStepSize: 4,
        seedEntries: [{ card: seedCard, quantity: 2, board: "main" }],
      },
      pool,
      provider
    );

    // The seed card should appear exactly once in the final deck (at its original quantity),
    // not duplicated from any subsequent step proposal.
    const seedInDeck = result.entries.filter((e) => e.card.name === seedCard.name && e.board === "main");
    const totalCopies = seedInDeck.reduce((s, e) => s + e.quantity, 0);
    // At most 4 copies (format cap), not 2 (original) + extras from AI re-proposing it.
    expect(totalCopies).toBeLessThanOrEqual(4);
    // The dedup logic must prevent the card appearing in multiple distinct entries.
    expect(seedInDeck.length).toBeLessThanOrEqual(1);
  });

  it("falls back to offline engine when provider always fails", async () => {
    const pool = makePool(10);
    const failingProvider: AIProvider = {
      id: "fail",
      label: "Fail",
      isReady: async () => true,
      generate: async () => { throw new Error("Network error"); },
    };

    const result = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: 4 },
      pool,
      failingProvider
    );

    // Fallback should still produce a result.
    expect(result.entries.length).toBeGreaterThan(0);
    expect(result.diagnostics.reasoning.some((r) => r.includes("falling back"))).toBe(true);
  });

  it("respects the stepSize option and never exceeds the nonland budget", async () => {
    const pool = makePool(30);
    const callLog: string[][] = [];
    const provider = makeBatchProvider(pool, 3, callLog);

    const result = await generateDeckAISequential(
      { ...options, mainboardSize: 60, maxMainboardSize: 60, aiSequentialStepSize: 3 },
      pool,
      provider
    );

    const mainNonland = result.entries.filter(
      (e) => e.board === "main" && !e.card.typeLine.includes("Land")
    );
    const nonlandCopies = mainNonland.reduce((s, e) => s + e.quantity, 0);
    // Must not exceed the nonland budget (≈60% of 60 = 36) by more than a small margin.
    expect(nonlandCopies).toBeLessThanOrEqual(40);
  });

  // ── Array schedule tests ─────────────────────────────────────────────────

  it("array schedule: uses per-step sizes and logs schedule label", async () => {
    const pool = makePool(40);
    const callLog: string[][] = [];
    // Schedule [2, 5, 3]: step 1 adds 2, step 2 adds 5, step 3+ adds 3 (last repeats).
    const provider = makeBatchProvider(pool, 5, callLog);

    const result = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: [2, 5, 3] },
      pool,
      provider
    );

    // Should complete (nonland budget filled).
    expect(result.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
    // Reasoning log must contain the schedule label.
    expect(
      result.diagnostics.reasoning.some((r) => r.includes("[2, 5, 3] (last repeats)"))
    ).toBe(true);
    // More than one provider call (budget > first step size of 2).
    expect(callLog.length).toBeGreaterThan(1);
  });

  it("array schedule: single-element array behaves identically to scalar", async () => {
    const pool = makePool(30);
    const callLogArray: string[][] = [];
    const callLogScalar: string[][] = [];

    const resultArray = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: [4] },
      pool,
      makeBatchProvider(pool, 4, callLogArray)
    );
    const resultScalar = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: 4 },
      pool,
      makeBatchProvider(pool, 4, callLogScalar)
    );

    // Same number of provider calls — identical step behaviour.
    expect(callLogArray.length).toBe(callLogScalar.length);
    // Both complete with main cards.
    expect(resultArray.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
    expect(resultScalar.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
    // Single-element array should log the uniform label (no "last repeats").
    expect(
      resultArray.diagnostics.reasoning.some((r) => r.includes("uniform 4"))
    ).toBe(true);
  });

  it("array schedule: last element repeats beyond schedule length", async () => {
    const pool = makePool(40);
    const callLog: string[][] = [];
    // Schedule [10, 2]: step 1 gets 10, all subsequent steps get 2.
    // With budget ≈ 36: step 1 locks 10, steps 2-N add 2 each → needs 13+ calls total.
    const provider = makeBatchProvider(pool, 10, callLog);

    const result = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: [10, 2] },
      pool,
      provider
    );

    // We expect more than 2 calls because the schedule only has 2 entries
    // but step 2 only locks 2 cards per pass — many more passes needed.
    expect(callLog.length).toBeGreaterThan(2);
    // Reasoning confirms the schedule.
    expect(
      result.diagnostics.reasoning.some((r) => r.includes("[10, 2] (last repeats)"))
    ).toBe(true);
  });

  it("array schedule: empty array falls back to default step size 4", async () => {
    const pool = makePool(30);
    const callLog: string[][] = [];
    // Casting needed to test the defensive fallback path.
    const provider = makeBatchProvider(pool, 4, callLog);

    const result = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: [] as unknown as number[] },
      pool,
      provider
    );

    // Should still produce a valid deck (defensive default of 4 kicks in).
    expect(result.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
    expect(callLog.length).toBeGreaterThan(0);
  });
});

describe("call budget guard (Fix 7)", () => {
  it("createCallBudget defaults to the module ceiling and clamps to >= 1", () => {
    expect(createCallBudget().ceiling).toBe(DEFAULT_CALL_BUDGET);
    expect(createCallBudget().used).toBe(0);
    expect(createCallBudget(0).ceiling).toBe(1);
    expect(createCallBudget(20).ceiling).toBe(20);
  });

  it("CallBudgetExceededError carries the ceiling", () => {
    const e = new CallBudgetExceededError(5);
    expect(e.ceiling).toBe(5);
    expect(e.name).toBe("CallBudgetExceededError");
  });

  it("stops the sequential chain at the shared ceiling and surfaces a warning", async () => {
    const pool = makePool(40);
    const callLog: string[][] = [];
    const provider = makeBatchProvider(pool, 2, callLog);
    const budget = createCallBudget(2);

    const result = await generateDeckAISequential(
      { ...options, aiSequentialStepSize: 2 },
      pool,
      provider,
      { callBudget: budget }
    );

    // The provider is invoked exactly `ceiling` times, then the guard fires.
    expect(callLog.length).toBe(2);
    expect(budget.used).toBe(2);
    // The deck is still finalized from the cards locked before the ceiling…
    expect(result.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
    // …and the early stop is surfaced to the user, not just logged.
    expect(result.warnings?.some((w) => /call budget/i.test(w))).toBe(true);
  });
});

describe("feasibility / out-of-pool re-prompt gate (Fix 1 & 4)", () => {
  /**
   * Provider that emits `bad` on the first call (containing an out-of-pool
   * name) and `good` on every subsequent call. Records how many times it ran.
   */
  function makeRepromptProvider(pool: CardRecord[]): { provider: AIProvider; calls: () => number } {
    let n = 0;
    const good = (extra: { name: string; qty: number; reason: string }[] = []) => ({
      summary: "Green midrange",
      game_plan: "Curve out and swing.",
      main: [...pool.slice(0, 20).map((c) => ({ name: c.name, qty: 2, reason: "beater" })), ...extra],
      side: [],
    });
    const provider: AIProvider = {
      id: "mock",
      label: "Mock",
      isReady: async () => true,
      generate: async () => {
        n++;
        if (n === 1) {
          // First pass proposes a card that is NOT in the pool → unresolvedNames.
          return JSON.stringify(good([{ name: "Totally Fake Nonexistent Card", qty: 2, reason: "oops" }]));
        }
        return JSON.stringify(good());
      },
    };
    return { provider, calls: () => n };
  }

  it("re-prompts exactly once when the first proposal references an out-of-pool card", async () => {
    const pool = makePool(40);
    const { provider, calls } = makeRepromptProvider(pool);

    const result = await generateDeckAI({ ...options, aiIterations: 1 }, pool, provider);

    // One generation pass + exactly one bounded re-prompt = 2 provider calls.
    expect(calls()).toBe(2);
    // The re-prompt path must be recorded in the reasoning trail.
    expect(result.diagnostics.reasoning.some((r) => /re-prompt/i.test(r))).toBe(true);
    expect(result.entries.filter((e) => e.board === "main").length).toBeGreaterThan(0);
  });

  it("caps the re-prompt at 1 even when the second proposal is still dirty", async () => {
    // Both passes reference an out-of-pool name, so the issue never clears.
    // The gate must still fire exactly once (2 total calls), keep the original
    // deck, and surface the problem rather than looping.
    const pool = makePool(40);
    let n = 0;
    const dirty = () => ({
      summary: "Green midrange",
      game_plan: "Curve out and swing.",
      main: [
        ...pool.slice(0, 20).map((c) => ({ name: c.name, qty: 2, reason: "beater" })),
        { name: "Totally Fake Nonexistent Card", qty: 2, reason: "oops" },
      ],
      side: [],
    });
    const provider: AIProvider = {
      id: "mock",
      label: "Mock",
      isReady: async () => true,
      generate: async () => {
        n++;
        return JSON.stringify(dirty());
      },
    };

    const result = await generateDeckAI({ ...options, aiIterations: 1 }, pool, provider);
    // Exactly one re-prompt — never an unbounded loop.
    expect(n).toBe(2);
    // The unresolved-name degradation is surfaced to the user (Fix 8).
    expect(result.warnings?.some((w) => /pool|dropped|could not be matched/i.test(w))).toBe(true);
  });
});
