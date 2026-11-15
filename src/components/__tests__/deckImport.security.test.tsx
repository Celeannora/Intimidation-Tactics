import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { DeckImportPanel } from "../DeckImportPanel";
import { DeckPanel } from "../DeckPanel";
import { useDeckStore } from "../../store/deckStore";
import { db } from "../../lib/db";
import type { CardRecord } from "../../lib/types";

(globalThis as unknown as { IS_REACT_ACT_ENVIRONMENT: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
let root: Root;
let host: HTMLDivElement;
const island = { id: "island", oracleId: "island", name: "Island", typeLine: "Basic Land — Island", cmc: 0, manaCost: null, oracleText: "", legalityStandard: "legal", setCode: "TST" } as CardRecord;
async function click(text: string) {
  const button = [...host.querySelectorAll("button")].find(b => b.textContent?.trim() === text);
  expect(button, `button ${text}`).toBeTruthy();
  await act(async () => { button!.click(); await new Promise(resolve => setTimeout(resolve, 30)); });
}
async function input(text: string) {
  const area = host.querySelector("textarea")!;
  await act(async () => {
    Object.getOwnPropertyDescriptor(HTMLTextAreaElement.prototype, "value")!.set!.call(area, text);
    area.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
beforeEach(async () => {
  useDeckStore.getState().clearDeck();
  await db.cards.clear(); await db.cards.put(island);
  host = document.createElement("div"); document.body.append(host); root = createRoot(host);
});
afterEach(async () => { await act(async () => root.unmount()); host.remove(); });

describe("mounted import controls", () => {
  it("shows an unsafe JSON quantity error without invoking the import callback", async () => {
    const onImported = vi.fn();
    await act(async () => root.render(<DeckImportPanel onImported={onImported} />));
    await click("JSON");
    await input('{"mainboard":[{"name":"Island","quantity":1e999}]}');
    await click("Import");
    expect(onImported).not.toHaveBeenCalled();
    expect(host.textContent).toContain("quantities must");
  });
  it.each(['{"mainboard":null,"sideboard":null}', '{"foo":42}'])("rejects malformed JSON %s without changing the active deck", async value => {
    useDeckStore.getState().addCard(island, "main");
    useDeckStore.setState({ pins: { island: 1 }, deckName: "Keep" });
    const before = useDeckStore.getState();
    await act(async () => root.render(<DeckImportPanel onImported={result => useDeckStore.getState().importEntries(result.resolved, true)} />));
    await click("JSON");
    await input(value);
    await click("Import");
    expect(useDeckStore.getState()).toBe(before);
    expect(host.textContent).toContain("Invalid");
  });
  it("catches inline pre-parse failures and preserves the current deck", async () => {
    useDeckStore.getState().addCard(island, "main");
    const before = useDeckStore.getState();
    await act(async () => root.render(<DeckPanel />));
    await click("Import");
    await input("Sideboard\n1000000000 Island");
    await click("Replace deck");
    expect(host.textContent).toContain("Import failed:");
    expect(useDeckStore.getState()).toBe(before);
  });
  it("keeps blend confirmation and cancellation non-destructive", async () => {
    const before = useDeckStore.getState();
    await act(async () => root.render(<DeckPanel />));
    await click("Import");
    await input("Deck\n60 Island\nDeck\n60 Island");
    await click("Replace deck");
    expect(useDeckStore.getState()).toBe(before);
    await click("Cancel");
    expect(useDeckStore.getState()).toBe(before);
    await click("Replace deck");
    await click("Blend & Import (replace)");
    expect(useDeckStore.getState().entries[0].quantity).toBe(99);
  });
});
