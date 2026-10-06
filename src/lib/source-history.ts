/** Session-only textarea history, owned by the tab rather than the DOM node. */
export interface SourceEdit {
  text: string;
  start: number;
  end: number;
}

export interface SourceHistory {
  past: SourceEdit[];
  current: SourceEdit;
  future: SourceEdit[];
}

export function createSourceHistory(text: string): SourceHistory {
  return { past: [], current: { text, start: 0, end: 0 }, future: [] };
}

export function recordSourceEdit(history: SourceHistory, text: string, start = text.length, end = start): void {
  if (text === history.current.text) return;
  history.past.push(history.current);
  // Bound retained full-text snapshots, including for unusually large files.
  let size = 0;
  for (let i = history.past.length - 1; i >= 0; i--) {
    size += history.past[i]!.text.length;
    if (i < history.past.length - 1 && (size > 2_000_000 || history.past.length - i > 100)) {
      history.past.splice(0, i + 1);
      break;
    }
  }
  history.current = { text, start, end };
  history.future = [];
}

export function travelSourceHistory(history: SourceHistory, redo: boolean): SourceEdit | undefined {
  const from = redo ? history.future : history.past;
  const next = from.pop();
  if (!next) return;
  (redo ? history.past : history.future).push(history.current);
  history.current = next;
  return next;
}
