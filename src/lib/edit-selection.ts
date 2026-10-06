import type { Editor } from "@tiptap/core";
import { EditorState, Selection, TextSelection } from "@tiptap/pm/state";
import { splitFrontmatter, joinFrontmatter } from "./frontmatter";
import { parseSavedDoc } from "./dirty-check";
import type { EditSnapshot } from "./edit-history";

// Private-use sentinels are parsed as text (also inside code fences). They are
// used only in isolated documents, never inserted into the user's live buffer.
const START = "\ue000markdStart\ue001";
const END = "\ue000markdEnd\ue001";

export function sourceSelectionForSnapshot(editor: Editor, snapshot: EditSnapshot): void {
  if (snapshot.sourceSelectionMapped || !snapshot.rendered) return;
  const state = snapshot.rendered;
  const { from, to } = state.selection;
  const { frontmatter } = splitFrontmatter(snapshot.text);
  if (!state.doc.resolve(from).parent.inlineContent || !state.doc.resolve(to).parent.inlineContent) {
    snapshot.start = 0; snapshot.end = snapshot.text.length;
  } else {
    const marked = state.tr.insertText(END, to).insertText(START, from).doc;
    const md = joinFrontmatter(frontmatter, editor.storage.markdown.serializer.serialize(marked));
    const start = md.indexOf(START);
    const end = md.indexOf(END) - START.length;
    snapshot.start = Math.max(0, Math.min(snapshot.text.length, start));
    snapshot.end = Math.max(snapshot.start, Math.min(snapshot.text.length, end));
    // Exact source spelling may differ from the serializer (e.g. __ vs **).
    // Prefer the selected visible text nearest the mapped offset in that case.
    const selected = state.doc.textBetween(from, to, "\n");
    if (selected && snapshot.text.slice(snapshot.start, snapshot.end) !== selected) {
      const at = snapshot.text.indexOf(selected, Math.max(0, snapshot.start - 32));
      if (at >= 0) { snapshot.start = at; snapshot.end = at + selected.length; }
    }
  }
  snapshot.sourceSelectionMapped = true;
}

export function renderedStateForSnapshot(editor: Editor, snapshot: EditSnapshot): EditorState {
  if (snapshot.rendered) return snapshot.rendered;
  const { body } = splitFrontmatter(snapshot.text);
  const prefix = snapshot.text.length - body.length;
  const doc = parseSavedDoc(editor, body);
  if (!doc) throw new Error("Unable to parse the current Markdown buffer");
  const start = Math.max(0, snapshot.start - prefix);
  const end = Math.max(start, snapshot.end - prefix);
  const markedBody = body.slice(0, start) + START + body.slice(start, end) + END + body.slice(end);
  const marked = parseSavedDoc(editor, markedBody);
  let selection: Selection = Selection.atStart(doc);
  if (marked) {
    let from = -1, to = -1;
    marked.descendants((node, pos) => {
      if (!node.isText) return;
      const a = node.text!.indexOf(START), b = node.text!.indexOf(END);
      if (a >= 0) from = pos + a;
      if (b >= 0) to = pos + b;
    });
    if (from >= 0 && to >= from) {
      const state = EditorState.create({ doc: marked });
      const clean = state.tr.delete(to, to + END.length).delete(from, from + START.length).doc;
      // Inserting inside Markdown syntax can change parsing. Only use the
      // mapped range when removing the markers recovers the exact target doc.
      if (clean.eq(doc)) selection = TextSelection.between(doc.resolve(from), doc.resolve(to - START.length));
    }
  }
  snapshot.rendered = EditorState.create({ doc, selection });
  return snapshot.rendered;
}
