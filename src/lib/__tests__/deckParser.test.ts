import { describe, expect, it } from "vitest";
import { cardNameCandidates, parseDecklistText } from "../deckParser";

describe("parseDecklistText", () => {
  it("strips inline // comments from card lines", () => {
    const parsed = parseDecklistText("4 Duress // hand disruption\n2 Go for the Throat # removal");

    expect(parsed.mainboard).toEqual([
      { quantity: 4, cardName: "Duress", board: "main" },
      { quantity: 2, cardName: "Go for the Throat", board: "main" },
    ]);
    expect(parsed.unmatched).toEqual([]);
  });

  it("uses // section headers to switch boards", () => {
    const parsed = parseDecklistText("// Deck\n4 Cut Down\n// Sideboard\n3 Duress");

    expect(parsed.mainboard).toEqual([
      { quantity: 4, cardName: "Cut Down", board: "main" },
    ]);
    expect(parsed.sideboard).toEqual([
      { quantity: 3, cardName: "Duress", board: "side" },
    ]);
  });

  it("preserves split-card names when // is part of the card name", () => {
    const parsed = parseDecklistText("1 Fire // Ice");

    expect(parsed.mainboard).toEqual([
      { quantity: 1, cardName: "Fire // Ice", board: "main" },
    ]);
  });

  it("keeps double-faced // output parseable and exposes front-face fallback candidates", () => {
    const parsed = parseDecklistText("1 Throne of the Grim Captain // The Grim Captain");

    expect(parsed.mainboard).toEqual([
      { quantity: 1, cardName: "Throne of the Grim Captain // The Grim Captain", board: "main" },
    ]);
    expect(cardNameCandidates(parsed.mainboard[0].cardName)).toEqual([
      "Throne of the Grim Captain // The Grim Captain",
      "Throne of the Grim Captain",
      "The Grim Captain",
    ]);
  });
});