import { describe, expect, it } from "vitest";
import type { CardRecord } from "../../types";
import { buildSynergyProfile, crossAxisCompositionBonus, inferPrimaryAxes, inferPrimaryAxesDetailed, keywordFocusToAxes, summarizeSynergyConnections, synergyDensityMultiplier } from "../synergyModel";

function makeCard(name: string, oracleText: string, typeLine = "Creature — Test", quantity = 1): CardRecord[] {
  const card = {
    id: name,
    oracleId: name,
    name,
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{G}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine,
    oracleText,
    keywordsJson: "[]",
    power: "2",
    toughness: "2",
    loyalty: null,
    producedManaJson: "[]",
    legalityStandard: "legal",
    legalityFuture: null,
    bannedInStandard: 0,
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
  } as CardRecord;
  return Array.from({ length: quantity }, () => card);
}

describe("inferPrimaryAxes", () => {
  it("detects narrow mill plans with only five explicit mill cards in a larger imported deck", () => {
    const cards = [
      ...makeCard("Mill Source A", "Target opponent mills three cards.", "Sorcery", 3),
      ...makeCard("Mill Source B", "Each opponent mills two cards.", "Creature — Horror", 2),
      ...makeCard("Generic Draw", "Draw a card.", "Instant", 10),
      ...makeCard("Generic Interaction", "Destroy target creature.", "Instant", 8),
      ...makeCard("Generic Threat", "Flying.", "Creature — Bird", 15),
    ];

    const axes = inferPrimaryAxes(cards.map(buildSynergyProfile));

    expect(axes).toContain("mill");
  });

  it("does not promote incidental two-card sacrifice signals", () => {
    const cards = [
      ...makeCard("Token Maker A", "Create a 1/1 green Saproling creature token.", "Creature — Fungus", 4),
      ...makeCard("Token Maker B", "Create a 1/1 white Soldier creature token.", "Creature — Soldier", 4),
      ...makeCard("Token Payoff", "Tokens you control get +1/+1.", "Enchantment", 4),
      ...makeCard("Incidental Sac Outlet", "Sacrifice another creature: scry 1.", "Creature — Vampire", 2),
      ...makeCard("Generic Threat", "Trample.", "Creature — Beast", 6),
    ];

    const axes = inferPrimaryAxes(cards.map(buildSynergyProfile));

    expect(axes[0]).toBe("tokens");
    expect(axes).not.toContain("sacrifice");
  });

  it("keeps up to five mechanical axes (raised from three)", () => {
    // Six distinct qualifying axes present; the cap should return exactly five.
    const cards = [
      ...makeCard("Draw Source", "Draw a card.", "Sorcery", 5),
      ...makeCard("Token Source", "Create a 1/1 creature token.", "Sorcery", 5),
      ...makeCard("Graveyard Source", "Return target creature card from your graveyard to your hand.", "Sorcery", 5),
      ...makeCard("Counter Source", "Put a +1/+1 counter on target creature.", "Instant", 5),
      ...makeCard("Discard Source", "Discard a card.", "Sorcery", 5),
      ...makeCard("Lifegain Source", "You gain 3 life.", "Sorcery", 5),
    ];

    expect(inferPrimaryAxes(cards.map(buildSynergyProfile))).toHaveLength(5);
  });
});

describe("inferPrimaryAxesDetailed — per-axis confidence (Priority 14)", () => {
  it("scores a dominant axis higher than a marginal one and normalizes the top to 1", () => {
    const cards = [
      // Dominant lifegain plan: 6 payoffs + 6 sources.
      ...makeCard("LG Payoff", "Whenever you gain life, each opponent loses 1 life.", "Enchantment", 6),
      ...makeCard("LG Source", "You gain 3 life.", "Instant", 6),
      // Marginal counters presence: sources only, just clearing the coverage bar.
      ...makeCard("Counter Source", "Put a +1/+1 counter on target creature.", "Instant", 3),
    ];

    const detailed = inferPrimaryAxesDetailed(cards.map(buildSynergyProfile));

    // Strongest first; dominant axis normalizes to exactly 1.
    expect(detailed[0].axis).toBe("lifegain");
    expect(detailed[0].confidence).toBe(1);

    const counters = detailed.find((a) => a.axis === "counters");
    expect(counters).toBeDefined();
    // Marginal axis is present but strictly less confident than the dominant one.
    expect(counters!.confidence).toBeGreaterThan(0);
    expect(counters!.confidence).toBeLessThan(1);
    expect(detailed[0].confidence).toBeGreaterThan(counters!.confidence);

    // Coverage reflects the actual card counts.
    expect(detailed[0].coverage).toBe(12);
    expect(counters!.coverage).toBe(3);

    // Confidence is monotonically non-increasing in rank order.
    for (let i = 1; i < detailed.length; i++) {
      expect(detailed[i].confidence).toBeLessThanOrEqual(detailed[i - 1].confidence);
    }
  });

  it("stays consistent with the bare inferPrimaryAxes accessor", () => {
    const cards = [
      ...makeCard("LG Payoff", "Whenever you gain life, each opponent loses 1 life.", "Enchantment", 6),
      ...makeCard("LG Source", "You gain 3 life.", "Instant", 6),
      ...makeCard("Counter Source", "Put a +1/+1 counter on target creature.", "Instant", 3),
    ];
    const profiles = cards.map(buildSynergyProfile);

    expect(inferPrimaryAxesDetailed(profiles).map((a) => a.axis)).toEqual(inferPrimaryAxes(profiles));
  });
});

describe("directional lifegain/drain tagging (Priority 14 regression)", () => {
  it("tags Bloodthirsty Conqueror as a lifegain PAYOFF, not a source", () => {
    // Real oracle text: drain payoff — life gained is the *effect* of an opponent
    // losing life, so "you gain that much life" must NOT read as a lifegain source.
    const profile = buildSynergyProfile(
      makeCard(
        "Bloodthirsty Conqueror",
        "Flying, deathtouch\nWhenever an opponent loses life, you gain that much life. (Damage causes loss of life.)",
      )[0],
    );

    expect(profile.payoffTags.has("lifegain")).toBe(true);
    expect(profile.sourceTags.has("lifegain")).toBe(false);
  });

  it("tags Vengeful Bloodwitch's death-drain on the lifegain axis as a payoff", () => {
    // Real oracle text: death-triggered drain (aristocrats). The drain must
    // register as lifegain-adjacent, not be lost to the sacrifice bucket alone.
    const profile = buildSynergyProfile(
      makeCard(
        "Vengeful Bloodwitch",
        "Whenever this creature or another creature you control dies, target opponent loses 1 life and you gain 1 life.",
      )[0],
    );

    expect(profile.payoffTags.has("lifegain")).toBe(true);
    // Still a genuine dies-matters payoff — we add the lifegain axis, not swap it.
    expect(profile.payoffTags.has("sacrifice")).toBe(true);
  });

  it("still treats a replacement amplifier (twice that much life) as a lifegain source", () => {
    // Guard against over-correcting: The Wind Crystal-style amplifiers stay sources.
    const profile = buildSynergyProfile(
      makeCard("Wind Crystal", "If you would gain life, you gain twice that much life instead.", "Artifact")[0],
    );
    expect(profile.sourceTags.has("lifegain")).toBe(true);
  });
});

describe("synergy connection scoring", () => {
  it("rewards dense source to payoff relationships", () => {
    const candidate = buildSynergyProfile(makeCard("Token Maker", "Create a 1/1 white Soldier creature token.")[0]);
    const deckProfiles = [
      ...makeCard("Token Payoff A", "Tokens you control get +1/+1.", "Enchantment", 2),
      ...makeCard("Token Payoff B", "Whenever you create a token, draw a card.", "Creature — Advisor", 2),
    ].map(buildSynergyProfile);

    const summary = summarizeSynergyConnections(candidate, deckProfiles);

    expect(summary.partners).toBeGreaterThanOrEqual(2);
    expect(summary.links).toBeGreaterThanOrEqual(2);
    expect(synergyDensityMultiplier(summary)).toBeGreaterThan(1);
  });

  it("recognizes cross-axis viable compositions like tokens plus sacrifice", () => {
    const candidate = buildSynergyProfile(makeCard("Sacrifice Outlet", "Sacrifice another creature: draw a card.")[0]);
    const deckProfiles = makeCard("Token Maker", "Create a 1/1 green Saproling creature token.", "Creature — Fungus", 4)
      .map(buildSynergyProfile);

    expect(crossAxisCompositionBonus(candidate, deckProfiles)).toBeGreaterThanOrEqual(8);
  });

  it("distinguishes self-mill from opponent mill", () => {
    const selfMill = buildSynergyProfile(makeCard("Self Mill", "Mill three cards. Return target creature card from your graveyard to your hand.", "Sorcery")[0]);
    const opponentMill = buildSynergyProfile(makeCard("Opponent Mill", "Target opponent mills three cards.", "Sorcery")[0]);
    const oracleMill = buildSynergyProfile(makeCard("Oracle Mill", "Target player puts the top five cards of their library into their graveyard.", "Sorcery")[0]);

    expect(selfMill.sourceTags.has("selfMill")).toBe(true);
    expect(selfMill.sourceTags.has("mill")).toBe(false);
    expect(opponentMill.sourceTags.has("mill")).toBe(true);
    expect(opponentMill.sourceTags.has("selfMill")).toBe(false);
    expect(oracleMill.sourceTags.has("mill")).toBe(true);
    expect(oracleMill.sourceTags.has("selfMill")).toBe(false);
  });

  it("only gives graveyard cross-axis bonus to self-mill, not opponent mill", () => {
    const recursionDeck = makeCard("Recursion", "Return target creature card from your graveyard to your hand.", "Sorcery", 4)
      .map(buildSynergyProfile);
    const selfMill = buildSynergyProfile(makeCard("Self Mill", "Mill three cards.", "Sorcery")[0]);
    const opponentMill = buildSynergyProfile(makeCard("Opponent Mill", "Target opponent mills three cards.", "Sorcery")[0]);

    expect(crossAxisCompositionBonus(selfMill, recursionDeck)).toBeGreaterThanOrEqual(7);
    expect(crossAxisCompositionBonus(opponentMill, recursionDeck)).toBe(0);
  });
});

// ── 13b regression: tagging accuracy on unusual/homebrew card text ────────────

describe("keywordFocusToAxes — evasion/combat keywords give no misdirected axis", () => {
  it("does not map Flying/Trample/Stompy/Evasion Tempo to unrelated synergy axes", () => {
    expect(keywordFocusToAxes(["Flying"])).toEqual([]);
    expect(keywordFocusToAxes(["Trample"])).toEqual([]);
    expect(keywordFocusToAxes(["Stompy"])).toEqual([]);
    expect(keywordFocusToAxes(["Evasion Tempo"])).toEqual([]);
    // Specifically: Flying must not pull spellslinger, Trample must not pull counters.
    expect(keywordFocusToAxes(["Flying", "Trample"])).not.toContain("spellslinger");
    expect(keywordFocusToAxes(["Flying", "Trample"])).not.toContain("counters");
  });

  it("still maps genuine synergy focuses", () => {
    expect(keywordFocusToAxes(["Lifegain"])).toEqual(["lifegain"]);
    expect(keywordFocusToAxes(["+1/+1 Counters"])).toEqual(["counters"]);
    expect(keywordFocusToAxes(["Reanimator"])).toEqual(["reanimator", "graveyard", "selfMill"]);
  });
});

describe("etb SOURCE tag — only genuine self-ETB blink targets", () => {
  it("tags a homebrew creature with its own enters-the-battlefield ability", () => {
    const p = buildSynergyProfile(
      makeCard("Homebrew Wisp", "When Homebrew Wisp enters the battlefield, draw a card.")[0],
    );
    expect(p.sourceTags.has("etb")).toBe(true);
  });

  it("does not tag an ETB that triggers off an opponent's permanent entering", () => {
    const p = buildSynergyProfile(
      makeCard("Suspicious Watcher", "When a creature enters the battlefield under an opponent's control, you draw a card.", "Enchantment")[0],
    );
    expect(p.sourceTags.has("etb")).toBe(false);
  });

  it("does not tag a non-battlefield 'enters' trigger", () => {
    const p = buildSynergyProfile(
      makeCard("Graveyard Ghoul", "When Graveyard Ghoul enters your graveyard, you gain 2 life.")[0],
    );
    expect(p.sourceTags.has("etb")).toBe(false);
  });
});

describe("mill vs selfMill disambiguation on dual-direction homebrew text", () => {
  it("keeps BOTH tags when a card mills the opponent and yourself", () => {
    const p = buildSynergyProfile(
      makeCard("Twin Grind", "Target opponent mills three cards, then you mill two cards.", "Sorcery")[0],
    );
    expect(p.sourceTags.has("mill")).toBe(true);
    expect(p.sourceTags.has("selfMill")).toBe(true);
  });

  it("tags a bare self-mill as selfMill only", () => {
    const p = buildSynergyProfile(makeCard("Deep Delve", "You mill four cards.", "Sorcery")[0]);
    expect(p.sourceTags.has("selfMill")).toBe(true);
    expect(p.sourceTags.has("mill")).toBe(false);
  });
});

describe("crossAxisCompositionBonus — newly credited compositions", () => {
  it("credits burn alongside spellslinger", () => {
    const candidate = buildSynergyProfile(
      makeCard("Homebrew Bolt", "This spell deals 3 damage to any target.", "Instant")[0],
    );
    const deck = makeCard("Prowess Mage", "Whenever you cast an instant or a sorcery, this creature gets +1/+1.", "Creature — Wizard", 4)
      .map(buildSynergyProfile);
    expect(crossAxisCompositionBonus(candidate, deck)).toBeGreaterThanOrEqual(6);
  });

  it("credits graveyard fill alongside reanimation", () => {
    const candidate = buildSynergyProfile(
      makeCard("Corpse Digger", "Return target creature card from your graveyard to the battlefield.", "Sorcery")[0],
    );
    const deck = makeCard("Yard Filler", "Flashback {2}{B}.", "Sorcery", 4).map(buildSynergyProfile);
    expect(crossAxisCompositionBonus(candidate, deck)).toBeGreaterThanOrEqual(6);
  });
});