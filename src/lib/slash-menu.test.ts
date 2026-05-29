import { describe, it, expect, vi } from "vitest";
import {
  filterSlashItems,
  buildSlashRows,
  SLASH_ITEMS,
  type SlashItem,
} from "./slash-menu";

describe("filterSlashItems", () => {
  it("returns all items for an empty / whitespace query", () => {
    expect(filterSlashItems("")).toEqual(SLASH_ITEMS);
    expect(filterSlashItems("   ").length).toBe(SLASH_ITEMS.length);
  });

  it("matches the title case-insensitively", () => {
    const out = filterSlashItems("table");
    expect(out.map((i) => i.title)).toEqual(["Table"]);
  });

  it("matches keywords, not just the visible title", () => {
    expect(filterSlashItems("todo").map((i) => i.title)).toContain("Task List");
    expect(filterSlashItems("h1").map((i) => i.title)).toContain("Heading 1");
  });

  it("returns an empty list when nothing matches", () => {
    expect(filterSlashItems("zzzz")).toEqual([]);
  });

  it("offers math insertion (block + inline), reachable by latex/katex keywords", () => {
    const byMath = filterSlashItems("math").map((i) => i.title);
    expect(byMath).toContain("Math Block");
    expect(byMath).toContain("Inline Math");
    expect(filterSlashItems("latex").map((i) => i.title)).toContain("Math Block");
    expect(filterSlashItems("katex").map((i) => i.title)).toContain("Inline Math");
  });
});

describe("buildSlashRows", () => {
  const items: SlashItem[] = [
    { title: "A", run: () => {} },
    { title: "B", run: () => {} },
  ];

  it("renders one row per item and marks the selected row", () => {
    const rows = buildSlashRows(items, 1, () => {});
    expect(rows.length).toBe(2);
    expect(rows[0]!.className).not.toContain("selected");
    expect(rows[1]!.className).toContain("selected");
    expect(rows[1]!.textContent).toBe("B");
  });

  it("calls onPick with the row index on mousedown", () => {
    const onPick = vi.fn();
    const rows = buildSlashRows(items, 0, onPick);
    rows[1]!.dispatchEvent(new MouseEvent("mousedown", { bubbles: true }));
    expect(onPick).toHaveBeenCalledWith(1);
  });

  it("renders a single empty-state row when there are no items", () => {
    const rows = buildSlashRows([], 0, () => {});
    expect(rows.length).toBe(1);
    expect(rows[0]!.textContent?.toLowerCase()).toContain("no");
  });
});
