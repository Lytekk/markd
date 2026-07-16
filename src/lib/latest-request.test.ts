import { describe, expect, it } from "vitest";
import { createLatestRequestGuard } from "./latest-request";

describe("createLatestRequestGuard", () => {
  it("invalidates an older async tab load when a newer intent supersedes it", () => {
    const guard = createLatestRequestGuard();
    const first = guard.begin();
    const second = guard.begin();

    expect(guard.isCurrent(first)).toBe(false);
    expect(guard.isCurrent(second)).toBe(true);
  });

  it("invalidates every pending request when a synchronous buffer transition wins", () => {
    const guard = createLatestRequestGuard();
    const pending = guard.begin();
    guard.invalidate();

    expect(guard.isCurrent(pending)).toBe(false);
  });
});
