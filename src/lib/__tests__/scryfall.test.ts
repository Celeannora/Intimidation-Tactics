import { describe, it, expect } from "vitest";
import { isStandardEligible, toCardRecord } from "../scryfall";
import type { ScryfallCard } from "../types";

function base(): ScryfallCard {
  return {
    id: "test-id",
    oracle_id: "test-oracle",
    name: "Test Card",
    lang: "en",
    layout: "normal",
    cmc: 2,
    color_identity: [],
    type_line: "Creature — Human",
    legalities: { standard: "legal" },
    set: "mid",
    set_name: "Midnight Hunt",
    image_uris: { normal: "https://example.com/img.jpg" },
  };
}

describe("Scryfall Transform — Edge Cases", () => {

  // ── 39. Non-english card is excluded ─────────────────────────────────────
  it("EC-39: non-english card fails isStandardEligible", () => {
    expect(isStandardEligible({ ...base(), lang: "de" })).toBe(false);
  });

  // ── 40. Token type line is excluded ──────────────────────────────────────
  it("EC-40: Token type line fails isStandardEligible", () => {
    expect(isStandardEligible({ ...base(), type_line: "Token Creature — Soldier" })).toBe(false);
  });

  // ── 41. memorabilia set type is excluded ─────────────────────────────────
  it("EC-41: memorabilia set_type fails isStandardEligible", () => {
    expect(isStandardEligible({ ...base(), set_type: "memorabilia" })).toBe(false);
  });

  // ── 42. DFC card uses front-face image when root image_uris missing ───────
  it("EC-42: DFC without root image_uris uses first face image", () => {
    const dfc: ScryfallCard = {
      ...base(),
      layout: "transform",
      image_uris: undefined,
      card_faces: [
        { name: "Front", image_uris: { normal: "https://example.com/front.jpg" } },
        { name: "Back", image_uris: { normal: "https://example.com/back.jpg" } },
      ],
    };
    const record = toCardRecord(dfc, new Date().toISOString());
    expect(record.imageNormal).toBe("https://example.com/front.jpg");
  });

  // ── 43. Adventure card stores oracle text from root field ─────────────────
  it("EC-43: adventure card stores combined oracle text", () => {
    const adv: ScryfallCard = {
      ...base(),
      layout: "adventure",
      card_faces: [
        { name: "Creature Side", oracle_text: "Flying." },
        { name: "Adventure Side", oracle_text: "Deal 3 damage." },
      ],
    };
    const record = toCardRecord(adv, new Date().toISOString());
    expect(record.oracleText).toContain("Flying");
    expect(record.oracleText).toContain("Deal 3 damage");
  });

  // ── 44. null prices produce null priceUsd ────────────────────────────────
  it("EC-44: null prices.usd produces null priceUsd on record", () => {
    const card = { ...base(), prices: { usd: null } };
    const record = toCardRecord(card, new Date().toISOString());
    expect(record.priceUsd).toBeNull();
  });

  // ── 45. game_changer: true maps to gameChanger: 1 ────────────────────────
  it("EC-45: game_changer true maps to gameChanger 1 on record", () => {
    const card = { ...base(), game_changer: true };
    const record = toCardRecord(card, new Date().toISOString());
    expect(record.gameChanger).toBe(1);
  });

  // ── 46. Card with Art Series type line is excluded ────────────────────────
  it("EC-46: Art Series type line fails isStandardEligible", () => {
    expect(isStandardEligible({ ...base(), type_line: "Card — Art Series" })).toBe(false);
  });

  // ── 47. searchText is lowercase and includes name + type + oracle ─────────
  it("EC-47: searchText is lowercase and contains name, typeLine, oracleText", () => {
    const card = {
      ...base(),
      name: "Counterspell",
      type_line: "Instant",
      oracle_text: "Counter target spell.",
    };
    const record = toCardRecord(card, new Date().toISOString());
    expect(record.searchText).toContain("counterspell");
    expect(record.searchText).toContain("instant");
    expect(record.searchText).toContain("counter target spell");
  });

  // ── 48. Split card (layout: split) is eligible if standard-legal ──────────
  it("EC-48: split card with standard legality passes isStandardEligible", () => {
    const split: ScryfallCard = { ...base(), layout: "split", type_line: "Instant" };
    expect(isStandardEligible(split)).toBe(true);
  });

  // ── 49. cmc 0 land is stored correctly ────────────────────────────────────
  it("EC-49: land with cmc 0 stores cmc: 0 on record", () => {
    const land = { ...base(), cmc: 0, type_line: "Land" };
    const record = toCardRecord(land, new Date().toISOString());
    expect(record.cmc).toBe(0);
  });

  // ── 50. bannedInStandard 1 for banned legality ────────────────────────────
  it("EC-50: legalities.standard banned sets bannedInStandard to 1", () => {
    const card = { ...base(), legalities: { standard: "banned" } };
    const record = toCardRecord(card, new Date().toISOString());
    expect(record.bannedInStandard).toBe(1);
  });
});
