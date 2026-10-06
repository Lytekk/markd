import type { Editor } from "@tiptap/core";
import type { EditorState, Transaction } from "@tiptap/pm/state";
import { textareaText } from "./source-truth";
import { joinFrontmatter } from "./frontmatter";

/** One session-only history per tab, shared by both editing surfaces. Rendered
 * snapshots keep persistent PM nodes; markdown is serialized only on demand. */
export interface EditSnapshot {
  text: string;
  start: number;
  end: number;
  rendered?: EditorState;
  origin?: "rendered" | "source";
  sourceSelectionMapped?: boolean;
}
export interface EditHistory {
  past: EditSnapshot[];
  current: EditSnapshot;
  future: EditSnapshot[];
  group?: { kind: string; time: number; end: number };
}
export function createEditHistory(text: string): EditHistory {
  return { past: [], current: { text, start: 0, end: 0, origin: "source" }, future: [] };
}
export function attachRenderedState(snapshot: EditSnapshot, state: EditorState): void {
  snapshot.rendered = state;
}
function record(history: EditHistory, snapshot: EditSnapshot, group?: { kind: string; from: number; end: number }): void {
  const time = Date.now();
  const previous = history.group;
  const merge = group && previous && previous.kind === group.kind && time - previous.time < 500 && group.from === previous.end && history.future.length === 0;
  if (!merge) history.past.push(history.current);
  history.group = group ? { kind: group.kind, time, end: group.end } : undefined;
  // Bound the entry count without forcing lazy rendered snapshots to serialize.
  if (history.past.length > 100) history.past.shift();
  let sourceBytes = 0;
  for (let i = history.past.length - 1; i >= 0; i--) {
    const entry = history.past[i]!;
    if (entry.origin !== "rendered") sourceBytes += entry.text.length;
    if (i < history.past.length - 1 && sourceBytes > 2_000_000) {
      history.past.splice(0, i + 1);
      break;
    }
  }
  history.current = snapshot;
  history.future = [];
}
export function recordSourceEdit(history: EditHistory, text: string, start = text.length, end = start, inputType?: string): void {
  if (text === history.current.text) return;
  const current = history.current;
  const typing = current.start === current.end && start === end && ["insertText", "deleteContentBackward", "deleteContentForward"].includes(inputType ?? "");
  record(history, { text, start, end, origin: "source", sourceSelectionMapped: true }, typing ? { kind: `source:${inputType}`, from: current.end, end } : undefined);
}
export function recordRenderedEdit(history: EditHistory, editor: Editor, frontmatter: string, transaction?: Transaction): void {
  const state = editor.state;
  if (history.current.rendered?.doc.eq(state.doc)) return;
  let text: string | undefined;
  const doc = state.doc;
  const serializer = editor.storage.markdown.serializer;
  const step = transaction?.steps.length === 1 ? transaction.steps[0]!.toJSON() : null;
  const inline = step?.stepType === "replace" && (!step.slice || step.slice.content?.every((node: { type: string }) => node.type === "text"));
  const inserted = step?.slice?.content?.reduce((n: number, node: { text?: string }) => n + (node.text?.length ?? 0), 0) ?? 0;
  const typing = inline && !transaction?.getMeta("uiEvent") && !transaction?.getMeta("paste") && state.selection.empty &&
    history.current.rendered?.selection.empty && ((inserted === 1 && step.from === step.to) || (inserted === 0 && step.to - step.from === 1));
  const group = typing ? { kind: inserted ? "rendered:insert" : "rendered:delete", from: history.current.rendered!.selection.head, end: state.selection.head } : undefined;
  record(history, {
    get text() { return text ??= textareaText(joinFrontmatter(frontmatter, serializer.serialize(doc))); },
    start: 0, end: 0, rendered: state, origin: "rendered",
  }, group);
}
export function travelEditHistory(history: EditHistory, redo: boolean): EditSnapshot | undefined {
  history.group = undefined;
  const next = (redo ? history.future : history.past).pop();
  if (!next) return;
  (redo ? history.past : history.future).push(history.current);
  history.current = next;
  return next;
}
