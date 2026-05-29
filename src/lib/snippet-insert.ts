// Insert a snippet body at the caret WITHOUT corrupting block markdown.
//
// The naive approach (split the body at `$1`, parse each half) corrupts every
// block snippet — markdown is not splittable mid-token (`[$1](url)` → two broken
// paragraphs; a table row → literal pipes). Verified against the project's
// markdown-it. Instead we parse the WHOLE body once, marking the `$1` position
// with a private-use sentinel char that survives parsing as literal text, then
// locate + delete the sentinel to position the caret.
//
// We also must NOT use `editor.commands.insertContent(markdownString)`:
// tiptap-markdown patches insertContentAt to re-parse string content with
// {inline:true} (dist line 977-981), which strips block structure. So we build
// block-aware HTML via parser.parse (no inline), convert it to a ProseMirror
// node, and insert the node as JSON — parser.parse returns non-strings unchanged
// (dist line 845), so the JSON bypasses the markdown re-parse.

import type { Editor } from "@tiptap/core";
import { DOMParser as PMDOMParser } from "@tiptap/pm/model";
import { TextSelection } from "@tiptap/pm/state";
import { resolveTokens } from "./snippets";

/** Marks where the caret should land. Private-use char → parses as literal text. */
const CARET = "";

/** First `$1` → sentinel; v1 supports a single caret stop, later `$1`s stay literal. */
function applyCaretMarker(body: string): { text: string; hasCaret: boolean } {
  const idx = body.indexOf("$1");
  if (idx < 0) return { text: body, hasCaret: false };
  return { text: body.slice(0, idx) + CARET + body.slice(idx + 2), hasCaret: true };
}

/**
 * Insert `rawBody` (markdown, with optional `$1` + {{date}}-style tokens) at the
 * caret. Mode-aware: code block → literal text; table cell → inline markdown;
 * otherwise block-aware markdown. `now` is injectable for deterministic tests.
 */
export function insertSnippetIntoEditor(editor: Editor, rawBody: string, now?: Date): void {
  const resolved = resolveTokens(rawBody, now);
  const { text, hasCaret } = applyCaretMarker(resolved);

  // Inside a code block the body is plain text — markdown chars are literal, so
  // splitting at the sentinel is safe (no tokens to break).
  if (editor.isActive("codeBlock")) {
    insertLiteralText(editor, text, hasCaret);
    return;
  }

  // Table cells can't hold block nodes — parse inline so we insert inline content
  // into the current cell rather than nesting a paragraph/table.
  const inline = editor.isActive("table");
  const html = editor.storage.markdown.parser.parse(text, { inline }) as string;
  const tmp = document.createElement("div");
  tmp.innerHTML = html;
  const parsed = PMDOMParser.fromSchema(editor.state.schema).parse(tmp);

  if (inline && parsed.childCount === 1 && parsed.firstChild?.type.name === "paragraph") {
    // unwrap the single paragraph → insert just its inline content into the cell
    const inlineContent = parsed.firstChild.content.toJSON() ?? [];
    editor.chain().focus().insertContent(inlineContent).run();
  } else {
    const json = parsed.toJSON() as { content?: unknown };
    editor.chain().focus().insertContent(json.content ?? json).run();
  }

  if (hasCaret) placeCaretAtSentinel(editor);
}

/** Code-block path: insert literal text, splitting at the sentinel for the caret. */
function insertLiteralText(editor: Editor, text: string, hasCaret: boolean): void {
  const clean = text.replace(CARET, "");
  const caretOffset = hasCaret ? text.indexOf(CARET) : -1;
  editor
    .chain()
    .focus()
    .command(({ tr, state }) => {
      const from = state.selection.from;
      tr.insertText(clean, from);
      if (caretOffset >= 0) {
        tr.setSelection(TextSelection.create(tr.doc, from + caretOffset));
      }
      return true;
    })
    .run();
}

/** Find the sentinel in the doc, place the caret there, and delete the marker. */
function placeCaretAtSentinel(editor: Editor): void {
  const { doc } = editor.state;
  let at = -1;
  doc.descendants((node, pos) => {
    if (at >= 0) return false;
    if (node.isText && node.text) {
      const i = node.text.indexOf(CARET);
      if (i >= 0) {
        at = pos + i;
        return false;
      }
    }
    return true;
  });
  // If the sentinel didn't land in a text node (shouldn't happen for our
  // text-position defaults), leave the caret where insertContent left it.
  if (at < 0) return;
  editor.chain().focus().setTextSelection({ from: at, to: at + 1 }).deleteSelection().run();
}
