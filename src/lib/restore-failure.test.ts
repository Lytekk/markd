import { describe, expect, it } from "vitest";
import {
  classifyRestoreFailure,
  restoreFailureNotice,
  type RestoreFailureKind,
} from "./restore-failure";

const authorizationError = new Error(
  "MARKD_PATH_NOT_AUTHORIZED: This path is not authorized. Open the file or folder through Markd first.",
);
const unavailableError = new Error(
  "MARKD_PATH_UNAVAILABLE: This path could not be reached. It may be on a disconnected drive or share.",
);
const readError = new Error("Unable to read this file.");

describe("classifyRestoreFailure", () => {
  it("reports a native scope denial as unauthorized even when the file is present", () => {
    expect(classifyRestoreFailure(authorizationError, true)).toBe("unauthorized");
  });

  it("reports a native unavailability code as unavailable even when existence is unknown", () => {
    expect(classifyRestoreFailure(unavailableError, null)).toBe("unavailable");
  });

  it("reports a plain read error on an absent file as missing", () => {
    // The operator-visible bug: a deleted file surfaced as an authorization
    // problem because every read failure shared one catch block.
    expect(classifyRestoreFailure(readError, false)).toBe("missing");
  });

  it("reports a plain read error on a present file as unavailable, not missing", () => {
    expect(classifyRestoreFailure(readError, true)).toBe("unavailable");
  });

  it("treats an undetermined existence check as unavailable rather than missing", () => {
    // pathExists itself can fail on a disconnected share; guessing "missing"
    // there would close a tab whose file is fine.
    expect(classifyRestoreFailure(readError, null)).toBe("unavailable");
  });

  it("classifies non-Error rejections by their string form", () => {
    expect(classifyRestoreFailure("MARKD_PATH_NOT_AUTHORIZED: nope", true)).toBe("unauthorized");
    expect(classifyRestoreFailure("MARKD_PATH_UNAVAILABLE: nope", true)).toBe("unavailable");
  });
});

describe("restoreFailureNotice", () => {
  it("returns null when nothing failed", () => {
    expect(restoreFailureNotice({})).toBeNull();
    expect(restoreFailureNotice({ missing: 0, unauthorized: 0, unavailable: 0 })).toBeNull();
  });

  it("names a missing file as missing and never asks the user to re-authorize it", () => {
    const notice = restoreFailureNotice({ missing: 1 });
    expect(notice).not.toBeNull();
    expect(notice!.message).toContain("no longer on disk");
    expect(notice!.message).not.toContain("authorize");
  });

  it("asks only unauthorized files to be reopened for authorization", () => {
    const notice = restoreFailureNotice({ unauthorized: 2 });
    expect(notice!.message).toContain("authorize");
    expect(notice!.message).toContain("2 previously opened files");
  });

  it("says unavailable tabs were kept open so the user does not think they were discarded", () => {
    const notice = restoreFailureNotice({ unavailable: 1 });
    expect(notice!.message).toContain("still open");
    expect(notice!.message).not.toContain("authorize");
  });

  it("reports every class in one notice when they are mixed", () => {
    const notice = restoreFailureNotice({ missing: 1, unauthorized: 1, unavailable: 1 });
    expect(notice!.message).toContain("no longer on disk");
    expect(notice!.message).toContain("authorize");
    expect(notice!.message).toContain("still open");
  });

  it("always states that on-disk contents were left unchanged", () => {
    for (const kind of ["missing", "unauthorized", "unavailable"] as RestoreFailureKind[]) {
      const notice = restoreFailureNotice({ [kind]: 1 });
      expect(notice!.message, kind).toContain("unchanged");
    }
  });

  it("uses singular and plural nouns correctly", () => {
    expect(restoreFailureNotice({ missing: 1 })!.message).toContain("1 previously opened file ");
    expect(restoreFailureNotice({ missing: 3 })!.message).toContain("3 previously opened files ");
  });
});
