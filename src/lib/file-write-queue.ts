/**
 * Serializes writes to the same file path. State ownership guards decide
 * whether a completed write may settle UI state; this queue also prevents an
 * older already-issued write from landing after newer bytes on disk.
 */
const pendingWrites = new Map<string, Promise<void>>();

export function queueFileWrite<T>(filePath: string, write: () => Promise<T>): Promise<T> {
  const run = (): Promise<T> => {
    try {
      return write();
    } catch (error) {
      return Promise.reject(error);
    }
  };
  const previous = pendingWrites.get(filePath);
  const next = previous ? previous.then(run, run) : run();
  const barrier = next.then(
    () => undefined,
    () => undefined,
  );

  pendingWrites.set(filePath, barrier);
  void barrier.finally(() => {
    if (pendingWrites.get(filePath) === barrier) pendingWrites.delete(filePath);
  });

  return next;
}
