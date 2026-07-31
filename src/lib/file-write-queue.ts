import { normalizePathKey } from "./path-identity";

/**
 * Serializes writes to the same file path. State ownership guards decide
 * whether a completed write may settle UI state; this queue also prevents an
 * older already-issued write from landing after newer bytes on disk.
 */
const pendingWrites = new Map<string, Promise<void>>();

export function queueFileWrite<T>(filePath: string, write: () => Promise<T>): Promise<T> {
  // Key by file identity: two spellings of one path must share one queue, or
  // concurrent writes to the same file are not serialized at all.
  const key = normalizePathKey(filePath);
  const run = (): Promise<T> => {
    try {
      return write();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const previous = pendingWrites.get(key);
  const next = previous ? previous.then(run, run) : run();
  const barrier = next.then(
    () => undefined,
    () => undefined,
  );

  pendingWrites.set(key, barrier);
  void barrier.finally(() => {
    if (pendingWrites.get(key) === barrier) pendingWrites.delete(key);
  });

  return next;
}
