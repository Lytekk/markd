/**
 * Serializes intent, not I/O: callers may let reads continue, but only the
 * newest request is allowed to change the active buffer when it completes.
 */
export function createLatestRequestGuard() {
  let current = 0;

  return {
    begin(): number {
      current += 1;
      return current;
    },
    invalidate(): void {
      current += 1;
    },
    isCurrent(request: number): boolean {
      return request === current;
    },
  };
}
