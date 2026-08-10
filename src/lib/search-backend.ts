import type { Editor } from "@tiptap/core";
import type { SearchOptions, SearchState } from "@/lib/search-and-replace";
import { findTextRanges, replaceAllRanges, type TextRange } from "@/lib/text-search";
import { revealRange } from "@/lib/textarea-metrics";

/**
 * One find/replace panel, two buffers. The panel (FindReplace.tsx) speaks
 * only this interface; the backend decides where matches live — the rendered
 * ProseMirror doc (decorations + commands) or the source-mode textarea
 * (ranges + backdrop highlights). Semantics are pinned to the PM extension's:
 * apply resets to the first match, next/prev wrap, replace clamps the index,
 * clear drops highlights but keeps the term for F3.
 */

export interface SearchViewState {
  count: number;
  currentIndex: number;
  error: string | null;
}

export interface SearchBackend {
  apply(opts: SearchOptions): void;
  next(): void;
  prev(): void;
  replace(replacement: string): void;
  replaceAll(replacement: string): void;
  /** F3 semantics: adopt fallbackTerm if none retained, re-run dry, advance. */
  findNext(fallbackTerm?: string): void;
  findPrevious(fallbackTerm?: string): void;
  /** Re-run the current search against the live buffer. The panel calls this
   * one frame after apply: a mount-time apply can land inside the editor-view
   * attach window (observed live — decorations valid only after the next
   * tick), and it also refreshes the count display, which meta transactions
   * never re-render on their own. */
  refresh(): void;
  clear(): void;
  getState(): SearchViewState;
  subscribe(onChange: () => void): () => void;
}

export function editorSearchBackend(editor: Editor): SearchBackend {
  const storage = () => editor.storage.searchAndReplace as SearchState;
  let lastOpts: SearchOptions | null = null;
  return {
    apply(opts) {
      // Each command re-runs the whole search — issue only what changed
      // (matches the old per-option effects' cost), term last so the final
      // run uses the complete option set.
      if (!lastOpts || lastOpts.caseSensitive !== opts.caseSensitive) {
        editor.commands.setCaseSensitive(opts.caseSensitive);
      }
      if (!lastOpts || lastOpts.useRegex !== opts.useRegex) {
        editor.commands.setUseRegex(opts.useRegex);
      }
      if (!lastOpts || lastOpts.wholeWord !== opts.wholeWord) {
        editor.commands.setWholeWord(opts.wholeWord);
      }
      if (!lastOpts || lastOpts.searchTerm !== opts.searchTerm) {
        editor.commands.setSearchTerm(opts.searchTerm);
      }
      lastOpts = { ...opts };
    },
    next: () => void editor.commands.nextMatch(),
    prev: () => void editor.commands.previousMatch(),
    replace: (replacement) => void editor.commands.replaceCurrentMatch(replacement),
    replaceAll: (replacement) => void editor.commands.replaceAllMatches(replacement),
    findNext(fallbackTerm) {
      if (!storage().searchTerm && fallbackTerm) {
        editor.commands.setSearchTerm(fallbackTerm);
      }
      editor.commands.findNext();
    },
    findPrevious(fallbackTerm) {
      if (!storage().searchTerm && fallbackTerm) {
        editor.commands.setSearchTerm(fallbackTerm);
      }
      editor.commands.findPrevious();
    },
    refresh() {
      const term = storage().searchTerm;
      if (term) editor.commands.setSearchTerm(term);
    },
    clear: () => void editor.commands.clearDecorations(),
    getState: () => ({
      count: storage().results.length,
      currentIndex: storage().currentIndex,
      error: storage().regexError,
    }),
    subscribe(onChange) {
      const handler = ({ transaction }: { transaction: { docChanged: boolean } }) => {
        if (transaction.docChanged) onChange();
      };
      editor.on("transaction", handler);
      return () => {
        editor.off("transaction", handler);
      };
    },
  };
}

export interface TextareaBackendDeps {
  /** Live buffer text (App reads sourceMarkdownRef). */
  getText: () => string;
  /** Routes through handleSourceMarkdownChange so dirty/stats stay correct. */
  setText: (text: string) => void;
  getTextarea: () => HTMLTextAreaElement | null;
  /** Ranges + current index for the SourceEditor highlight backdrop. */
  onResults?: (ranges: TextRange[], currentIndex: number) => void;
  /** Injectable for tests (default selects + centers via textarea-metrics). */
  reveal?: (ta: HTMLTextAreaElement, range: TextRange, afterEdit: boolean) => void;
  /**
   * Controlled textareas should report edits through their React onChange
   * handler. Direct native input listeners run before React's controlled-value
   * bookkeeping and can clobber the edit; standalone consumers may retain the
   * legacy listener by leaving this enabled.
   */
  listenToInput?: boolean;
}

export function textareaSearchBackend(deps: TextareaBackendDeps): SearchBackend {
  let opts: SearchOptions = {
    searchTerm: "",
    caseSensitive: false,
    useRegex: false,
    wholeWord: false,
  };
  let results: TextRange[] = [];
  let currentIndex = -1;
  let error: string | null = null;
  const listeners = new Set<() => void>();

  const doReveal =
    deps.reveal ??
    ((ta: HTMLTextAreaElement, range: TextRange, afterEdit: boolean) => {
      // After a replace, the textarea's value updates on the NEXT React
      // render — defer the selection/scroll one frame (snippet-insert idiom).
      if (afterEdit) requestAnimationFrame(() => revealRange(ta, range));
      else revealRange(ta, range);
    });

  // The buffer can change while the panel is CLOSED (F3 keeps highlights
  // live, PM-decoration parity) — bind the recompute listener to the
  // results' lifetime, not the panel's subscribe(): attached while matches
  // exist, dropped when they clear (no idle listener; a swapped textarea
  // node re-binds on the next notify).
  let boundTa: HTMLTextAreaElement | null = null;
  const onInput = () => {
    recompute(boundTa?.value ?? deps.getText(), false);
    // The textarea is controlled by React. Its native input listener runs on
    // the target before React's delegated onChange handler; publishing the
    // highlight state synchronously would re-render SourceEditor first and
    // write the old value back, losing an Enter/newline and clamping the
    // caret to EOF. Let the controlled handler commit the edit first.
    notify(true);
  };
  const syncInputBinding = () => {
    const want = deps.listenToInput !== false && results.length > 0 ? deps.getTextarea() : null;
    if (boundTa === want) return;
    boundTa?.removeEventListener("input", onInput);
    boundTa = want;
    boundTa?.addEventListener("input", onInput);
  };
  let resultNotification = 0;
  const notify = (deferResults = false) => {
    syncInputBinding();
    const token = ++resultNotification;
    const publish = () => {
      if (token !== resultNotification) return;
      deps.onResults?.(results, currentIndex);
      listeners.forEach((l) => l());
    };
    if (deferResults) queueMicrotask(publish);
    else publish();
  };
  const reveal = (afterEdit = false) => {
    const r = results[currentIndex];
    const ta = deps.getTextarea();
    if (r && ta) doReveal(ta, r, afterEdit);
  };
  const recompute = (text: string, resetIndex: boolean) => {
    const found = findTextRanges(text, opts);
    results = found.results;
    error = found.error;
    if (resetIndex || currentIndex >= results.length) {
      currentIndex = results.length ? 0 : -1;
    }
  };

  return {
    apply(next) {
      opts = { ...next };
      recompute(deps.getText(), true);
      reveal();
      notify();
    },
    next() {
      if (!results.length) return;
      currentIndex = (currentIndex + 1) % results.length;
      reveal();
      notify();
    },
    prev() {
      if (!results.length) return;
      currentIndex = (currentIndex - 1 + results.length) % results.length;
      reveal();
      notify();
    },
    replace(replacement) {
      const r = results[currentIndex];
      if (!r) return;
      const text = deps.getText();
      const nextText = text.slice(0, r.start) + replacement + text.slice(r.end);
      deps.setText(nextText);
      // Recompute from nextText, not getText(): the ref the getter reads lags
      // until React re-renders.
      const oldIndex = currentIndex;
      recompute(nextText, false);
      currentIndex = results.length ? Math.min(oldIndex, results.length - 1) : -1;
      // Reveal only after the CONTROLLED textarea actually carries nextText —
      // SourceEditor syncs its value in a passive effect, which React 18 runs
      // AFTER paint, i.e. after a single rAF (adversarial-review catch: one
      // rAF selected/scrolled against the pre-replace text). Bounded retry,
      // content-checked — not a blind timer.
      const target = results[currentIndex];
      if (target) {
        let tries = 0;
        const attempt = () => {
          const ta = deps.getTextarea();
          if (!ta) return;
          if (ta.value === nextText || tries >= 10) {
            doReveal(ta, target, false);
            return;
          }
          tries += 1;
          requestAnimationFrame(attempt);
        };
        requestAnimationFrame(attempt);
      }
      notify();
    },
    replaceAll(replacement) {
      if (!results.length) return;
      deps.setText(replaceAllRanges(deps.getText(), results, replacement));
      results = [];
      currentIndex = -1;
      notify();
    },
    findNext(fallbackTerm) {
      if (!opts.searchTerm && fallbackTerm) opts = { ...opts, searchTerm: fallbackTerm };
      if (!results.length && opts.searchTerm) recompute(deps.getText(), true);
      if (!results.length) return;
      // PM findNext parity: a dry re-run is followed by the advance.
      currentIndex = (currentIndex + 1) % results.length;
      reveal();
      notify();
    },
    findPrevious(fallbackTerm) {
      if (!opts.searchTerm && fallbackTerm) opts = { ...opts, searchTerm: fallbackTerm };
      if (!results.length && opts.searchTerm) recompute(deps.getText(), true);
      if (!results.length) return;
      currentIndex = (currentIndex - 1 + results.length) % results.length;
      reveal();
      notify();
    },
    refresh() {
      recompute(deps.getText(), false);
      notify();
    },
    clear() {
      // Keep opts.searchTerm — F3 after closing the panel resumes with it
      // (clearDecorations parity).
      results = [];
      currentIndex = -1;
      notify();
    },
    getState: () => ({ count: results.length, currentIndex, error }),
    subscribe(onChange) {
      // Buffer-change recompute is handled by the results-lifetime input
      // binding above; subscribers only need change notifications.
      listeners.add(onChange);
      return () => {
        listeners.delete(onChange);
      };
    },
  };
}
