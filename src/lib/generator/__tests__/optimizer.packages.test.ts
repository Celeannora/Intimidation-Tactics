import { afterEach, describe, expect, it, vi } from "vitest";
import type { CardRecord } from "../../types";
import { validateDeck, type DeckEntry } from "../../legality";
import type { GenerateOptions } from "../types";
import { optimize } from "../optimizer";
import { deckScore } from "../weights";
import * as weights from "../weights";

afterEach(() => { vi.restoreAllMocks(); });

type ComboContext = NonNullable<GenerateOptions["comboSynergyContext"]>;
function card(id: string, overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id, oracleId: id, name: id, manaCost: "{2}", cmc: 2,
    typeLine: "Creature — Test", oracleText: "", keywordsJson: "[]",
    producedManaJson: "[]", colorIdentityJson: "[]", power: "3", toughness: "3",
    rarity: "common", edhrecRank: null, gameChanger: 0, priceUsd: 1,
    legalityStandard: "legal", legalitiesJson: '{"standard":"legal","commander":"legal"}',
    ...overrides,
  } as CardRecord;
}
const donorA = card("donor-a");
const donorB = card("donor-b");
const anchor = card("anchor");
const pieceA = card("piece-a", { priceUsd: 7 });
const pieceB = card("piece-b", { priceUsd: 7 });
const wastes = card("wastes", { name: "Wastes", typeLine: "Basic Land — Wastes", cmc: 0, manaCost: "", oracleText: "{T}: Add {C}.", power: null });
const start: DeckEntry[] = [
  { card: donorA, quantity: 4, board: "main" },
  { card: donorB, quantity: 4, board: "main" },
  { card: anchor, quantity: 1, board: "main" },
  { card: wastes, quantity: 51, board: "main" },
];
const baseOptions: GenerateOptions = {
  engine: "offline", format: "standard", archetype: "Midrange", colors: [], totalBudgetUsd: 100,
};
function verified(ids = [pieceA.oracleId, pieceB.oracleId]): ComboContext["verifiedCombos"][number] {
  return {
    id: ids.join("+"), cardOracleIds: ids, cardNames: ids,
    description: "Test signal, not an executable combo proof.",
    explanation: "Test signal.", source: "Commander Spellbook",
  };
}
const signals: Record<"verified" | "chain", ComboContext> = {
  verified: { chains: [], verifiedCombos: [verified()] },
  chain: { chains: [{
    oracleIds: [anchor.oracleId, pieceA.oracleId, pieceB.oracleId],
    cardNames: [anchor.name, pieceA.name, pieceB.name], kind: "linear", axes: [],
    chainScore: 9, explanation: "Test source/payoff signal.",
  }], verifiedCombos: [] },
};
function run(context: ComboContext | undefined, overrides: Partial<Parameters<typeof optimize>[1]> = {}, entries = start) {
  return optimize(entries, {
    pool: [pieceA, pieceB], options: { ...baseOptions, comboSynergyContext: context },
    targetAvgCmc: 2, locked: new Set([anchor.oracleId]), iterations: 1,
    // Reject both strictly downhill single swaps. Pair proposals are deterministic.
    rng: () => 0.999999, ...overrides,
  });
}
function swap(first: CardRecord, second: CardRecord): DeckEntry[] {
  return [{ ...start[0], card: first }, { ...start[1], card: second }, ...start.slice(2)];
}

describe("optimizer bounded package moves", () => {
  it.each(["verified", "chain"] as const)("crosses a real complementary %s landscape that single swaps cannot improve", (kind) => {
    const context = signals[kind];
    const options = { ...baseOptions, comboSynergyContext: context };
    const initialScore = deckScore(start, options, 2).total;
    expect(deckScore(swap(pieceA, donorB), options, 2).total).toBeLessThan(initialScore);
    expect(deckScore(swap(donorA, pieceB), options, 2).total).toBeLessThan(initialScore);
    expect(deckScore(swap(pieceA, pieceB), options, 2).total).toBeGreaterThan(initialScore);
    expect(run(undefined).entries).toEqual(start);

    const result = run(context);
    expect(result.finalScore).toBeGreaterThan(initialScore);
    expect(result.entries.slice(0, 2).map((entry) => entry.card.oracleId).sort()).toEqual([pieceA.oracleId, pieceB.oracleId]);
    expect(result.entries.map((entry) => entry.quantity)).toEqual(start.map((entry) => entry.quantity));
    expect(result.entries.slice(2)).toEqual(start.slice(2));
    expect(validateDeck(result.entries, "standard").legal).toBe(true);
    expect(result.finalScore).toBe(deckScore(result.entries, options, 2).total);
    expect(result.improvements).toBe(1);
    expect(result.steps).toBe(3); // One single-swap round and two ordered pair trials.
    expect(run(context)).toEqual(result);
    expect(start[0].card.oracleId).toBe(donorA.oracleId);
  });

  it.each([
    ["incoming quantity", { [pieceA.oracleId]: 5, [pieceB.oracleId]: 1 }],
    ["existing member quantity", { [anchor.oracleId]: 2, [pieceA.oracleId]: 1, [pieceB.oracleId]: 1 }],
  ])("does not score an infeasible package with insufficient %s", (_label, requiredQuantities) => {
    const combo = { ...verified([anchor.oracleId, pieceA.oracleId, pieceB.oracleId]), requiredQuantities };
    const context: ComboContext = { chains: [], verifiedCombos: [combo] };
    const result = run(context);
    expect(result.entries).toEqual(start);
    // One scored single-swap round, no feasible two-card trials.
    expect(result.steps).toBe(1);
  });

  it.each([undefined, false])("does not score verified packages with unacknowledged prerequisites (%s)", (prerequisitesSatisfied) => {
    const combo = { ...verified(), prerequisites: "Have two mana available.", prerequisitesSatisfied };
    const result = run({ chains: [], verifiedCombos: [combo] });
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(1);
  });

  it("can score verified packages with explicitly satisfied prerequisites", () => {
    const combo = { ...verified(), prerequisites: "Have two mana available.", prerequisitesSatisfied: true };
    const result = run({ chains: [], verifiedCombos: [combo] });
    expect(result.entries.slice(0, 2).map((entry) => entry.card.oracleId).sort()).toEqual([pieceA.oracleId, pieceB.oracleId]);
    expect(result.steps).toBe(3);
  });

  it("starts the pair pass from the saved best, not a worse accepted walk state", () => {
    const result = run(signals.verified, { rng: () => 0 });
    expect(result.entries.slice(0, 2).map((entry) => entry.card.oracleId).sort()).toEqual([pieceA.oracleId, pieceB.oracleId]);
    expect(result.improvements).toBe(1);
    expect(result.steps).toBe(3);
  });

  it("fits explicit quantity requirements using the correct donor ordering", () => {
    const entries = start.map((entry) => ({ ...entry }));
    entries[0].quantity = 1;
    entries[3].quantity += 3;
    const combo = { ...verified(), requiredQuantities: { [pieceA.oracleId]: 4, [pieceB.oracleId]: 1 } };
    const result = run({ chains: [], verifiedCombos: [combo] }, {}, entries);
    expect(result.entries[0]).toEqual({ ...entries[0], card: pieceB });
    expect(result.entries[1]).toEqual({ ...entries[1], card: pieceA });
    expect(result.steps).toBe(2); // One single round, one quantity-feasible pair.
    expect(validateDeck(result.entries, "standard").legal).toBe(true);
  });

  it("does not run the optional pair pass when iterations are zero", () => {
    const result = run(signals.verified, { iterations: 0 });
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(0);
  });

  it("reports zero attempts when every package donor is locked", () => {
    const result = run(signals.verified, { locked: new Set(start.map((entry) => entry.card.oracleId)) });
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(0);
  });

  it("never spends a package member as an unlocked donor", () => {
    const result = run(signals.chain, { locked: new Set() });
    expect(result.entries[2]).toEqual(start[2]);
    expect(result.steps).toBe(3);
    expect(result.finalScore).toBeGreaterThan(deckScore(start, { ...baseOptions, comboSynergyContext: signals.chain }, 2).total);
  });

  it.each(["locked", "sideboard", "land"] as const)("cannot use a %s entry as a pair donor", (kind) => {
    const entries = start.map((entry) => ({ ...entry }));
    const locked = new Set([anchor.oracleId]);
    if (kind === "locked") locked.add(donorA.oracleId);
    if (kind === "sideboard") entries[0].board = "side";
    if (kind === "land") entries[0].card = card("other-land", { name: "Island", typeLine: "Basic Land — Island" });
    const result = run(signals.verified, { locked }, entries);
    expect(result.entries).toEqual(entries);
    expect(result.steps).toBe(1); // The remaining donor can only try single swaps.
  });

  it.each(["banned", "land", "missing"] as const)("cannot add a %s incoming package card", (kind) => {
    const first = kind === "banned" ? { ...pieceA, legalitiesJson: '{"standard":"banned"}' }
      : { ...pieceA, typeLine: "Land" };
    const result = run(signals.verified, { pool: kind === "missing" ? [pieceB] : [first, pieceB] });
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(1);
  });

  it("checks both incoming pair copy caps rather than the unlimited donor cap", () => {
    const entries = start.map((entry) => ({ ...entry }));
    entries[0] = { card: card("unlimited", { oracleText: "A deck can have any number of cards named unlimited." }), quantity: 6, board: "main" };
    entries[3].quantity -= 2;
    expect(validateDeck(entries, "standard").legal).toBe(true);
    const result = run(signals.verified, {}, entries);
    expect(result.entries).toEqual(entries);
    expect(result.steps).toBe(1);
    expect(validateDeck(result.entries, "standard").legal).toBe(true);
  });

  it("does not add an incoming pair card already in the sideboard", () => {
    const entries: DeckEntry[] = [...start,
      { card: pieceA, quantity: 1, board: "side" },
      { card: wastes, quantity: 14, board: "side" },
    ];
    expect(validateDeck(entries, "standard").legal).toBe(true);
    const result = run(signals.verified, {}, entries);
    expect(result.entries).toEqual(entries);
    expect(result.steps).toBe(1);
    expect(validateDeck(result.entries, "standard").legal).toBe(true);
  });

  it("deduplicates repeated signals for the same missing pair", () => {
    const result = run({ chains: [], verifiedCombos: Array.from({ length: 40 }, () => verified()) });
    expect(result.steps).toBe(3);
    expect(result.improvements).toBe(1);
  });

  it.each(["verified", "chain"] as const)("inspects only the first 32 %s signals", (kind) => {
    const context: ComboContext = kind === "verified"
      ? { chains: [], verifiedCombos: [...Array.from({ length: 32 }, () => verified([])), verified()] }
      : { verifiedCombos: [], chains: [...Array.from({ length: 32 }, () => ({ ...signals.chain.chains[0], oracleIds: [] })), signals.chain.chains[0]] };
    const result = run(context);
    expect(result.entries).toEqual(start);
    expect(result.steps).toBe(1);
  });

  it("does not search signals with more than eight package cards", () => {
    const anchors = Array.from({ length: 7 }, (_, index) => card(`anchor-${index}`));
    const entries: DeckEntry[] = [
      { card: donorA, quantity: 1, board: "main" }, { card: donorB, quantity: 1, board: "main" },
      ...anchors.map((card): DeckEntry => ({ card, quantity: 1, board: "main" })),
      { card: wastes, quantity: 51, board: "main" },
    ];
    const context: ComboContext = { chains: [], verifiedCombos: [verified([...anchors.map((card) => card.oracleId), pieceA.oracleId, pieceB.oracleId])] };
    const result = run(context, { locked: new Set(anchors.map((card) => card.oracleId)) }, entries);
    expect(result.entries).toEqual(entries);
    expect(result.steps).toBe(1);
  });

  it("bounds real scoring to eight packages and six donors without accepting a worse package", () => {
    const donors: DeckEntry[] = Array.from({ length: 7 }, (_, index) => ({ card: card(`donor-${index}`), quantity: 1, board: "main" }));
    const entries: DeckEntry[] = [...donors, { card: wastes, quantity: 53, board: "main" }];
    const pool = Array.from({ length: 20 }, (_, index) => card(`expensive-${index}`, { priceUsd: 100 }));
    const context: ComboContext = { chains: [], verifiedCombos: Array.from({ length: 10 }, (_, index) => verified([pool[index * 2].oracleId, pool[index * 2 + 1].oracleId])) };
    const options = { ...baseOptions, comboSynergyContext: context };
    // Even with its real completion bonus each full package is still worse.
    const trial = [{ ...entries[0], card: pool[0] }, { ...entries[1], card: pool[1] }, ...entries.slice(2)];
    expect(deckScore(trial, options, 2).total).toBeLessThan(deckScore(entries, options, 2).total);
    const scored = vi.spyOn(weights, "deckScore"); // Call-through only; never replace the real objective.
    const result = run(context, { pool, locked: new Set() }, entries);
    expect(result.entries).toEqual(entries);
    expect(result.improvements).toBe(0);
    expect(result.steps).toBe(241); // One single round + 8 * 6 * 5 pair trials.
    expect(scored).toHaveBeenCalledTimes(249); // Initial score + 8 single candidates + 240 pairs.
  });
});
