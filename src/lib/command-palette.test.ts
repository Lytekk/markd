import { describe, it, expect, vi } from "vitest";
import { filterCommands, type Command } from "./command-palette";

function cmd(id: string, label: string, keywords?: string): Command {
  return { id, label, keywords, run: vi.fn() };
}

const commands: Command[] = [
  cmd("new", "New File", "create blank"),
  cmd("open", "Open File", "load"),
  cmd("save", "Save"),
  cmd("save-all", "Save All Tabs"),
  cmd("theme", "Toggle Theme", "dark light night day"),
  cmd("source", "Toggle Source / Rendered View", "markdown raw"),
];

describe("filterCommands", () => {
  it("returns every command (original order) for an empty query", () => {
    const out = filterCommands(commands, "");
    expect(out.map((c) => c.id)).toEqual(["new", "open", "save", "save-all", "theme", "source"]);
  });

  it("trims whitespace-only queries to the full list", () => {
    expect(filterCommands(commands, "   ").length).toBe(commands.length);
  });

  it("matches on a case-insensitive substring of the label", () => {
    const out = filterCommands(commands, "open");
    expect(out[0]!.id).toBe("open");
  });

  it("ranks an earlier substring position above a later one", () => {
    const out = filterCommands(commands, "save");
    // "Save" and "Save All Tabs" start with it; "Toggle Source" doesn't contain "save".
    expect(out.map((c) => c.id).slice(0, 2)).toEqual(["save", "save-all"]);
  });

  it("matches a subsequence that is not a contiguous substring", () => {
    // "opf" → O(pen) ... F(ile): in-order subsequence, no substring.
    const out = filterCommands(commands, "opf");
    expect(out.map((c) => c.id)).toContain("open");
  });

  it("excludes commands that match neither label nor keywords", () => {
    const out = filterCommands(commands, "zzzz");
    expect(out).toEqual([]);
  });

  it("matches against keywords, not just the visible label", () => {
    const out = filterCommands(commands, "night");
    expect(out.map((c) => c.id)).toContain("theme");
  });

  it("ranks a substring match above a looser subsequence match", () => {
    // "sa" is a substring of "Save"/"Save All" but only a subsequence of others.
    const out = filterCommands(commands, "sa");
    expect(out[0]!.id === "save" || out[0]!.id === "save-all").toBe(true);
  });
});
