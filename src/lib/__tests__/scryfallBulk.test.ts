import { describe, it, expect } from "vitest";
import { resolveBulkDownloadTarget, type ScryfallBulkEntry } from "../scryfallBulk";

describe("resolveBulkDownloadTarget", () => {
  it("prefers the modern jsonl_download_uri (gzip+JSONL) when present", () => {
    const entry: ScryfallBulkEntry = {
      type: "oracle_cards",
      jsonl_download_uri: "https://data.scryfall.io/oracle-cards/oracle-cards.jsonl.gz",
      compressed_size: 24_530_127,
    };
    const target = resolveBulkDownloadTarget(entry);
    expect(target).toEqual({
      url: "https://data.scryfall.io/oracle-cards/oracle-cards.jsonl.gz",
      format: "jsonl-gzip",
    });
  });

  it("falls back to the legacy download_uri (plain JSON) when jsonl_download_uri is absent", () => {
    const entry: ScryfallBulkEntry = {
      type: "oracle_cards",
      download_uri: "https://data.scryfall.io/oracle-cards/oracle-cards.json",
      size: 150_000_000,
    };
    const target = resolveBulkDownloadTarget(entry);
    expect(target).toEqual({
      url: "https://data.scryfall.io/oracle-cards/oracle-cards.json",
      format: "json",
    });
  });

  it("throws a clear error when neither field is present", () => {
    const entry: ScryfallBulkEntry = { type: "oracle_cards" };
    expect(() => resolveBulkDownloadTarget(entry)).toThrow(
      /neither jsonl_download_uri nor download_uri/
    );
  });
});
