export type PersistenceStatus = "persisted" | "transient" | "unsupported";

export async function requestPersistentStorage(): Promise<PersistenceStatus> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.persist) {
      return "unsupported";
    }
    const already = await navigator.storage.persisted();
    if (already) return "persisted";
    const granted = await navigator.storage.persist();
    return granted ? "persisted" : "transient";
  } catch {
    return "unsupported";
  }
}

export async function estimateStorage(): Promise<{ usageMb: number; quotaMb: number } | null> {
  try {
    if (typeof navigator === "undefined" || !navigator.storage?.estimate) return null;
    const { usage = 0, quota = 0 } = await navigator.storage.estimate();
    return { usageMb: usage / (1024 * 1024), quotaMb: quota / (1024 * 1024) };
  } catch {
    return null;
  }
}
