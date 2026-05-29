import { describe, it, expect, beforeEach } from "vitest";
import {
  DEFAULT_SNIPPETS,
  SNIPPETS_KEY,
  resolveTokens,
  validateSnippet,
  loadSnippets,
  saveSnippets,
} from "./snippets";

describe("resolveTokens", () => {
  const now = new Date(2026, 4, 29, 14, 5); // 2026-05-29 14:05 local

  it("substitutes {{date}}, {{time}}, {{datetime}}", () => {
    expect(resolveTokens("{{date}}", now)).toBe("2026-05-29");
    expect(resolveTokens("{{time}}", now)).toBe("14:05");
    expect(resolveTokens("{{datetime}}", now)).toBe("2026-05-29 14:05");
  });

  it("leaves non-token text and $1 untouched", () => {
    expect(resolveTokens("hello $1 world", now)).toBe("hello $1 world");
  });

  it("replaces every occurrence", () => {
    expect(resolveTokens("{{date}} / {{date}}", now)).toBe("2026-05-29 / 2026-05-29");
  });
});

describe("validateSnippet", () => {
  it("requires a trigger and a label", () => {
    expect(validateSnippet({ trigger: "", label: "X", body: "" })).toMatch(/trigger/i);
    expect(validateSnippet({ trigger: "t", label: "  ", body: "" })).toMatch(/label/i);
  });
  it("caps trigger length at 24", () => {
    expect(validateSnippet({ trigger: "x".repeat(25), label: "L", body: "" })).toMatch(/24/);
  });
  it("accepts a valid snippet (empty body allowed)", () => {
    expect(validateSnippet({ trigger: "sig", label: "Signature", body: "" })).toBeNull();
  });
});

describe("DEFAULT_SNIPPETS", () => {
  it("keeps every $1 placeholder in a text position (never inside markdown syntax)", () => {
    // $1 must not sit as a link href, image src/alt, or code-fence language —
    // those become HTML attributes a sentinel can't recover. Allowed: heading
    // text, list/quote/cell text, code body, link TEXT.
    for (const s of DEFAULT_SNIPPETS) {
      if (!s.body.includes("$1")) continue;
      // link text form [$1](...) is fine; the attribute forms are not
      expect(s.body).not.toMatch(/\]\(\s*\$1/); // $1 as a URL
      expect(s.body).not.toMatch(/!\[[^\]]*\$1/); // $1 in image alt
      expect(s.body).not.toMatch(/```\$1/); // $1 as code-fence language
    }
  });
  it("has unique ids and triggers", () => {
    const ids = DEFAULT_SNIPPETS.map((s) => s.id);
    const triggers = DEFAULT_SNIPPETS.map((s) => s.trigger);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(triggers).size).toBe(triggers.length);
  });
  it("does NOT ship a frontmatter snippet (mid-doc --- corrupts into hr+setext h2)", () => {
    expect(DEFAULT_SNIPPETS.some((s) => s.body.trimStart().startsWith("---"))).toBe(false);
  });
});

describe("loadSnippets / saveSnippets", () => {
  beforeEach(() => localStorage.clear());

  it("returns the defaults on first run (key absent)", () => {
    expect(loadSnippets()).toEqual(DEFAULT_SNIPPETS);
  });

  it("round-trips a versioned envelope", () => {
    const custom = [{ id: "x", trigger: "x", label: "X", body: "hi" }];
    saveSnippets(custom);
    expect(JSON.parse(localStorage.getItem(SNIPPETS_KEY)!)).toMatchObject({ v: 1, snippets: custom });
    expect(loadSnippets()).toEqual(custom);
  });

  it("returns an empty list when the user cleared all (present-but-empty ≠ first run)", () => {
    saveSnippets([]);
    expect(loadSnippets()).toEqual([]);
  });

  it("migrates a legacy bare array", () => {
    const arr = [{ id: "x", trigger: "x", label: "X", body: "hi" }];
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify(arr));
    expect(loadSnippets()).toEqual(arr);
  });

  it("falls back to defaults on corrupt JSON (never throws)", () => {
    localStorage.setItem(SNIPPETS_KEY, "{not json");
    expect(loadSnippets()).toEqual(DEFAULT_SNIPPETS);
  });

  it("drops malformed entries", () => {
    localStorage.setItem(SNIPPETS_KEY, JSON.stringify({ v: 1, snippets: [{ id: "ok", trigger: "t", label: "L", body: "b" }, { nope: true }] }));
    expect(loadSnippets()).toEqual([{ id: "ok", trigger: "t", label: "L", body: "b" }]);
  });
});
