import { afterEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { createRoot } from "react-dom/client";
import { CardRow } from "../CardSearchPanel";
import type { CardRecord } from "../../lib/types";
import { recommendSynergyCards, type SynergyRecommendation } from "../../lib/analysis/synergyRecommender";

// Mock the recommender so the async quick-check doesn't touch IndexedDB and we
// can assert on exactly which seed it's called with and what names it renders.
vi.mock("../../lib/analysis/synergyRecommender", () => ({
  recommendSynergyCards: vi.fn(),
}));

// React's act() needs this flag set in a test environment.
(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function makeCard(overrides: Partial<CardRecord> = {}): CardRecord {
  return {
    id: "c1",
    oracleId: "c1",
    name: "Test Card",
    lang: "en",
    layout: "normal",
    cardFacesJson: null,
    manaCost: "{1}{G}",
    cmc: 2,
    colorsJson: "[]",
    colorIdentityJson: "[]",
    typeLine: "Creature — Test",
    oracleText: "Create a 1/1 green Saproling creature token.",
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
    ...overrides,
  } as CardRecord;
}

describe("CardRow quick-synergy toggle", () => {
  it("renders the ≈ synergy toggle even when the deck is empty", () => {
    const html = renderToStaticMarkup(
      <CardRow card={makeCard()} deckCards={[]} onAdd={() => {}} />,
    );
    expect(html).toContain("Show synergy details for Test Card");
  });

  it("renders the ≈ synergy toggle when the deck is populated", () => {
    const deck = [makeCard({ id: "d1", name: "Token Lord", oracleText: "Tokens you control get +1/+1.", typeLine: "Enchantment" })];
    const html = renderToStaticMarkup(
      <CardRow card={makeCard()} deckCards={deck} onAdd={() => {}} />,
    );
    expect(html).toContain("Show synergy details for Test Card");
  });
});

describe("CardRow real synergistic-card recommendations", () => {
  const mockedRecommend = vi.mocked(recommendSynergyCards);

  function recommendation(candidates: SynergyRecommendation["candidates"]): SynergyRecommendation {
    return { seeds: [], candidates, detectedThemes: [], narrative: "", computedAt: "" };
  }

  afterEach(() => {
    mockedRecommend.mockReset();
    document.body.innerHTML = "";
  });

  it("opens the ≈ panel, seeds the recommender with the searched card, and renders real card names", async () => {
    const seed = makeCard({ id: "seed", oracleId: "seed", name: "Seed Card" });
    mockedRecommend.mockResolvedValue(
      recommendation([
        {
          card: makeCard({ id: "r1", oracleId: "r1", name: "Cabal Coffers" }),
          score: 8.5,
          reasons: ["Supplies ramp that Seed Card rewards."],
          connectsTo: ["Seed Card"],
          primaryAxis: "artifacts",
        },
        {
          card: makeCard({ id: "r2", oracleId: "r2", name: "Phyrexian Arena" }),
          score: 6.2,
          reasons: ["Provides card draw."],
          connectsTo: ["Seed Card"],
          primaryAxis: "color-support",
        },
      ]),
    );

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);

    await act(async () => {
      root.render(<CardRow card={seed} deckCards={[]} onAdd={() => {}} />);
    });

    // Panel is closed initially: recommender not called yet.
    expect(mockedRecommend).not.toHaveBeenCalled();

    // Click the ≈ toggle to open the panel.
    const toggle = container.querySelector<HTMLButtonElement>('[aria-label^="Show synergy details"]');
    expect(toggle).not.toBeNull();
    await act(async () => {
      toggle!.click();
    });
    // Flush the resolved recommender promise + resulting state update.
    await act(async () => {});

    // Seeded with exactly the searched card.
    expect(mockedRecommend).toHaveBeenCalledTimes(1);
    const seedArg = mockedRecommend.mock.calls[0][0];
    expect(seedArg).toHaveLength(1);
    expect(seedArg[0].oracleId).toBe("seed");

    // Real, named cards are rendered — not just axis tags.
    expect(container.textContent).toContain("Cabal Coffers");
    expect(container.textContent).toContain("Phyrexian Arena");
    // Each recommendation exposes an add-to-deck affordance.
    expect(container.querySelector('[aria-label="Add Cabal Coffers to deck"]')).not.toBeNull();

    await act(async () => { root.unmount(); });
  });

  it("does not refetch when the panel is toggled closed and reopened", async () => {
    const seed = makeCard({ id: "seed", oracleId: "seed", name: "Seed Card" });
    mockedRecommend.mockResolvedValue(recommendation([]));

    const container = document.createElement("div");
    document.body.appendChild(container);
    const root = createRoot(container);
    await act(async () => {
      root.render(<CardRow card={seed} deckCards={[]} onAdd={() => {}} />);
    });

    const toggle = () => container.querySelector<HTMLButtonElement>('[aria-label$="synergy details for Seed Card"]')!;
    await act(async () => { toggle().click(); });   // open → fetch
    await act(async () => {});
    await act(async () => { toggle().click(); });   // close
    await act(async () => { toggle().click(); });   // reopen → should NOT refetch
    await act(async () => {});

    expect(mockedRecommend).toHaveBeenCalledTimes(1);
    await act(async () => { root.unmount(); });
  });
});
