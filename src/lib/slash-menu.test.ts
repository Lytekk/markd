import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { Editor as TiptapEditor } from "@tiptap/core";
import StarterKit from "@tiptap/starter-kit";
import {
  filterSlashItems,
  buildSlashRows,
  SLASH_ITEMS,
  type SlashItem,
} from "./slash-menu";
import { BlockMath, InlineMath } from "./math";
import { promptModal } from "./modal";

vi.mock("./modal", () => ({ promptModal: vi.fn() }));

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

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

describe("deferred slash math insertion", () => {
  let editor: TiptapEditor;

  beforeEach(() => {
    vi.mocked(promptModal).mockReset();
    editor = new TiptapEditor({
      extensions: [StarterKit, InlineMath, BlockMath],
      content: "<p>before /math after</p><p>second paragraph</p>",
    });
  });

  afterEach(() => {
    if (!editor.isDestroyed) editor.destroy();
  });

  it.each(["Math Block", "Inline Math"])(
    "does not insert %s into a different document loaded while its prompt is open",
    async (title) => {
      const pending = deferred<string | null>();
      vi.mocked(promptModal).mockReturnValueOnce(pending.promise);
      const item = SLASH_ITEMS.find((candidate) => candidate.title === title)!;
      const slashFrom = 1 + "before ".length;

      item.run(editor, { from: slashFrom, to: slashFrom + "/math".length });
      const request = vi.mocked(promptModal).mock.calls[0]![0];
      expect(request.isCurrent?.()).toBe(true);
      editor.commands.setContent("<p>new buffer</p>", false);
      expect(request.isCurrent?.()).toBe(false);
      pending.resolve("x^2");
      await pending.promise;
      await Promise.resolve();

      expect(editor.state.doc.textContent).toBe("new buffer");
      const mathNodes: string[] = [];
      editor.state.doc.descendants((node) => {
        if (node.type.name === "blockMath" || node.type.name === "inlineMath") {
          mathNodes.push(node.type.name);
        }
      });
      expect(mathNodes).toEqual([]);
    },
  );

  it("inserts at the captured slash position when only the caret moves", async () => {
    const pending = deferred<string | null>();
    vi.mocked(promptModal).mockReturnValueOnce(pending.promise);
    const item = SLASH_ITEMS.find((candidate) => candidate.title === "Inline Math")!;
    const slashFrom = 1 + "before ".length;

    item.run(editor, { from: slashFrom, to: slashFrom + "/math".length });
    editor.commands.setTextSelection(editor.state.doc.content.size - 1);
    pending.resolve("x^2");
    await pending.promise;
    await Promise.resolve();

    let mathPos: number | null = null;
    editor.state.doc.descendants((node, pos) => {
      if (node.type.name === "inlineMath") mathPos = pos;
    });
    expect(mathPos).toBe(slashFrom);
  });
});
