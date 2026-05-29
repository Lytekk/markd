import { describe, test, expect } from "vitest";
import {
  shouldCheckForUpdate,
  makeUpdateCheckRecord,
  ONE_HOUR_MS,
} from "./updater";

describe("shouldCheckForUpdate", () => {
  const NOW = 1_000_000_000_000;
  const V = "0.3.6";

  test("checks when there is no stored record", () => {
    expect(shouldCheckForUpdate(null, V, NOW)).toBe(true);
  });

  test("checks when the stored record is malformed JSON (does not wedge the updater)", () => {
    // Regression: a non-JSON legacy value used to throw and get swallowed by
    // .catch(console.error), permanently preventing any further update check.
    expect(shouldCheckForUpdate("not-json", V, NOW)).toBe(true);
    expect(shouldCheckForUpdate("", V, NOW)).toBe(true);
  });

  test("checks when the stored record is the wrong shape", () => {
    expect(shouldCheckForUpdate(JSON.stringify(42), V, NOW)).toBe(true);
    expect(shouldCheckForUpdate(JSON.stringify({ t: "soon" }), V, NOW)).toBe(true);
  });

  test("skips when same version and within the debounce window", () => {
    const stored = JSON.stringify({ t: NOW - 60_000, v: V });
    expect(shouldCheckForUpdate(stored, V, NOW)).toBe(false);
  });

  test("checks when same version but the debounce window has elapsed", () => {
    const stored = JSON.stringify({ t: NOW - ONE_HOUR_MS - 1, v: V });
    expect(shouldCheckForUpdate(stored, V, NOW)).toBe(true);
  });

  test("checks when the app version changed since the last check, even within the window", () => {
    // The whole point of #9: a freshly-installed newer version must re-check
    // immediately rather than waiting out the previous version's debounce.
    const stored = JSON.stringify({ t: NOW - 1000, v: "0.3.5" });
    expect(shouldCheckForUpdate(stored, V, NOW)).toBe(true);
  });
});

describe("makeUpdateCheckRecord", () => {
  test("round-trips through shouldCheckForUpdate as a fresh, same-version record", () => {
    const NOW = 1_700_000_000_000;
    const rec = makeUpdateCheckRecord("0.3.6", NOW);
    expect(shouldCheckForUpdate(rec, "0.3.6", NOW + 1000)).toBe(false);
    expect(JSON.parse(rec)).toEqual({ t: NOW, v: "0.3.6" });
  });
});
