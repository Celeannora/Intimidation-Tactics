import { describe, it, expect } from "vitest";
import { isJsonlFile, parseScryfallBulkText } from "../bulkParse";

describe("parseScryfallBulkText", () => {
  it("parses a legacy single-JSON-array payload", () => {
    const text = JSON.stringify([{ id: "a", name: "Card A" }, { id: "b", name: "Card B" }]);
    const cards = parseScryfallBulkText(text, false);
    expect(cards).toHaveLength(2);
    expect(cards[0].name).toBe("Card A");
    expect(cards[1].name).toBe("Card B");
  });

  it("parses a JSON-Lines payload, one object per line", () => {
    const text = [
      JSON.stringify({ id: "a", name: "Card A" }),
      JSON.stringify({ id: "b", name: "Card B" }),
      JSON.stringify({ id: "c", name: "Card C" }),
    ].join("\n");
    const cards = parseScryfallBulkText(text, true);
    expect(cards).toHaveLength(3);
    expect(cards.map((c) => c.name)).toEqual(["Card A", "Card B", "Card C"]);
  });

  it("skips blank lines in JSON-Lines payloads (trailing newline, CRLF, etc.)", () => {
    const text = `${JSON.stringify({ id: "a", name: "Card A" })}\n\n${JSON.stringify({ id: "b", name: "Card B" })}\n`;
    const cards = parseScryfallBulkText(text, true);
    expect(cards).toHaveLength(2);
  });

  it("throws on malformed JSON-Lines content", () => {
    expect(() => parseScryfallBulkText("{not valid json", true)).toThrow();
  });
});

describe("isJsonlFile", () => {
  it("detects .jsonl extension", () => {
    expect(isJsonlFile({ name: "oracle-cards.jsonl" })).toBe(true);
  });

  it("detects .ndjson extension", () => {
    expect(isJsonlFile({ name: "oracle-cards.ndjson" })).toBe(true);
  });

  it("detects ndjson mime type regardless of extension", () => {
    expect(isJsonlFile({ name: "data.txt", type: "application/x-ndjson" })).toBe(true);
  });

  it("returns false for a plain .json file", () => {
    expect(isJsonlFile({ name: "oracle_cards.json", type: "application/json" })).toBe(false);
  });
});
