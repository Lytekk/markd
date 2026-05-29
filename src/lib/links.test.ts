import { describe, it, expect } from "vitest";
import { normalizeUrl } from "./links";

describe("normalizeUrl", () => {
  it("returns null for empty / whitespace input", () => {
    expect(normalizeUrl("")).toBeNull();
    expect(normalizeUrl("   ")).toBeNull();
  });

  it("keeps an already-absolute http(s) URL unchanged", () => {
    expect(normalizeUrl("https://example.com/a?b=1")).toBe("https://example.com/a?b=1");
    expect(normalizeUrl("http://x.test")).toBe("http://x.test");
  });

  it("prefixes a bare domain with https://", () => {
    expect(normalizeUrl("example.com")).toBe("https://example.com");
    expect(normalizeUrl("www.example.com/path")).toBe("https://www.example.com/path");
  });

  it("turns a bare email into a mailto: link", () => {
    expect(normalizeUrl("user@example.com")).toBe("mailto:user@example.com");
    expect(normalizeUrl("mailto:user@example.com")).toBe("mailto:user@example.com");
  });

  it("keeps anchors and relative paths as-is", () => {
    expect(normalizeUrl("#section")).toBe("#section");
    expect(normalizeUrl("/abs/path")).toBe("/abs/path");
    expect(normalizeUrl("./rel.md")).toBe("./rel.md");
    expect(normalizeUrl("../up.md")).toBe("../up.md");
  });

  it("keeps tel: links", () => {
    expect(normalizeUrl("tel:+15551234")).toBe("tel:+15551234");
  });

  it("refuses javascript:/data:/vbscript: (XSS vectors)", () => {
    expect(normalizeUrl("javascript:alert(1)")).toBeNull();
    expect(normalizeUrl("  JavaScript:alert(1)")).toBeNull();
    expect(normalizeUrl("data:text/html;base64,PHNjcmlwdD4=")).toBeNull();
    expect(normalizeUrl("vbscript:msgbox(1)")).toBeNull();
  });

  it("does not add a scheme to a plain word with no dot", () => {
    expect(normalizeUrl("draft")).toBe("draft");
  });
});
