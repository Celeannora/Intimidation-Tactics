import { describe, expect, it } from "vitest";
import { parseDeckJSON } from "../deckParser";

describe("JSON deck admission", () => {
  it.each(["null", "[]", "{}", '{"foo":42}', '{"mainboard":null,"sideboard":null}', '{"mainboard":[] ,"sideboard":null}', '{"mainboard":{}}', '{"sideboard":[null]}', '{"mainboard":[{"name":"Island","quantity":"4"}]}', '{"mainboard":[{"name":"Island","quantity":1e999}]}', '{"mainboard":[{"name":null,"quantity":4}]}'])("rejects malformed or unsafe JSON %s", value => {
    expect(() => parseDeckJSON(value)).toThrow();
  });
  it("rejects an oversized input before JSON parsing", () => {
    expect(() => parseDeckJSON(" ".repeat(1_048_577))).toThrow(/large/i);
  });
  it("accepts exported JSON shape with an omitted sideboard", () => {
    expect(parseDeckJSON('{"name":"Deck","mainboard":[{"name":"Island","quantity":24}]}')).toEqual([
      { cardName: "Island", quantity: 24, board: "main" },
    ]);
  });
});
