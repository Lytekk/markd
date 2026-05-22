import { describe, it, expect } from "vitest";
import { OutlinePanel } from "./OutlinePanel";

describe("OutlinePanel", () => {
  it("is exported as a function component", () => {
    expect(typeof OutlinePanel).toBe("function");
  });
});
