// Pure, testable logic for the auto-update debounce.
//
// The check itself (network + dialog) lives in App.tsx, but the decision of
// *whether* to check is isolated here so it can be unit-tested and can never
// silently wedge the updater on a malformed localStorage value.

export const ONE_HOUR_MS = 3_600_000;

export interface UpdateCheckCoordinator {
  run: (
    manual: boolean,
    operation: (isManualRequested: () => boolean) => Promise<void>,
  ) => Promise<void>;
}

/**
 * One updater operation may own check, offer, download, and install at a time.
 * A manual caller joins an automatic flight and upgrades any not-yet-rendered
 * messaging to manual semantics instead of starting a second install.
 */
export function createUpdateCheckCoordinator(): UpdateCheckCoordinator {
  let current: {
    manualRequested: boolean;
    promise: Promise<void>;
  } | null = null;

  return {
    run(manual, operation) {
      if (current) {
        if (manual) current.manualRequested = true;
        return current.promise;
      }

      const flight = {
        manualRequested: manual,
        promise: Promise.resolve(),
      };
      current = flight;
      flight.promise = Promise.resolve()
        .then(() => operation(() => flight.manualRequested))
        .finally(() => {
          if (current === flight) current = null;
        });
      return flight.promise;
    },
  };
}

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

/** localStorage key holding the version the user chose to skip ("Skip This Version"). */
export const UPDATE_SKIP_KEY = "markd-update-skip";

/**
 * Decide whether to surface the update prompt for an available version.
 *
 * Manual checks always prompt — the user explicitly asked, so a stored skip
 * must not silently eat the result. Automatic checks stay quiet only for the
 * exact skipped version; any other release supersedes the skip. The stored
 * value is the raw version string (no JSON), so a malformed value can never
 * throw — it simply fails to match and we fail open to prompting.
 */
export function shouldOfferUpdate(
  offeredVersion: string,
  skippedVersion: string | null,
  manual: boolean,
): boolean {
  if (manual) return true;
  return skippedVersion !== offeredVersion;
}

/**
 * Automatic network checks stay quiet, but once a user explicitly chooses
 * Install Now the operation is interactive and any install failure must be
 * surfaced through Markd's in-app notice.
 */
export function shouldShowUpdateError(
  manualCheck: boolean,
  installWasChosen: boolean,
): boolean {
  return manualCheck || installWasChosen;
}
