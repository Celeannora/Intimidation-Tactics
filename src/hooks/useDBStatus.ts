import { useEffect, useState } from "react";
import { db } from "../lib/db";

export interface DatabaseStatus {
  cardCount: number;
  setCount: number;
  lastImportedAt: string | null;
  isStale: boolean;
  isEmpty: boolean;
}

// Treat the card DB as stale after 30 days.
const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

async function fetchStatus(): Promise<DatabaseStatus> {
  const cardCount = await db.cards.count();
  const lastImportedRow = await db.meta.get("lastImportedAt");
  const lastImportedAt = lastImportedRow?.value ?? null;

  let setCount = 0;
  if (cardCount > 0) {
    const sets = new Set<string>();
    await db.cards.each((c) => {
      if (c.setCode) sets.add(c.setCode);
    });
    setCount = sets.size;
  }

  const isStale = lastImportedAt
    ? Date.now() - new Date(lastImportedAt).getTime() > STALE_AFTER_MS
    : false;

  return {
    cardCount,
    setCount,
    lastImportedAt,
    isStale,
    isEmpty: cardCount === 0,
  };
}

export function useDBStatus() {
  const [status, setStatus] = useState<DatabaseStatus>({
    cardCount: 0,
    setCount: 0,
    lastImportedAt: null,
    isStale: false,
    isEmpty: true,
  });

  async function refresh() {
    try {
      const s = await fetchStatus();
      setStatus(s);
    } catch {
      // DB not yet open
    }
  }

  useEffect(() => {
    refresh();

    // Re-check whenever the cards table changes (after import)
    const sub = db.cards.hook("creating", () => {
      setTimeout(refresh, 500);
    });

    return () => {
      db.cards.hook("creating").unsubscribe(sub as never);
    };
  }, []);

  return {
    isReady: !status.isEmpty,
    cardCount: status.cardCount,
    setCount: status.setCount,
    lastImportedAt: status.lastImportedAt,
    isStale: status.isStale,
    isEmpty: status.isEmpty,
    refresh,
  };
}
