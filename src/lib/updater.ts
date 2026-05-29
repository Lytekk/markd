// Pure, testable logic for the auto-update debounce.
//
// The check itself (network + dialog) lives in App.tsx, but the decision of
// *whether* to check is isolated here so it can be unit-tested and can never
// silently wedge the updater on a malformed localStorage value.

export const ONE_HOUR_MS = 3_600_000;

export interface UpdateCheckRecord {
  /** Epoch ms of the last successful check. */
  t: number;
  /** App version at the time of the last check. */
  v: string;
}

/**
 * Decide whether an update check should run now.
 *
 * Re-checks when: there is no record, the record is malformed or the wrong
 * shape, the app version changed since the last check (a fresh install must
 * re-check immediately rather than waiting out the old version's debounce),
 * or more than one hour has elapsed.
 */
export function shouldCheckForUpdate(
  rawStored: string | null,
  currentVersion: string,
  now: number,
): boolean {
  if (!rawStored) return true;

  let parsed: unknown;
  try {
    parsed = JSON.parse(rawStored);
  } catch {
    // A non-JSON legacy/corrupt value must not throw — that error used to be
    // swallowed and permanently blocked all future checks.
    return true;
  }

  if (typeof parsed !== "object" || parsed === null) return true;
  const record = parsed as Partial<UpdateCheckRecord>;

  if (record.v !== currentVersion) return true;
  if (typeof record.t !== "number") return true;

  return now - record.t >= ONE_HOUR_MS;
}

/** Serialize a fresh update-check record for storage. */
export function makeUpdateCheckRecord(currentVersion: string, now: number): string {
  const record: UpdateCheckRecord = { t: now, v: currentVersion };
  return JSON.stringify(record);
}
