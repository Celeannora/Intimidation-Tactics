/** Resource limits, not format-legality limits: confirmed multi-deck seed pools remain supported. */
export const MAX_DECK_INPUT_LENGTH = 1_048_576;
export const MAX_DECK_ROWS = 1_000;
export const MAX_DECK_COPIES = 10_000;
export const MAX_ENTRY_QUANTITY = 99;

export interface ShareableDecoded {
  name: string;
  main: [number, string][];
  side: [number, string][];
}

export function assertDeckQuantity(quantity: unknown): asserts quantity is number {
  if (typeof quantity !== "number" || !Number.isSafeInteger(quantity) || quantity < 1 || quantity > MAX_ENTRY_QUANTITY) {
    throw new Error(`Card quantities must be whole numbers from 1 to ${MAX_ENTRY_QUANTITY}.`);
  }
}

export function assertDeckBudget(entries: readonly { quantity: number }[]): void {
  if (entries.length > MAX_DECK_ROWS) throw new Error(`Deck input exceeds ${MAX_DECK_ROWS} entries.`);
  let total = 0;
  for (const entry of entries) {
    if (!entry || typeof entry !== "object") throw new Error("Invalid deck entry.");
    assertDeckQuantity(entry.quantity);
    total += entry.quantity;
    if (total > MAX_DECK_COPIES) throw new Error(`Deck input exceeds ${MAX_DECK_COPIES} requested copies.`);
  }
}

export function assertShareableDecoded(value: unknown): asserts value is ShareableDecoded {
  if (!value || typeof value !== "object") throw new Error("Invalid shared deck.");
  const data = value as Partial<ShareableDecoded>;
  if (typeof data.name !== "string" || data.name.length > 256 || !Array.isArray(data.main) || !Array.isArray(data.side)) {
    throw new Error("Invalid shared deck shape.");
  }
  if (data.main.length + data.side.length > MAX_DECK_ROWS) throw new Error("Too many shared deck entries.");
  let total = 0;
  for (const board of [data.main, data.side]) {
    const seen = new Set<string>();
    for (const pair of board) {
      if (!Array.isArray(pair) || pair.length !== 2) throw new Error("Invalid shared deck entry.");
      const [quantity, id] = pair;
      assertDeckQuantity(quantity);
      if (typeof id !== "string" || !id.trim() || id.length > 256 || id.includes(":") || seen.has(id)) {
        throw new Error("Invalid or duplicate shared card identifier.");
      }
      seen.add(id);
      total += quantity;
      if (total > MAX_DECK_COPIES) throw new Error("Shared deck exceeds the copy budget.");
    }
  }
}
