// Slash menu (/) for inserting block types at the caret.
//
// Built on @tiptap/suggestion, which owns the "/" trigger detection, query
// tracking, and key routing. We render the popup as plain DOM (like the
// code-block toolbar) so the imperative suggestion lifecycle stays simple and
// avoids mounting a separate React root. filterSlashItems + buildSlashRows are
// pure and unit-tested; the suggestion wiring and caret positioning are
// verified in the running app.

import { Extension, type Editor, type Range } from "@tiptap/core";
import Suggestion from "@tiptap/suggestion";

export interface SlashItem {
  title: string;
  /** Extra search terms not shown in the row (synonyms, abbreviations). */
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

/** Each command deletes the typed "/query" first, then applies the block. */
export const SLASH_ITEMS: SlashItem[] = [
  { title: "Heading 1", keywords: "h1 title", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 1 }).run() },
  { title: "Heading 2", keywords: "h2", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 2 }).run() },
  { title: "Heading 3", keywords: "h3", run: (e, r) => e.chain().focus().deleteRange(r).toggleHeading({ level: 3 }).run() },
  { title: "Bullet List", keywords: "ul unordered", run: (e, r) => e.chain().focus().deleteRange(r).toggleBulletList().run() },
  { title: "Numbered List", keywords: "ol ordered", run: (e, r) => e.chain().focus().deleteRange(r).toggleOrderedList().run() },
  { title: "Task List", keywords: "todo checkbox", run: (e, r) => e.chain().focus().deleteRange(r).toggleTaskList().run() },
  { title: "Quote", keywords: "blockquote citation", run: (e, r) => e.chain().focus().deleteRange(r).toggleBlockquote().run() },
  { title: "Code Block", keywords: "fenced pre", run: (e, r) => e.chain().focus().deleteRange(r).toggleCodeBlock().run() },
  { title: "Table", keywords: "grid", run: (e, r) => e.chain().focus().deleteRange(r).insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run() },
  { title: "Divider", keywords: "hr horizontal rule separator", run: (e, r) => e.chain().focus().deleteRange(r).setHorizontalRule().run() },
];

/** Substring match over title + keywords. Empty query → all items. */
export function filterSlashItems(query: string): SlashItem[] {
  const q = query.trim().toLowerCase();
  if (!q) return SLASH_ITEMS;
  return SLASH_ITEMS.filter((it) => `${it.title} ${it.keywords ?? ""}`.toLowerCase().includes(q));
}

/** Build the popup rows (buttons), or a single empty-state row. */
export function buildSlashRows(
  items: SlashItem[],
  selected: number,
  onPick: (index: number) => void,
): HTMLElement[] {
  if (items.length === 0) {
    const empty = document.createElement("div");
    empty.className = "markd-slash-empty";
    empty.textContent = "No matching blocks";
    return [empty];
  }
  return items.map((item, i) => {
    const row = document.createElement("button");
    row.type = "button";
    row.className = `markd-slash-item${i === selected ? " selected" : ""}`;
    row.textContent = item.title;
    // mousedown (not click) so the selection isn't lost before the command runs.
    row.addEventListener("mousedown", (e) => {
      e.preventDefault();
      onPick(i);
    });
    return row;
  });
}

export const SlashMenu = Extension.create({
  name: "slashMenu",

  addProseMirrorPlugins() {
    return [
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        items: ({ query }) => filterSlashItems(query),
        command: ({ editor, range, props }) => props.run(editor, range),
        render: () => {
          let el: HTMLDivElement | null = null;
          let items: SlashItem[] = [];
          let selected = 0;
          let invoke: ((item: SlashItem) => void) | null = null;

          const paint = () => {
            if (!el) return;
            el.replaceChildren(
              ...buildSlashRows(items, selected, (i) => {
                const it = items[i];
                if (it && invoke) invoke(it);
              }),
            );
          };

          const place = (rect: DOMRect | null | undefined) => {
            if (!el || !rect) return;
            el.style.left = `${rect.left}px`;
            el.style.top = `${rect.bottom + 6}px`;
          };

          return {
            onStart: (props) => {
              items = props.items;
              selected = 0;
              invoke = (item) => props.command(item);
              el = document.createElement("div");
              el.className = "markd-slash-menu";
              document.body.appendChild(el);
              paint();
              place(props.clientRect?.());
            },
            onUpdate: (props) => {
              items = props.items;
              selected = Math.min(selected, Math.max(0, items.length - 1));
              invoke = (item) => props.command(item);
              paint();
              place(props.clientRect?.());
            },
            onKeyDown: (props) => {
              const n = items.length;
              if (props.event.key === "ArrowDown") {
                if (n) selected = (selected + 1) % n;
                paint();
                return true;
              }
              if (props.event.key === "ArrowUp") {
                if (n) selected = (selected - 1 + n) % n;
                paint();
                return true;
              }
              if (props.event.key === "Enter") {
                const it = items[selected];
                if (it && invoke) invoke(it);
                return true;
              }
              if (props.event.key === "Escape") {
                el?.remove();
                el = null;
                return true;
              }
              return false;
            },
            onExit: () => {
              el?.remove();
              el = null;
            },
          };
        },
      }),
    ];
  },
});
