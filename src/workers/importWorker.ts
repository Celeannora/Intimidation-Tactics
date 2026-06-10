/// <reference lib="webworker" />
import { replaceAllCards } from "../lib/db";
import { isImportEligible, toCardRecord } from "../lib/scryfall";
import type { CardRecord, ImportProgress, ImportResult, ScryfallCard } from "../lib/types";

const ctx: DedicatedWorkerGlobalScope = self as never;

function postProgress(progress: ImportProgress) {
  ctx.postMessage({ type: "progress", payload: progress });
}

ctx.onmessage = async (event: MessageEvent<File>) => {
  const file = event.data;

  try {
    postProgress({
      phase: "reading",
      percent: 5,
      processed: 0,
      total: 0,
      message: `Reading ${file.name}...`
    });

    const text = await file.text();

    postProgress({
      phase: "parsing",
      percent: 20,
      processed: 0,
      total: 0,
      message: "Parsing JSON..."
    });

    const parsed = JSON.parse(text) as ScryfallCard[];
    const total = parsed.length;
    const importedAt = new Date().toISOString();

    postProgress({
      phase: "transforming",
      percent: 35,
      processed: 0,
      total,
      message: "Filtering playable cards..."
    });

    const records: CardRecord[] = [];
    let skipped = 0;

    for (let i = 0; i < parsed.length; i++) {
      const card = parsed[i];

      if (isImportEligible(card)) {
        records.push(toCardRecord(card, importedAt));
      } else {
        skipped++;
      }

      if (i % 1000 === 0) {
        const percent = 35 + Math.round((i / total) * 45);
        postProgress({
          phase: "transforming",
          percent,
          processed: i,
          total,
          message: `Processed ${i.toLocaleString()} / ${total.toLocaleString()} cards`
        });
      }
    }

    postProgress({
      phase: "saving",
      percent: 85,
      processed: records.length,
      total,
      message: "Saving cards to IndexedDB..."
    });

    await replaceAllCards(records, importedAt);

    const result: ImportResult = {
      imported: records.length,
      skipped,
      totalSeen: total,
      timestamp: importedAt
    };

    postProgress({
      phase: "done",
      percent: 100,
      processed: records.length,
      total,
      message: `Imported ${records.length.toLocaleString()} cards`
    });

    ctx.postMessage({ type: "done", payload: result });
  } catch (error) {
    ctx.postMessage({
      type: "error",
      payload: error instanceof Error ? error.message : "Unknown import error"
    });
  }
};
