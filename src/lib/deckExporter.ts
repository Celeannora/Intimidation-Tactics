import type { CardRecord } from "./types";

export interface DeckCard { quantity: number; card: CardRecord; }
export interface ExportDeck { mainboard: DeckCard[]; sideboard: DeckCard[]; name: string; notes?: string; }

export function exportMTGO(deck: ExportDeck): string {
  const lines: string[] = [];
  for (const { quantity, card } of deck.mainboard) lines.push(`${quantity} ${card.name}`);
  if (deck.sideboard.length) {
    lines.push("");
    lines.push("Sideboard");
    for (const { quantity, card } of deck.sideboard) lines.push(`${quantity} ${card.name}`);
  }
  return lines.join("\n");
}

export function exportArena(deck: ExportDeck): string {
  const lines: string[] = ["Deck"];
  for (const { quantity, card } of deck.mainboard) {
    const set = card.setCode.toUpperCase();
    const num = card.collectorNumber ?? "1";
    lines.push(`${quantity} ${card.name} (${set}) ${num}`);
  }
  if (deck.sideboard.length) {
    lines.push("");
    lines.push("Sideboard");
    for (const { quantity, card } of deck.sideboard) {
      const set = card.setCode.toUpperCase();
      const num = card.collectorNumber ?? "1";
      lines.push(`${quantity} ${card.name} (${set}) ${num}`);
    }
  }
  return lines.join("\n");
}

export function exportJSON(deck: ExportDeck): string {
  return JSON.stringify({
    name: deck.name,
    notes: deck.notes ?? "",
    mainboard: deck.mainboard.map(({ quantity, card }) => ({ quantity, oracleId: card.oracleId, name: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber })),
    sideboard: deck.sideboard.map(({ quantity, card }) => ({ quantity, oracleId: card.oracleId, name: card.name, setCode: card.setCode, collectorNumber: card.collectorNumber })),
    exportedAt: new Date().toISOString(),
  }, null, 2);
}

export function exportCSV(deck: ExportDeck): string {
  const rows = ["name,quantity,board,setCode,collectorNumber,priceUsd"];
  for (const { quantity, card } of deck.mainboard)
    rows.push(`"${card.name}",${quantity},main,${card.setCode},${card.collectorNumber ?? ""},${card.priceUsd ?? ""}`);
  for (const { quantity, card } of deck.sideboard)
    rows.push(`"${card.name}",${quantity},side,${card.setCode},${card.collectorNumber ?? ""},${card.priceUsd ?? ""}`);
  return rows.join("\n");
}

export function encodeShareableLink(deck: ExportDeck): string {
  const payload = { n: deck.name, m: deck.mainboard.map(({ quantity, card }) => `${quantity}:${card.oracleId}`), s: deck.sideboard.map(({ quantity, card }) => `${quantity}:${card.oracleId}`) };
  const b64 = btoa(JSON.stringify(payload));
  return `${window.location.origin}${window.location.pathname}#deck=${b64}`;
}

export function decodeShareableLink(hash: string): { name: string; main: [number, string][]; side: [number, string][] } | null {
  try {
    const match = hash.match(/#deck=([A-Za-z0-9+/=]+)/);
    if (!match) return null;
    const parsed = JSON.parse(atob(match[1]));
    return {
      name: parsed.n ?? "Imported Deck",
      main: (parsed.m as string[]).map((s) => { const [q, id] = s.split(":"); return [Number(q), id]; }),
      side: (parsed.s as string[]).map((s) => { const [q, id] = s.split(":"); return [Number(q), id]; }),
    };
  } catch { return null; }
}

export function exportShareableLink(deck: ExportDeck): string {
  return encodeShareableLink(deck);
}
