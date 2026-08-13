/**
 * seedSynergy.goldenCorpus.test.ts — Full-pool regression snapshot.
 *
 * seedSynergy.ts's role classifier and resourceCadence heuristic had no
 * direct unit tests before this file; every fix so far (reactive-trigger
 * false positive, static-condition false positive, activated-cost false
 * positive) was discovered by manual inspection of specific cards, not
 * caught by the test suite. This test closes that gap generically: it runs
 * the classifier + cadence heuristic over an entire checked-in card pool
 * (not hand-picked examples) and snapshots the result. Any future change to
 * seedSynergy.ts that alters even one card's classification anywhere in the
 * pool will fail this test and force a deliberate, reviewed snapshot
 * update -- instead of silently shipping a new false positive/negative the
 * way the three fixed bugs did.
 *
 * Uses the repo's existing tracked fixture (src/test/fixtures/standard-pool.json,
 * already CardRecord-shaped, already used by smoke.test.ts) rather than the
 * untracked, sandbox-local pool_data/ directory -- so this test is portable
 * and runs identically in CI or any fresh checkout, not just this session's
 * workspace.
 *
 * Deliberately pool-and-seed-agnostic: swapping SEED_PACKAGE or the fixture
 * file re-derives a new (still meaningful) snapshot rather than hardcoding
 * assumptions about the Hope Estheim seed specifically.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "fs";
import { join } from "path";
import type { CardRecord } from "../../types";
import {
  checkFeasibility,
  classifySeedRoles,
  inferResourceSpec,
  resourceCadence,
  type DeckRoleCounts,
  type SeedPackage,
} from "../seedSynergy";
import type { DeckEntry } from "../../legality";

const FIXTURE_PATH = join(__dirname, "..", "..", "..", "test", "fixtures", "standard-pool.json");

// Same seed used across this branch's Hope Estheim / Space-Time Anomaly
// build. Swappable: this test's job is to snapshot whatever the classifier
// does for the ACTIVE seed, not to assert Hope-Estheim-specific outcomes. If
// none of these names exist in the fixture pool, the resource-cadence tests
// below skip gracefully rather than falsely asserting a resource was found.
const SEED_PACKAGE: SeedPackage = [
  { name: "Hope Estheim", quantity: 4 },
  { name: "Space-Time Anomaly", quantity: 4 },
  { name: "Lyra Dawnbringer", quantity: 4 },
];

function loadFixturePool(): CardRecord[] {
  const raw = JSON.parse(readFileSync(FIXTURE_PATH, "utf-8")) as CardRecord[];
  return [...raw].sort((a, b) => a.name.localeCompare(b.name));
}

describe("seedSynergy golden-corpus regression", () => {
  const pool = loadFixturePool();

  it("loads a non-trivial fixture pool to classify against", () => {
    expect(pool.length).toBeGreaterThan(100);
  });

  it("role classification is stable across the fixture pool", async () => {
    const seedPayoffCards = pool.filter((c) => SEED_PACKAGE.some((s) => s.name === c.name));
    const resourceSpec = inferResourceSpec(seedPayoffCards);

    const snapshot = pool.map((card) => ({
      name: card.name,
      roles: classifySeedRoles(card, SEED_PACKAGE, resourceSpec),
    }));

    await expect(JSON.stringify(snapshot, null, 2)).toMatchFileSnapshot(
      "__snapshots__/seedSynergy.roles.golden.json"
    );
  });

  it("resource cadence classification is stable across the fixture pool", async () => {
    // The fixture pool is a general Standard snapshot and does not contain
    // this branch's specific seed payoffs (Hope Estheim / Space-Time
    // Anomaly), so infer whatever countable resource the fixture's OWN
    // payoff-shaped cards expose (e.g. "Ajani, Caller of the Pride" scales
    // with life total) rather than depending on the active branch seed
    // existing in a general-purpose fixture -- this keeps the test
    // pool-and-seed-agnostic instead of coupling it to Hope Estheim by name.
    const lifeScalingSeed = pool.find((c) => /your life total/i.test(c.oracleText ?? ""));
    const resourceSpec = inferResourceSpec(lifeScalingSeed ? [lifeScalingSeed] : []);
    if (!resourceSpec) {
      // No card in the fixture exposes an inferable countable resource --
      // skip rather than false-fail. The dedicated bug-class fixtures below
      // still exercise resourceCadence directly regardless of this pool's
      // contents.
      return;
    }

    const snapshot = pool.map((card) => ({
      name: card.name,
      cadence: resourceCadence(card, resourceSpec),
    }));

    await expect(JSON.stringify(snapshot, null, 2)).toMatchFileSnapshot(
      "__snapshots__/seedSynergy.cadence.golden.json"
    );
  });

  it("resourceCadence rejects every known false-positive clause class (regression fixtures)", () => {
    // Dedicated, hand-authored fixtures for each condition/effect conflation
    // bug class this branch has fixed. Unlike the pool snapshot above (which
    // only catches a regression if the fixture pool happens to contain a
    // matching card), these assert the EXACT behavior directly, so they keep
    // failing loudly forever regardless of what the fixture pool contains.
    const lifeGainSeed = {
      name: "Synthetic Seed",
      oracleText: "Target player mills cards equal to your life total.",
      typeLine: "Sorcery",
      cmc: 4,
      keywordsJson: "[]",
    } as unknown as CardRecord;
    const lifeSpec = inferResourceSpec([lifeGainSeed]);
    expect(lifeSpec).not.toBeNull();
    if (!lifeSpec) return;

    const card = (oracleText: string, typeLine = "Creature"): CardRecord =>
      ({ name: "Test Card", oracleText, typeLine, cmc: 3, keywordsJson: "[]" }) as unknown as CardRecord;

    // Class 1: reactive trigger condition ("whenever you gain life") is NOT production.
    expect(
      resourceCadence(card("Whenever you gain life, put a +1/+1 counter on this creature."), lifeSpec)
    ).toBeNull();

    // Class 2: static "as long as you have" condition is NOT production.
    expect(
      resourceCadence(card("As long as you have 10 or more life, this creature gets +2/+2 and has trample."), lifeSpec)
    ).toBeNull();

    // Class 3: activated-ability cost ("Pay N life:") is NOT production -- the resource is SPENT.
    expect(resourceCadence(card("Pay 3 life: Draw a card."), lifeSpec)).toBeNull();
    expect(resourceCadence(card("You may pay 3 life. If you do, draw a card.", "Instant"), lifeSpec)).toBeNull();

    // Positive controls -- real production must still be detected.
    expect(resourceCadence(card("You gain 5 life.", "Sorcery"), lifeSpec)).toBe("one-shot");
    expect(resourceCadence(card("When this creature enters, you gain 3 life."), lifeSpec)).toBe("one-shot");
    expect(resourceCadence(card("Lifelink"), lifeSpec)).toBe("repeatable-proactive");
    expect(
      resourceCadence(card("At the beginning of your upkeep, you gain 2 life."), lifeSpec)
    ).toBe("repeatable-proactive");
  });

  it("classification counts by role stay within a sane distribution", () => {
    // A coarse sanity check independent of the exact snapshot: catches a
    // catastrophic regression (e.g. every card suddenly classified as every
    // role, or zero cards classified at all) even before anyone diffs the
    // detailed snapshot files above.
    const seedPayoffCards = pool.filter((c) => SEED_PACKAGE.some((s) => s.name === c.name));
    const resourceSpec = inferResourceSpec(seedPayoffCards);
    const roleCounts = { Payoff: 0, Enabler: 0, Protection: 0, Consistency: 0 };
    for (const card of pool) {
      for (const role of classifySeedRoles(card, SEED_PACKAGE, resourceSpec)) {
        roleCounts[role] += 1;
      }
    }
    const classifiedTotal = Object.values(roleCounts).reduce((a, b) => a + b, 0);
    // Some fraction of a Standard-legal pool should earn a role, but not
    // literally every card (that would indicate an overly permissive regex).
    expect(classifiedTotal).toBeGreaterThan(0);
    expect(classifiedTotal).toBeLessThan(pool.length * 4); // 4 roles max per card
  });

  it("checkFeasibility's color-source check generalizes beyond WU (regression fixture)", () => {
    // Regression guard for the de-hardcoded checkFeasibility fix: the
    // color-source floor used to be a literal `w < 13 || u < 11`, which
    // silently passed (or crashed) for any non-WU seed. It must now flag an
    // undersourced color for ANY color, derived from that color's own pip
    // demand -- not just White/Blue.
    const counts: DeckRoleCounts = { enablers: 12, protection: 10, consistency: 8, payoffs: 6, lands: 24, nonlandTotal: 36 };
    const landCard = (name: string, produces: string, typeLine = "Basic Land"): CardRecord =>
      ({ name, manaCost: "", cmc: 0, typeLine, oracleText: "", keywordsJson: "[]", producedManaJson: JSON.stringify([produces]), colorIdentityJson: JSON.stringify([produces]) }) as unknown as CardRecord;
    const spellCard = (name: string, manaCost: string, cmc: number): CardRecord =>
      ({ name, manaCost, cmc, typeLine: "Creature", oracleText: "", keywordsJson: "[]" }) as unknown as CardRecord;

    const monoRedUndersourced: DeckEntry[] = [
      { card: spellCard("Double Red Payoff", "{R}{R}", 2), quantity: 4, board: "main" },
      { card: landCard("Mountain", "R"), quantity: 8, board: "main" },
      { card: landCard("Plains", "W"), quantity: 16, board: "main" },
    ];
    const undersourcedFlags = checkFeasibility(counts, monoRedUndersourced);
    expect(undersourcedFlags.some((f) => /color source/i.test(f.message) && /R:/.test(f.message))).toBe(true);

    const monoRedWellSourced: DeckEntry[] = [
      { card: spellCard("Double Red Payoff", "{R}{R}", 2), quantity: 4, board: "main" },
      { card: landCard("Mountain", "R"), quantity: 24, board: "main" },
    ];
    const wellSourcedFlags = checkFeasibility(counts, monoRedWellSourced);
    expect(wellSourcedFlags.some((f) => /color source/i.test(f.message))).toBe(false);

    // Empty entries (mid-build, no mana base finalized yet) must not
    // spuriously flag every color as undersourced.
    expect(checkFeasibility(counts, []).some((f) => /color source/i.test(f.message))).toBe(false);
  });
});
