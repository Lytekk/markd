// Slash menu (/) for inserting block types at the caret.
//
// Built on @tiptap/suggestion, which owns the "/" trigger detection, query
// tracking, and key routing. We render the popup as plain DOM (like the
// code-block toolbar) so the imperative suggestion lifecycle stays simple and
// avoids mounting a separate React root. filterSlashItems + buildSlashRows are
// pure and unit-tested; the suggestion wiring and caret positioning are
// verified in the running app.

import { Extension, type Editor, type Range } from "@tiptap/core";
import { Plugin, PluginKey } from "@tiptap/pm/state";
import Suggestion from "@tiptap/suggestion";
import { promptModal } from "./modal";

export interface SlashItem {
  title: string;
  /** Extra search terms not shown in the row (synonyms, abbreviations). */
  keywords?: string;
  run: (editor: Editor, range: Range) => void;
}

function promptAndInsertMath(
  editor: Editor,
  range: Range,
  type: "blockMath" | "inlineMath",
  prompt: Parameters<typeof promptModal>[0],
): void {
  editor.chain().focus().deleteRange(range).run();
  const ownerDoc = editor.state.doc;
  const insertionPos = range.from;

  void promptModal({
    ...prompt,
    isCurrent: () => !editor.isDestroyed && editor.state.doc === ownerDoc,
  }).then((latex) => {
    if (latex == null || !latex.trim() || editor.isDestroyed) return;
    // App tabs intentionally share one Editor instance. setContent() swaps its
    // ProseMirror document when the active tab changes, so a deferred prompt
    // must stay bound to the document that opened it.
    if (editor.state.doc !== ownerDoc) return;
    editor
      .chain()
      .focus()
      .insertContentAt(insertionPos, { type, attrs: { latex: latex.trim() } })
      .run();
  });
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
  {
    title: "Math Block",
    keywords: "latex katex equation formula tex display",
    run: (e, r) => {
      promptAndInsertMath(e, r, "blockMath", {
        title: "Insert math block",
        label: "LaTeX",
        placeholder: "\\int_0^1 x^2\\,dx",
        okLabel: "Insert",
      });
    },
  },
  {
    title: "Inline Math",
    keywords: "latex katex equation formula tex",
    run: (e, r) => {
      promptAndInsertMath(e, r, "inlineMath", {
        title: "Insert inline math",
        label: "LaTeX",
        placeholder: "e^{i\\pi}+1=0",
        okLabel: "Insert",
      });
    },
  },
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
    // Open the menu only when typing changed the doc — never when the caret
    // merely navigates (arrow keys) onto an existing "/…" run, which would
    // otherwise pop the menu open and trap subsequent arrow navigation.
    // The tracker runs before Suggestion (earlier in the array → its apply
    // runs first), so `allow` reads the current transaction's flag.
    let lastTxnChangedDoc = false;
    const typingTracker = new Plugin({
      key: new PluginKey("slashMenuTypingTracker"),
      state: {
        init: () => null,
        apply: (tr) => {
          lastTxnChangedDoc = tr.docChanged;
          return null;
        },
      },
    });
    return [
      typingTracker,
      Suggestion<SlashItem>({
        editor: this.editor,
        char: "/",
        allow: () => lastTxnChangedDoc,
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
