import { describe, expect, it } from "vitest";
import { generateDeck } from "../generator";
import { cardScore } from "../weights";
import { SEED_ROLE_TARGETS } from "../seedSynergy";
import type { CardRecord } from "../../types";
import type { DeckEntry } from "../../legality";
import type { GenerateOptions } from "../types";

function makeCard(name: string, oracleText: string, power = "2"): CardRecord {
  return {
    id: name, oracleId: name, name,
    lang: "en", layout: "normal", cardFacesJson: null,
    manaCost: "{1}", cmc: 2, colorsJson: "[]", colorIdentityJson: "[]",
    typeLine: "Creature — Test", oracleText, keywordsJson: "[]",
    power, toughness: "2", loyalty: null, producedManaJson: "[]",
    legalityStandard: "legal", legalityFuture: null, bannedInStandard: 0,
    legalitiesJson: "{\"standard\":\"legal\"}",
    setCode: "TST", setName: "Test", setType: null, collectorNumber: null, rarity: "common",
    imageNormal: null, priceUsd: null, priceUsdFoil: null, priceEur: null, edhrecRank: null,
    gameChanger: 0, flavorText: null, artist: null, searchText: name, importedAt: "",
  };
}

describe("combo signals preserve the seed-role veto", () => {
  it("never selects a zero-seed-role engine even when it completes a chain and verified combo", () => {
    const seedA = makeCard("Seed A", "Create a 1/1 token. Whenever you create a token, put a +1/+1 counter on Seed A.");
    const seedB = makeCard("Seed B", "Create a 1/1 token. Whenever you create a token, put a +1/+1 counter on Seed B.");
    // This card has no oracle text that maps to any seed role (Payoff,
    // Enabler, Protection, Consistency) under the classifier, even though
    // the synthetic chain/combo context below (injected directly as test
    // data, independent of oracle text) marks it as completing a chain and
    // a verified combo. A vanilla beater with real token-engine text would
    // now legitimately earn a Payoff role post-PR21 classifier fixes, so
    // this fixture must stay text-neutral to test the veto in isolation.
    const vetoedEngine = makeCard("Vetoed Engine", "Vanilla creature with no relevant abilities.", "8");
    const removal = makeCard("Legal Removal", "Destroy target creature.", "4");
    const seedEntries: DeckEntry[] = [
      { card: seedA, quantity: 2, board: "main" },
      { card: seedB, quantity: 2, board: "main" },
    ];
    const options: GenerateOptions = {
      engine: "offline",
      format: "standard",
      archetype: "Midrange",
      colors: [],
      seedEntries,
      optimizationIterations: 0,
      seedSynergyContext: {
        seedPackage: seedEntries.map((entry) => ({ name: entry.card.name, quantity: entry.quantity })),
        resourceSpec: null,
        anthemSpec: null,
        roleTargets: SEED_ROLE_TARGETS,
      },
      comboSynergyContext: {
        chains: [{
          oracleIds: [seedA.oracleId, seedB.oracleId, vetoedEngine.oracleId],
          cardNames: [seedA.name, seedB.name, vetoedEngine.name],
          kind: "linear",
          axes: ["tokens"],
          chainScore: 9,
          explanation: "Synthetic completion signal.",
        }],
        verifiedCombos: [{
          id: "verified-veto-test",
          cardOracleIds: [seedA.oracleId, seedB.oracleId, vetoedEngine.oracleId],
          cardNames: [seedA.name, seedB.name, vetoedEngine.name],
          description: "Synthetic verified combo.",
          explanation: "Synthetic verified combo.",
          source: "Commander Spellbook",
        }],
      },
    };

    expect(cardScore(vetoedEngine, seedEntries, options, 3)).toBe(-Infinity);
    const result = generateDeck(options, [seedA, seedB, vetoedEngine, removal]);

    expect(result.entries.some((entry) => entry.card.oracleId === vetoedEngine.oracleId)).toBe(false);
  });
});
