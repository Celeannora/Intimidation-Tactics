import { useEffect, useState } from "react";
import { db } from "../lib/db";
import type { DatabaseStatus } from "../hooks/useDBStatus";
import { requestPersistentStorage, estimateStorage, type PersistenceStatus } from "../lib/persistence";
import { UpdateDatabaseButton } from "./UpdateDatabaseButton";

const STALE_AFTER_MS = 30 * 24 * 60 * 60 * 1000;

async function loadStatus(): Promise<DatabaseStatus> {
  const cardCount = await db.cards.count();
  const lastImportedRow = await db.meta.get("lastImportedAt");
  const lastImportedAt = lastImportedRow?.value ?? null;

  let setCount = 0;
  if (cardCount > 0) {
    const sets = new Set<string>();
    await db.cards.each((c) => { if (c.setCode) sets.add(c.setCode); });
    setCount = sets.size;
  }

  const isStale = lastImportedAt
    ? Date.now() - new Date(lastImportedAt).getTime() > STALE_AFTER_MS
    : false;

  return { cardCount, setCount, lastImportedAt, isStale, isEmpty: cardCount === 0 };
}

interface Props {
  onRequestImport?: () => void;
}

export function DatabaseStatusBar({ onRequestImport }: Props) {
  const [status, setStatus] = useState<DatabaseStatus | null>(null);
  const [persistence, setPersistence] = useState<PersistenceStatus | null>(null);
  const [usage, setUsage] = useState<{ usageMb: number; quotaMb: number } | null>(null);

  async function refresh() {
    try {
      const s = await loadStatus();
      setStatus(s);
      setUsage(await estimateStorage());
    } catch {
      // DB not yet initialised — silently ignore
    }
  }

  useEffect(() => {
    refresh();
    const id = setInterval(refresh, 60_000);
    const handler = (e: Event) => setPersistence((e as CustomEvent<PersistenceStatus>).detail);
    window.addEventListener("storage-persistence", handler);
    // Re-read card count after a manual DB update
    const dbRefreshHandler = () => { void refresh(); };
    window.addEventListener("db-refreshed", dbRefreshHandler);
    void requestPersistentStorage().then(setPersistence);
    return () => {
      clearInterval(id);
      window.removeEventListener("storage-persistence", handler);
      window.removeEventListener("db-refreshed", dbRefreshHandler);
    };
  }, []);

  const onClickPersist = async () => setPersistence(await requestPersistentStorage());

  if (!status || status.isEmpty) return null;

  return (
    <div className="flex h-8 shrink-0 items-center gap-3 border-b border-zinc-800/60 bg-zinc-950 px-4 text-xs text-zinc-500">
      <span className="tabular-nums">
        <span className="text-zinc-300 font-medium">{status.cardCount.toLocaleString()}</span> cards
      </span>
      <span className="text-zinc-700">·</span>
      <span className="tabular-nums">
        <span className="text-zinc-300 font-medium">{status.setCount.toLocaleString()}</span> sets
      </span>
      {status.lastImportedAt && (
        <>
          <span className="text-zinc-700">·</span>
          <span>Updated {new Date(status.lastImportedAt).toLocaleDateString()}</span>
        </>
      )}
      {status.isStale && (
        <>
          <span className="text-zinc-700">·</span>
          <span className="rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-400">May be outdated</span>
          <button
            onClick={onRequestImport}
            className="ml-1 rounded px-2 py-0.5 text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800 transition-colors"
          >
            ↻ Refresh
          </button>
        </>
      )}
      {persistence && persistence !== "persisted" && (
        <>
          <span className="text-zinc-700">·</span>
          <button
            onClick={onClickPersist}
            title="Browser may evict the card database under storage pressure. Click to request persistent storage."
            className="rounded bg-amber-900/50 px-1.5 py-0.5 text-amber-400 hover:bg-amber-800/60"
          >
            ⚠ Storage: {persistence}
          </button>
        </>
      )}
      {persistence === "persisted" && (
        <>
          <span className="text-zinc-700">·</span>
          <span className="rounded bg-emerald-900/40 px-1.5 py-0.5 text-emerald-400" title="IndexedDB is persistent on this origin.">
            ✓ Persistent
          </span>
        </>
      )}
      {usage && (
        <>
          <span className="text-zinc-700">·</span>
          <span className="tabular-nums" title={`${usage.usageMb.toFixed(1)} MB of ${usage.quotaMb.toFixed(0)} MB used`}>
            {usage.usageMb.toFixed(0)}/{usage.quotaMb.toFixed(0)} MB
          </span>
        </>
      )}
      <span className="text-zinc-700">·</span>
      <UpdateDatabaseButton />

      <span className="ml-auto">
        <a
          href="https://scryfall.com"
          target="_blank"
          rel="noopener noreferrer"
          className="hover:text-zinc-300 transition-colors"
        >
          Data by Scryfall
        </a>
      </span>
    </div>
  );
}
