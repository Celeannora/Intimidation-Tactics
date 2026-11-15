import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardRecord } from "../../types";
import type { GenerateOptions } from "../../generator/types";
import { buildScoreBreakdown, deckScore, targetAvgCmcFor } from "../../generator/weights";
import { blendRoleTargets } from "../../generator/roleTargets";
import { generateDeck } from "../../generator/generator";
import { refineDeckAI, generateDeckAISequential, createCallBudget } from "../aiGenerator";
import type { AIProvider } from "../provider";

// Explicit unit executor only; production always uses the cancellable Worker client.
vi.mock("../../generator/client", async () => {
  const { generateDeck } = await import("../../generator/generator");
  return { generateDecksInWorker: vi.fn(async (...args: Parameters<typeof generateDeck>) => ({
    variants: [generateDeck(...args)], bestIndex: 0,
  })) };
});

vi.mock("../../generator/generator", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../generator/generator")>();
  return { ...actual, generateDeck: vi.fn(actual.generateDeck) };
});

function card(name: string, extra: Partial<CardRecord> = {}): CardRecord {
  return {
    id: name, oracleId: name, name, lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{G}", cmc: 1, colorsJson: '["G"]', colorIdentityJson: '["G"]',
    typeLine: "Creature — Beast", oracleText: "Trample.", keywordsJson: "[]",
    power: "2", toughness: "2", loyalty: null, producedManaJson: "[]",
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: '{"standard":"legal","brawl":"legal"}', setCode: "TST", setName: "Test",
    setType: null, collectorNumber: null, rarity: null, imageNormal: null,
    priceUsd: 1, priceUsdFoil: null, priceEur: null, edhrecRank: null, gameChanger: 0,
    flavorText: null, artist: null, searchText: "", importedAt: "", ...extra,
  };
}
const options: GenerateOptions = {
  engine: "ai", format: "standard", archetype: "Midrange", colors: ["G"],
  mainboardSize: 60, maxMainboardSize: 60, aiPicksAsFinal: true, optimizationIterations: 0,
};
function provider(main: { name: string; qty: number }[], side: { name: string; qty: number }[] = []): AIProvider {
  return { id: "fixture", label: "Fixture", isReady: async () => true,
    generate: vi.fn(async () => JSON.stringify({ main, side })) };
}
async function refine(opts: GenerateOptions, pool: CardRecord[], main: { name: string; qty: number }[], side: { name: string; qty: number }[] = []) {
  return refineDeckAI(opts, pool, provider(main, side), { messages: [] }, "Build this core.");
}
afterEach(() => vi.clearAllMocks());

describe("AI construction constraints", () => {
  it.each(["one-shot", "sequential"])("checks the resolved printing price, not just an eligible Oracle alias (%s)", async (mode) => {
    const expensive = card("Shared Printing Beast", { id: "expensive-print", priceUsd: 20 });
    const cheap = { ...expensive, id: "cheap-print", priceUsd: 1 };
    const good = card("Eligible Beast");
    const opts = { ...options, maxCardPriceUsd: 5 };
    const picks = [{ name: expensive.name, qty: 1 }, { name: good.name, qty: 1 }];
    if (mode === "one-shot") await refine(opts, [expensive, cheap, good], picks);
    else await generateDeckAISequential(opts, [expensive, cheap, good], provider(picks), { callBudget: createCallBudget(1) });
    expect(vi.mocked(generateDeck).mock.calls[0][0].seedEntries?.map((e) => e.card.id)).toEqual([good.id]);
  });
  it("reserves original sideboard slots before normalizing AI additions to the format size", async () => {
    const beast = card("Main Beast");
    const existing = Array.from({ length: 4 }, (_, i) => card(`Original Side ${i}`));
    const addition = card("New Side Beast");
    const result = await refine({ ...options, generateSideboard: true, seedEntries: existing.map((c, i) => ({ card: c, quantity: i === 3 ? 2 : 4, board: "side" as const, quantityLocked: true })) }, [beast, ...existing, addition], [{ name: beast.name, qty: 4 }], [{ name: addition.name, qty: 4 }]);
    expect(result.entries.filter((e) => e.board === "side").reduce((sum, e) => sum + e.quantity, 0)).toBe(15);
    expect(result.entries.find((e) => e.card.oracleId === addition.oracleId)?.quantity).toBe(1);
  });
  it("does not advertise an offline combo after final quantities fall below its requirement", async () => {
    const beast = card("Quantity Combo Beast");
    const actual = await vi.importActual<typeof import("../../generator/generator")>("../../generator/generator");
    vi.mocked(generateDeck).mockImplementationOnce((opts, pool) => ({
      ...actual.generateDeck(opts, pool),
      verifiedCombos: [{ id: "needs-two", cardOracleIds: [beast.oracleId], cardNames: [beast.name], description: "Needs two copies", explanation: "Fixture", source: "Commander Spellbook", requiredQuantities: { [beast.oracleId]: 2 } }],
    }));
    const result = await refine({ ...options, seedEntries: [{ card: beast, quantity: 1, board: "main", quantityLocked: true }] }, [beast], [{ name: beast.name, qty: 2 }]);
    expect(result.verifiedCombos).toEqual([]);
  });
  it("preserves offline analysis fields while reporting coverage for the final rescored deck", async () => {
    const beast = card("Token Beast", { oracleText: "Whenever another creature enters, create a 1/1 green Saproling creature token." });
    const result = await refine(options, [beast], [{ name: beast.name, qty: 4 }]);
    const offline = vi.mocked(generateDeck).mock.results[0].value;
    expect(result.diagnostics.primaryAxes).toEqual(offline.diagnostics.primaryAxes);
    expect(result.diagnostics.axisConfidence).toEqual(offline.diagnostics.axisConfidence);
    expect(result.diagnostics.seedFeasibilityFlags).toEqual(offline.diagnostics.seedFeasibilityFlags);
    expect(result.comboChains).toEqual(offline.comboChains);
    expect(result.verifiedCombos).toEqual(offline.verifiedCombos);
    expect(result.scenarioCoverage).toEqual(offline.scenarioCoverage);
  });
  it("rescores with and returns the offline effective scoring context", async () => {
    const beast = card("Preferred Beast");
    const effective: GenerateOptions = { ...options, preferEntries: [{ card: beast, quantity: 4, board: "main" }] };
    const actual = await vi.importActual<typeof import("../../generator/generator")>("../../generator/generator");
    vi.mocked(generateDeck).mockImplementationOnce((opts, pool) => Object.assign(actual.generateDeck(opts, pool), { scoringOptions: effective }));
    const result = await refine(options, [beast], [{ name: beast.name, qty: 4 }]);
    const target = targetAvgCmcFor(effective, blendRoleTargets(effective.archetype, effective.secondaryArchetypes).maxAvgCmc);
    expect(result.diagnostics.deckScore).toBe(deckScore(result.entries, effective, target).total);
    expect(result.scoreBreakdown).toEqual(buildScoreBreakdown(result.entries, effective, target));
    expect(result.scoringOptions).toBe(effective);
  });
  it("returns final acceptance violations with visible warnings for invalid original seeds", async () => {
    const seed = card("Original Invalid Seed", { colorIdentityJson: '["R"]', priceUsd: 20, legalityStandard: "banned", bannedInStandard: 1, legalitiesJson: '{"standard":"banned"}' });
    const fresh = card("Eligible Beast");
    const result = await refine({ ...options, maxCardPriceUsd: 5, seedEntries: [{ card: seed, quantity: 1, board: "main" }] }, [seed, fresh], [{ name: fresh.name, qty: 1 }]);
    expect(result.validation?.legal).toBe(false);
    expect(result.validation?.violations.map((v) => v.rule)).toEqual(expect.arrayContaining(["COLOR_IDENTITY", "MAX_CARD_PRICE", "NOT_LEGAL"]));
    expect(result.warnings?.join(" ")).toMatch(/final.*validation/i);
  });
  it("preserves original off-color locked-core seeds instead of silently deleting user input", async () => {
    const seed = card("Original Red Seed", { colorIdentityJson: '["R"]' });
    const fresh = card("Eligible Beast");
    const result = await refine({ ...options, seedEntries: [{ card: seed, quantity: 2, board: "main", quantityLocked: true }] }, [seed, fresh], [{ name: fresh.name, qty: 1 }]);
    expect(result.entries.find((e) => e.card.oracleId === seed.oracleId)).toMatchObject({ quantity: 2, quantityLocked: true });
  });
  it.each([
    { format: "standard" as const, stepSize: 2, expected: [["First New Beast", 2, undefined]] },
    { format: "standard" as const, stepSize: 10, expected: [["First New Beast", 4, undefined], ["Second New Beast", 4, undefined]] },
    { format: "brawl" as const, stepSize: 10, expected: [["First New Beast", 1, undefined], ["Second New Beast", 1, undefined]] },
  ])("locks only eligible nonlands within the $format step total $stepSize and copy cap", async ({ format, stepSize, expected }) => {
    const seed = card("Original Seed");
    const red = card("Off Color", { colorIdentityJson: '["R"]' });
    const land = card("Forest", { typeLine: "Basic Land — Forest", manaCost: null, cmc: 0, oracleText: "{T}: Add {G}.", producedManaJson: '["G"]' });
    const first = card("First New Beast");
    const second = card("Second New Beast");
    await generateDeckAISequential({ ...options, format, aiSequentialStepSize: [stepSize], seedEntries: [{ card: seed, quantity: 1, board: "main", quantityLocked: true }] }, [seed, red, land, first, second], provider([
      { name: red.name, qty: 99 }, { name: land.name, qty: 99 },
      { name: first.name, qty: 99 }, { name: second.name, qty: 99 },
    ]), { callBudget: createCallBudget(1) });
    expect(vi.mocked(generateDeck).mock.calls[0][0].seedEntries?.map((e) => [e.card.name, e.quantity, e.quantityLocked])).toEqual([[seed.name, 1, true], ...expected]);
  });
  it("spends only the mainboard remaining Oracle copy budget on the sideboard", async () => {
    const beast = card("Shared Beast");
    const result = await refine({ ...options, generateSideboard: true }, [beast], [{ name: beast.name, qty: 4 }], [{ name: beast.name, qty: 4 }]);
    expect(result.entries.filter((e) => e.card.oracleId === beast.oracleId).reduce((sum, e) => sum + e.quantity, 0)).toBe(4);
    expect(result.entries.some((e) => e.board === "side")).toBe(false);
  });
  it("uses the greater strong-preference floor without charging an overlapping spine twice", async () => {
    const seed = card("Many Beasts", { oracleText: "A deck can have any number of cards named Many Beasts." });
    const fresh = card("Fresh Beast");
    await refine({ ...options, seedPolicy: "strong-preference", seedEntries: [{ card: seed, quantity: 28, board: "main" }] }, [seed, fresh], [{ name: seed.name, qty: 30 }, { name: fresh.name, qty: 4 }]);
    expect(vi.mocked(generateDeck).mock.calls[0][0].seedEntries?.map((e) => [e.card.name, e.quantity])).toEqual([[seed.name, 30], [fresh.name, 4]]);
  });
  it("reconciles an AI re-listing with the exact locked original quantity and metadata", async () => {
    const seed = card("Original Seed");
    const result = await refine({ ...options, seedEntries: [{ card: seed, quantity: 2, board: "main", quantityLocked: true }] }, [seed], [{ name: seed.name, qty: 4 }]);
    expect(vi.mocked(generateDeck).mock.calls[0][0].seedEntries).toEqual([{ card: seed, quantity: 2, board: "main", quantityLocked: true }]);
    expect(result.entries.find((e) => e.card.oracleId === seed.oracleId)).toMatchObject({ quantity: 2, quantityLocked: true });
  });
  it("does not implicitly expand selected colors when forwarding original seeds", async () => {
    const good = card("Eligible Beast");
    const red = card("Original Red Seed", { colorIdentityJson: '["R"]' });
    await refine({ ...options, seedEntries: [{ card: red, quantity: 1, board: "main" }] }, [good, red], [{ name: good.name, qty: 1 }]);
    expect(vi.mocked(generateDeck).mock.calls[0][0].allowSeedColorExpansion).not.toBe(true);
    await refine({ ...options, allowSeedColorExpansion: true, seedEntries: [{ card: red, quantity: 1, board: "main" }] }, [good, red], [{ name: good.name, qty: 1 }]);
    expect(vi.mocked(generateDeck).mock.calls[1][0].allowSeedColorExpansion).toBe(true);
  });
  it("filters every ineligible resolved pick before locking either board", async () => {
    const good = card("Eligible Beast");
    const red = card("Red Beast", { colorIdentityJson: '["R"]' });
    const banned = card("Banned Beast", { bannedInStandard: 1, legalityStandard: "banned", legalitiesJson: '{"standard":"banned"}' });
    const expensive = card("Expensive Beast", { priceUsd: 20 });
    const result = await refine({ ...options, maxCardPriceUsd: 5, generateSideboard: true }, [good, red, banned, expensive],
      [good, red, banned, expensive].map((c) => ({ name: c.name, qty: 1 })),
      [red, banned, expensive].map((c) => ({ name: c.name, qty: 1 })));
    const offlineOptions = vi.mocked(generateDeck).mock.calls[0][0];
    expect(offlineOptions.seedEntries?.map((e) => e.card.name)).toEqual([good.name]);
    expect(result.entries.some((e) => [red.name, banned.name, expensive.name].includes(e.card.name))).toBe(false);
    expect(result.warnings?.join(" ")).toMatch(/dropped.*selected pool/i);
  });
});
