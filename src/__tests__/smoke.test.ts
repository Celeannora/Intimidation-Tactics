/**
 * SMOKE TEST — end-to-end pipeline sanity on a trimmed real-card fixture.
 *
 * Runs in CI without the 150MB Scryfall download. The fixture
 * (src/test/fixtures/standard-pool.json) is ~420 real Standard-legal
 * CardRecords produced by the app's own mapper (toCardRecord). Exercises:
 *   - generateDecks for several archetype/color combos + deck invariants
 *   - consistencyReport / hand-sim sanity (rates in [0,1], no NaN)
 *   - mana base recommendations sanity
 *   - parser/exporter round-trip (Arena + MTGO)
 *   - aiGenerator with a mock provider: valid / hallucinated / malformed JSON
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { describe, it, expect } from "vitest";

import type { CardRecord, ManaColor } from "../lib/types";
import { generateDecks } from "../lib/generator/generator";
import type { GenerateOptions } from "../lib/generator/types";
import type { Archetype } from "../lib/archetype";
import { validateDeck, type DeckEntry } from "../lib/legality";
import { recommendLandCount, recommendColorSources, recommendDualLands } from "../lib/manaBase";
import { buildConsistencyReport, type ConsistencyEntry } from "../lib/consistencyReport";
import { exportArena, exportMTGO, exportJSON, type ExportDeck } from "../lib/deckExporter";
import { parseDecklistText } from "../lib/deckParser";
import { resolveCardName } from "../lib/ai/resolver";
import { generateDeckAI } from "../lib/ai/aiGenerator";
import type { AIProvider } from "../lib/ai/provider";

const here = dirname(fileURLToPath(import.meta.url));
const POOL: CardRecord[] = JSON.parse(
  readFileSync(resolve(here, "../test/fixtures/standard-pool.json"), "utf8")
) as CardRecord[];

const mainOf = (e: DeckEntry[]) => e.filter((x) => x.board === "main");
const sideOf = (e: DeckEntry[]) => e.filter((x) => x.board === "side");
const count = (e: DeckEntry[]) => e.reduce((s, x) => s + x.quantity, 0);
const isLand = (c: CardRecord) => c.typeLine.includes("Land");
const isBasic = (c: CardRecord) => ["Plains", "Island", "Swamp", "Mountain", "Forest", "Wastes"].includes(c.name);
const anyNumber = (c: CardRecord) => /a deck can have any number of cards named/i.test(c.oracleText ?? "");

function hasNaN(obj: unknown): boolean {
  if (typeof obj === "number") return !Number.isFinite(obj);
  if (Array.isArray(obj)) return obj.some(hasNaN);
  if (obj && typeof obj === "object") return Object.values(obj).some(hasNaN);
  return false;
}
function toConsistencyEntries(entries: DeckEntry[]): ConsistencyEntry[] {
  return mainOf(entries).map((e) => ({
    name: e.card.name, quantity: e.quantity, cmc: e.card.cmc,
    manaCost: e.card.manaCost, typeLine: e.card.typeLine, producedManaJson: e.card.producedManaJson,
  }));
}
function mockProvider(id: string, response: string): AIProvider {
  return { id, label: id, isReady: async () => true, generate: async () => response };
}

describe("smoke: fixture pool", () => {
  it("loads a representative Standard pool", () => {
    expect(POOL.length).toBeGreaterThanOrEqual(300);
    expect(POOL.every((c) => c.legalityStandard === "legal")).toBe(true);
    for (const col of ["W", "U", "B", "R", "G"]) {
      const n = POOL.filter((c) => (JSON.parse(c.colorIdentityJson) as string[]).includes(col)).length;
      expect(n).toBeGreaterThan(10);
    }
  });
});

const combos: Array<{ archetype: Archetype; colors: ManaColor[]; label: string }> = [
  { archetype: "Aggro", colors: ["R"], label: "Aggro mono-R" },
  { archetype: "Midrange", colors: ["B", "G"], label: "Midrange BG" },
  { archetype: "Control", colors: ["W", "U"], label: "Control WU" },
];

describe("smoke: generation invariants", () => {
  for (const combo of combos) {
    it(`generates a valid deck — ${combo.label}`, () => {
      const options: GenerateOptions = {
        engine: "offline", format: "standard",
        archetype: combo.archetype, colors: combo.colors,
        generateSideboard: true, variants: 1, optimizationIterations: 30,
      };
      const result = generateDecks(options, POOL);
      const best = result.variants[result.bestIndex];
      const main = mainOf(best.entries);
      const side = sideOf(best.entries);

      // exactly 60 main
      expect(count(main)).toBe(60);
      // >=1 land
      const lands = main.filter((e) => isLand(e.card)).reduce((s, e) => s + e.quantity, 0);
      expect(lands).toBeGreaterThanOrEqual(1);
      // no nonbasic > 4 copies
      for (const e of main) {
        if (!isBasic(e.card) && !anyNumber(e.card)) expect(e.quantity).toBeLessThanOrEqual(4);
      }
      // all main standard-legal
      expect(main.every((e) => e.card.legalityStandard === "legal")).toBe(true);
      // color identity respected
      const allowed = new Set<string>(combo.colors);
      for (const e of main) {
        const ci = JSON.parse(e.card.colorIdentityJson) as string[];
        expect(ci.every((c) => allowed.has(c))).toBe(true);
      }
      // sideboard exactly 15 and legal (when generated)
      if (side.length > 0) {
        expect(count(side)).toBe(15);
        expect(side.every((e) => e.card.legalityStandard === "legal")).toBe(true);
      }
      // validator agrees it's legal
      expect(validateDeck(best.entries, "standard").legal).toBe(true);

      // consistency / hand-sim sanity
      const report = buildConsistencyReport(toConsistencyEntries(best.entries), 500, false);
      const { keepRate, screwRate, floodRate } = report.handStats;
      for (const r of [keepRate, screwRate, floodRate]) {
        expect(r).toBeGreaterThanOrEqual(0);
        expect(r).toBeLessThanOrEqual(1);
      }
      expect(hasNaN(report)).toBe(false);
      expect(report.castabilityRows.length).toBeGreaterThan(0);

      // mana base sanity
      const rec = recommendLandCount(main);
      expect(rec.recommended).toBeGreaterThan(0);
      expect(rec.rangeMin).toBeLessThanOrEqual(rec.rangeMax);
      const cs = recommendColorSources(main, lands);
      expect(cs.every((c) => c.recommendedSources >= 0 && c.pips >= 0)).toBe(true);
      expect(Array.isArray(recommendDualLands(POOL, combo.colors, lands, "standard"))).toBe(true);

      // parser/exporter round-trip (Arena + MTGO)
      const exportDeck: ExportDeck = {
        name: combo.label,
        mainboard: main.map((e) => ({ quantity: e.quantity, card: e.card })),
        sideboard: side.map((e) => ({ quantity: e.quantity, card: e.card })),
      };
      for (const text of [exportArena(exportDeck), exportMTGO(exportDeck)]) {
        const parsed = parseDecklistText(text);
        const re = new Map<string, number>();
        for (const p of parsed.mainboard) {
          const card = resolveCardName(p.cardName, POOL);
          expect(card).not.toBeNull();
          re.set(card!.oracleId, (re.get(card!.oracleId) ?? 0) + p.quantity);
        }
        const orig = new Map<string, number>();
        for (const e of main) orig.set(e.card.oracleId, (orig.get(e.card.oracleId) ?? 0) + e.quantity);
        expect(re.size).toBe(orig.size);
        for (const [oid, q] of orig) expect(re.get(oid)).toBe(q);
      }
      // JSON export valid
      const j = JSON.parse(exportJSON(exportDeck));
      expect(Array.isArray(j.mainboard)).toBe(true);
      expect(j.mainboard.length).toBeGreaterThan(0);
    }, 30000);
  }
});

describe("smoke: legality validator flags illegal decks", () => {
  const basic = POOL.find((c) => c.name === "Mountain") ?? POOL.find(isBasic)!;
  const nonbasic = POOL.find((c) => !isLand(c) && !isBasic(c) && !anyNumber(c))!;

  it("flags 5 copies of a nonbasic", () => {
    const deck: DeckEntry[] = [
      { card: nonbasic, quantity: 5, board: "main" },
      { card: basic, quantity: 55, board: "main" },
    ];
    expect(validateDeck(deck, "standard").violations.some((v) => v.rule === "MAX_COPIES")).toBe(true);
  });
  it("flags a 50-card deck", () => {
    const deck: DeckEntry[] = [{ card: basic, quantity: 50, board: "main" }];
    expect(validateDeck(deck, "standard").violations.some((v) => v.rule === "MIN_60")).toBe(true);
  });
  it("flags an illegal (banned) card", () => {
    const fake: CardRecord = { ...nonbasic, legalityStandard: "banned", bannedInStandard: 1, legalitiesJson: JSON.stringify({ standard: "banned" }) };
    const deck: DeckEntry[] = [
      { card: fake, quantity: 4, board: "main" },
      { card: basic, quantity: 56, board: "main" },
    ];
    const v = validateDeck(deck, "standard");
    expect(v.violations.some((x) => x.rule === "BANNED" || x.rule === "NOT_LEGAL")).toBe(true);
  });
});

describe("smoke: AI pipeline with mock provider", () => {
  const creatures = POOL.filter((c) => c.typeLine.includes("Creature") && !isLand(c));
  const baseOptions = (archetype: Archetype, colors: ManaColor[]): GenerateOptions =>
    ({ engine: "ai", format: "standard", archetype, colors, aiIterations: 1, optimizationIterations: 20 });

  it("valid JSON response → legal 60-card deck", async () => {
    const json = JSON.stringify({
      summary: "s", game_plan: "g",
      main: creatures.slice(0, 15).map((c) => ({ name: c.name, qty: 2 })), side: [],
    });
    const res = await generateDeckAI(baseOptions("Midrange", ["B", "G"]), POOL, mockProvider("valid", json), {});
    expect(count(mainOf(res.entries))).toBe(60);
    expect(validateDeck(res.entries, "standard").legal).toBe(true);
  }, 30000);

  it("hallucinated names → dropped, deck gap-filled to legal 60", async () => {
    const json = JSON.stringify({
      summary: "s", game_plan: "g",
      main: [
        { name: "Fakeo the Nonexistent", qty: 4 },
        { name: "Bolt of Imaginary Lightning", qty: 4 },
        ...creatures.slice(0, 5).map((c) => ({ name: c.name, qty: 2 })),
      ], side: [],
    });
    const res = await generateDeckAI(baseOptions("Aggro", ["R"]), POOL, mockProvider("halluc", json), {});
    expect(count(mainOf(res.entries))).toBe(60);
    expect(validateDeck(res.entries, "standard").legal).toBe(true);
  }, 30000);

  it("malformed/truncated JSON → does not crash, still legal 60", async () => {
    const truncated = '{"summary":"oops","main":[{"name":"' + (creatures[0]?.name ?? "Mountain") + '","qty":4},{"name":"Trun';
    const res = await generateDeckAI(baseOptions("Control", ["W", "U"]), POOL, mockProvider("malformed", truncated), {});
    expect(count(mainOf(res.entries))).toBe(60);
    expect(validateDeck(res.entries, "standard").legal).toBe(true);
  }, 30000);
});
