import { describe, it, expect } from "vitest";
import { OutlinePanel } from "./OutlinePanel";
import { clampActiveHeading } from "@/lib/outline-active";

describe("OutlinePanel", () => {
  it("is exported as a function component", () => {
    expect(typeof OutlinePanel).toBe("function");
  });
});

describe("clampActiveHeading (scroll-spy edge clamping)", () => {
  it("forces the first heading at the very top, ignoring the 40%-line candidate", () => {
    expect(clampActiveHeading(3, 5, true, false)).toBe(0);
  });

  it("forces the last heading at the very bottom", () => {
    expect(clampActiveHeading(1, 5, false, true)).toBe(4);
  });

  it("uses the candidate when not at an extreme", () => {
    expect(clampActiveHeading(2, 5, false, false)).toBe(2);
  });

  it("prefers top over bottom when both are true (tiny doc that fits)", () => {
    expect(clampActiveHeading(3, 5, true, true)).toBe(0);
  });

  it("returns 0 for an empty outline", () => {
    expect(clampActiveHeading(0, 0, false, false)).toBe(0);
  });
});
